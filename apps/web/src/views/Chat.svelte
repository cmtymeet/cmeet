<script lang="ts">
  import { memberName } from '../../../../ui/src/member-name.js';
  import { untrack } from 'svelte';
  import type { CmsgClient, Thread } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { chatStrings as t } from '../strings/chat.js';

  interface Props {
    client: CmsgClient;
    peer: string;
  }
  let { client, peer }: Props = $props();

  let thread: Thread | null = $state(null);
  let drafts: Record<string, string> = $state({});
  let draft = $state('');
  let error = $state('');
  let sendBusy = $state(false);
  let actionBusy: string | null = $state(null);
  let errorNode: HTMLDivElement | null = $state(null);
  // Generation: bumped on every peer change and on teardown so late
  // completions from an old peer can never touch the new view.
  let loadSeq = 0;
  // Per-load request id: each load is newer than the last, so an earlier
  // event-triggered load cannot overwrite later state.
  let loadReq = 0;
  let latestReq = 0;

  const busy = $derived(sendBusy || actionBusy !== null);
  const threadState = $derived(thread?.state ?? 'active');
  const isOpen = $derived(
    thread !== null && thread.established && (thread.state === undefined || thread.state === 'active'),
  );
  const statusLabel = $derived(
    threadState === 'closed'
      ? t.statusClosed
      : threadState === 'blocked'
        ? t.statusBlocked
        : threadState === 'reopen-pending'
          ? t.statusReopenPending
          : t.statusActive,
  );

  async function load(requestedPeer: string, seq: number, req: number) {
    try {
      const next = await client.thread(requestedPeer);
      if (seq !== loadSeq || req !== latestReq) return;
      thread = next;
      error = '';
    } catch (e) {
      if (seq !== loadSeq || req !== latestReq) return;
      thread = null;
      error = e instanceof Error ? e.message : t.loadFailed;
    }
  }

  function requestLoad(requestedPeer: string, seq: number) {
    loadReq += 1;
    latestReq = loadReq;
    void load(requestedPeer, seq, latestReq);
  }

  $effect(() => {
    const current = peer;
    loadSeq += 1;
    const seq = loadSeq;
    thread = null;
    error = '';
    // Untracked: the per-peer draft store must not subscribe this lifecycle
    // effect, or every keystroke would reset busy/thread/actions and reload.
    draft = untrack(() => drafts[current] ?? '');
    sendBusy = false;
    actionBusy = null;
    requestLoad(current, seq);
    const unsubscribe = client.subscribe((event) => {
      if (seq !== loadSeq) return;
      if (event.type === 'message' && event.message.threadId === thread?.id) {
        requestLoad(current, seq);
      } else if (event.type === 'contacts') {
        requestLoad(current, seq);
      }
    });
    return () => {
      loadSeq += 1;
      unsubscribe();
    };
  });

  $effect(() => {
    if (error) errorNode?.focus();
  });

  function onDraftInput(value: string) {
    draft = value;
    drafts[peer] = value;
  }

  async function send() {
    const text = draft.trim();
    if (!text || sendBusy || actionBusy !== null) return;
    const current = peer;
    const seq = loadSeq;
    sendBusy = true;
    error = '';
    try {
      await client.sendMessage(current, text);
      if (seq !== loadSeq) return;
      drafts[current] = '';
      draft = '';
      requestLoad(current, seq);
    } catch (e) {
      if (seq !== loadSeq) return;
      error = e instanceof Error ? e.message : t.sendFailed;
    } finally {
      if (seq === loadSeq) sendBusy = false;
    }
  }

  async function runAction(kind: 'close' | 'block' | 'reopen') {
    if (actionBusy !== null || sendBusy) return;
    const current = peer;
    const seq = loadSeq;
    actionBusy = kind;
    error = '';
    try {
      if (kind === 'close') await client.closeConversation(current);
      else if (kind === 'block') await client.blockMember(current);
      else await client.requestReopen(current);
      if (seq !== loadSeq) return;
      requestLoad(current, seq);
    } catch (e) {
      if (seq !== loadSeq) return;
      error = e instanceof Error ? e.message : t.actionFailed;
    } finally {
      if (seq === loadSeq) actionBusy = null;
    }
  }

  function stateLabel(state: string): string {
    if (state === 'queued') return t.queuedLabel;
    if (state === 'stored') return t.storedLabel;
    if (state === 'received') return t.receivedLabel;
    return state;
  }
</script>

<section class="page" aria-labelledby="chat-title">
  <h1 id="chat-title">{thread ? memberName(thread.peerHandle, thread.peerDisplayName) : t.title}</h1>
  {#if thread}
    <p class="muted">Status: {statusLabel}{thread.established ? ` · ${t.establishedNote}` : ''}</p>
    {#if !thread.established && threadState === 'active'}
      <Notice tone="info">{t.waitingNote}</Notice>
    {/if}
    {#if threadState === 'closed'}
      <Notice tone="info">{t.closedNote}</Notice>
    {/if}
    {#if threadState === 'blocked'}
      <Notice tone="warning">{t.blockedNote}</Notice>
    {/if}
    {#if threadState === 'reopen-pending'}
      <Notice tone="info">{t.reopenPendingNote}</Notice>
    {/if}
  {/if}
  {#if error}
    <div class="error-focus" tabindex="-1" bind:this={errorNode}>
      <Notice tone="error">{error}</Notice>
    </div>
  {/if}
  {#if thread}
    <ul class="thread" aria-live="polite" aria-label="Messages">
      {#each thread.messages as message (message.id)}
        <li class="bubble" class:out={message.outgoing}>
          <div>{message.text}</div>
          <div class="meta">{stateLabel(message.state)}</div>
        </li>
      {/each}
    </ul>
    {#if thread.messages.length === 0}<p class="muted">{t.empty}</p>{/if}
    <p class="muted">{t.historyNote}</p>
    <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
      <label class="visually-hidden" for="composer">{t.messageLabel}</label>
      <input
        id="composer"
        value={draft}
        oninput={(e) => onDraftInput(e.currentTarget.value)}
        placeholder={t.messageLabel}
        autocomplete="off"
        disabled={!isOpen || busy}
      />
      <Button type="submit" variant="primary" busy={sendBusy} busyLabel={t.sending} disabled={!isOpen || busy}>
        {t.send}
      </Button>
    </form>
    <div class="row actions">
      {#if threadState === 'closed'}
        <Button
          busy={actionBusy === 'reopen'}
          busyLabel={t.working}
          disabled={busy}
          onclick={() => void runAction('reopen')}
        >
          {t.reopenAction}
        </Button>
      {:else if threadState === 'active'}
        <Button
          busy={actionBusy === 'close'}
          busyLabel={t.working}
          disabled={!isOpen || busy}
          onclick={() => void runAction('close')}
        >
          {t.closeAction}
        </Button>
      {/if}
      <Button busy={actionBusy === 'block'} busyLabel={t.working} disabled={busy} onclick={() => void runAction('block')}>
        {t.blockAction}
      </Button>
    </div>
  {:else if !error}
    <p aria-live="polite">{t.loading}</p>
  {/if}
</section>

<style>
  .visually-hidden {
    position: absolute;
    left: -9999px;
  }
  .error-focus:focus {
    outline: none;
  }
  .error-focus:focus-visible {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
  .actions {
    margin-top: 0.75rem;
  }
</style>
