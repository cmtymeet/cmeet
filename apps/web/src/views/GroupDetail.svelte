<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, GroupView } from '../../../../core/src/cmsg.js';
  import { Button, Notice, LevelBadge } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
    id: string;
  }
  let { client, id }: Props = $props();

  let group: GroupView | null = $state(null);
  let draft = $state('');
  let error = $state('');
  let forkNote = $state('');

  async function load() {
    try {
      const groups = await client.groups();
      group = groups.find((g) => g.id === id) ?? null;
      if (!group) error = 'This group is not available.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'This group is unavailable.';
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'groups') {
        const next = event.groups.find((g) => g.id === id);
        if (next) group = next;
      }
    });
  });

  async function send() {
    const text = draft.trim();
    if (!text || !group) return;
    try {
      await client.sendGroupMessage(group.id, text);
      draft = '';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'The message did not go out.';
    }
  }

  async function fork(kind: 'exit' | 'split') {
    if (!group) return;
    forkNote = '';
    try {
      const next = await client.proposeFork({
        groupId: group.id,
        kind,
        label: kind === 'exit' ? 'Exit fork' : 'Split proposal',
        detail: 'Each mover chooses; nonmovers keep the original group.',
      });
      forkNote = `Fork created as “${next.name}”. Earlier history stays with you.`;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'The fork did not work.';
    }
  }
</script>

<section class="page" aria-labelledby="group-title">
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if group}
    <p><a href="#/groups">← {en.groups.title}</a></p>
    <h1 id="group-title">{group.name}</h1>
    <p class="row"><LevelBadge level={group.level} labels={en.groups.level} /> <span class="muted">{group.size} members</span></p>
    <p>{group.description}</p>
    <p><strong>{en.groups.whatChangesNext}:</strong> {group.whatChangesNext}</p>
    {#if group.suggestion}<Notice tone="info">{group.suggestion}</Notice>{/if}
    {#if group.level === 'room'}
      <Notice tone="info">Joining means consenting to members seeing each other's private profiles. Look-back and blocking still work.</Notice>
    {/if}
    <p class="muted">{group.newcomerHistory}</p>
    {#if forkNote}<Notice tone="success">{forkNote}</Notice>{/if}

    {#if group.joined}
      <ul class="thread" aria-live="polite" aria-label="Group messages">
        {#each group.messages as message (message.id)}
          <li class="bubble" class:out={message.outgoing}><div>{message.text}</div></li>
        {/each}
      </ul>
      {#if group.messages.length === 0}<p class="muted">Quiet here so far.</p>{/if}
      <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
        <label for="group-composer" style="position:absolute;left:-9999px;">{en.chat.messageLabel}</label>
        <input id="group-composer" value={draft} oninput={(e) => (draft = e.currentTarget.value)} placeholder={en.chat.messageLabel} autocomplete="off" maxlength="2000" />
        <Button type="submit" variant="primary">{en.chat.send}</Button>
      </form>
      <div class="row" style="margin-top: 0.75rem;">
        <Button onclick={() => void fork('exit')}>Propose an exit fork</Button>
        <Button onclick={() => void fork('split')}>Suggest a split</Button>
      </div>
    {:else}
      <p>This group is hidden until you join; each mover chooses.</p>
    {/if}
  {:else if !error}
    <p aria-live="polite">{en.common.loading}</p>
  {/if}
</section>
