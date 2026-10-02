<script lang="ts">
  import type { CmsgClient, Thread } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { chatStrings as t } from '../strings/chat.js';

  interface Props {
    client: CmsgClient;
    peer: string;
  }
  let { client, peer }: Props = $props();

  let thread: Thread | null = $state(null);
  let draft = $state('');
  let error = $state('');
  let sendBusy = $state(false);
  let actionBusy: string | null = $state(null);
  let punishArmed = $state(false);
  let errorNode: HTMLDivElement | null = $state(null);
  let loadSeq = 0;

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

  async function load(requestedPeer: string, seq: number) {
    try {
      const next = await client.thread(requestedPeer);
      if (seq !== loadSeq) return;
      thread = next;
      error = '';
    } catch (e) {
      if (seq !== loadSeq) return;
      thread = null;
      error = e instanceof Error ? e.message : t.loadFailed;
    }
  }

  $effect(() => {
    const current = peer;
    loadSeq += 1;
    const seq = loadSeq;
    thread = null;
    error = '';
    punishArmed = false;
    void load(current, seq);
    const unsubscribe = client.subscribe((event) => {
      if (event.type === 'message' && event.message.threadId === thread?.id) {
        void load(current, seq);
      } else if (event.type === 'contacts') {
        void load(current, seq);
      }
    });
    return () => {
      unsubscribe();
    };
  });

  $effect(() => {
    if (error) errorNode?.focus();
  });

  async function send() {
    const text = draft.trim();
    if (!text || sendBusy || actionBusy !== null) return;
    const current = peer;
    sendBusy = true;
    error = '';
    try {
      await client.sendMessage(current, text);
      draft = '';
      await load(current, loadSeq);
    } catch (e) {
      error = e instanceof Error ? e.message : t.sendFailed;
    } finally {
      sendBusy = false;
    }
  }

  async function runAction(kind: 'close' | 'block' | 'punish' | 'reopen') {
    if (actionBusy !== null || sendBusy) return;
    const current = peer;
    actionBusy = kind;
    error = '';
    try {
      if (kind === 'close') await client.closeConversation(current);
      else if (kind === 'block') await client.blockMember(current);
      else if (kind === 'punish') await client.punishConversation(current);
      else await client.requestReopen(current);
      punishArmed = false;
      await load(current, loadSeq);
    } catch (e) {
      error = e instanceof Error ? e.message : t.actionFailed;
    } finally {
      actionBusy = null;
    }
  }

  function stateLabel(state: string): string {
    if (state === 'queued') return t.queuedLabel;
    if (state === 'stored') return t.storedLabel;
    return t.receivedLabel;
  }
</script>

<section class="page" aria-labelledby="chat-title">
  <h1 id="chat-title">{thread?.peerHandle ?? t.title}</h1>
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
    <div tabindex="-1" bind:this={errorNode}>
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
      <label class="muted" for="composer" style="position:absolute;left:-9999px;">{t.messageLabel}</label>
      <input
        id="composer"
        value={draft}
        oninput={(e) => (draft = e.currentTarget.value)}
        placeholder={t.messageLabel}
        autocomplete="off"
        maxlength="2000"
        disabled={!isOpen || busy}
      />
      <Button type="submit" variant="primary" busy={sendBusy} busyLabel={t.sending} disabled={!isOpen || busy}>
        {t.send}
      </Button>
    </form>
    <div class="row" style="margin-top: 0.75rem;">
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
      {#if !punishArmed}
        <Button variant="danger" disabled={busy} onclick={() => { punishArmed = true; }}>
          {t.punishAction}
        </Button>
      {/if}
    </div>
    {#if punishArmed}
      <div role="group" aria-label={t.punishAction} style="margin-top: 0.75rem;">
        <Notice tone="warning">{t.punishCost}</Notice>
        <div class="row">
          <Button
            variant="danger"
            busy={actionBusy === 'punish'}
            busyLabel={t.working}
            onclick={() => void runAction('punish')}
          >
            {t.confirmPunish}
          </Button>
          <Button disabled={actionBusy !== null} onclick={() => { punishArmed = false; }}>
            {t.cancel}
          </Button>
        </div>
      </div>
    {/if}
  {:else if !error}
    <p aria-live="polite">{t.loading}</p>
  {/if}
</section>
