<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, Thread } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
    peer: string;
  }
  let { client, peer }: Props = $props();

  let thread: Thread | null = $state(null);
  let draft = $state('');
  let busy = $state(false);
  let error = $state('');

  async function load() {
    try {
      thread = await client.thread(peer);
    } catch (e) {
      error = e instanceof Error ? e.message : 'This conversation is unavailable.';
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'message' && event.message.threadId === thread?.id) void load();
    });
  });

  async function send() {
    const text = draft.trim();
    if (!text) return;
    busy = true;
    error = '';
    try {
      await client.sendMessage(peer, text);
      draft = '';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'The message did not go out.';
    } finally {
      busy = false;
    }
  }

  async function block() {
    try {
      await client.blockMember(peer);
      window.location.hash = '#/contacts';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Blocking did not work.';
    }
  }

  function stateLabel(state: string): string {
    if (state === 'queued') return 'Queued on your device';
    if (state === 'stored') return 'Stored for delivery';
    return 'Received';
  }
</script>

<section class="page" aria-labelledby="chat-title">
  <h1 id="chat-title">{thread?.peerHandle ?? en.chat.title}</h1>
  {#if thread && !thread.established}
    <Notice tone="info">Waiting for the introduction to complete. Established conversations are unmetered.</Notice>
  {/if}
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if thread}
    <ul class="thread" aria-live="polite" aria-label="Messages">
      {#each thread.messages as message (message.id)}
        <li class="bubble" class:out={message.outgoing}>
          <div>{message.text}</div>
          <div class="meta">{stateLabel(message.state)}</div>
        </li>
      {/each}
    </ul>
    {#if thread.messages.length === 0}<p class="muted">No messages yet. Say hello.</p>{/if}
    <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
      <label class="muted" for="composer" style="position:absolute;left:-9999px;">{en.chat.messageLabel}</label>
      <input id="composer" value={draft} oninput={(e) => (draft = e.currentTarget.value)} placeholder={en.chat.messageLabel} autocomplete="off" maxlength="2000" />
      <Button type="submit" variant="primary" {busy} busyLabel="Sending…">{en.chat.send}</Button>
    </form>
    <div class="row" style="margin-top: 0.75rem;">
      <Button variant="danger" onclick={() => void block()}>{en.contacts.block}</Button>
    </div>
  {:else if !error}
    <p aria-live="polite">{en.common.loading}</p>
  {/if}
</section>
