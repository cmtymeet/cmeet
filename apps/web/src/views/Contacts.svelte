<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, Contact, RelationState } from '../../../../core/src/cmsg.js';
  import { Button, Notice, EmptyState } from '../../../../ui/src/index.js';
  import { contactsStrings as s } from '../strings/contacts.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let contacts: Contact[] = $state([]);
  let loaded = $state(false);
  let error = $state('');
  let busyPeer = $state('');
  let busyKind = $state<'' | 'block' | 'unblock' | 'reopen'>('');
  let generation = 0;
  let alive = true;

  // One action at a time across the whole list; every mutation button reflects
  // it while explicit open-chat navigation stays available.
  let busy = $derived(busyKind !== '');

  async function load() {
    const request = ++generation;
    try {
      const next = await client.contacts();
      if (!alive || request !== generation) return;
      contacts = next;
      loaded = true;
      error = '';
    } catch (e) {
      if (alive && request === generation) {
        // Preserve the existing list. When nothing loaded yet, keep
        // loaded=false so the view shows the error with retry, never a
        // successful-looking empty state.
        error = e instanceof Error ? e.message : s.failed;
      }
    }
  }

  onMount(() => {
    void load();
    const stop = client.subscribe((event) => {
      if (!alive) return;
      if (event.type === 'contacts') {
        // The event is newer than any in-flight load; invalidate those
        // generations so a stale response cannot restore old relationships.
        generation += 1;
        contacts = event.contacts;
        loaded = true;
        error = '';
      }
    });
    return () => {
      alive = false;
      generation += 1;
      stop();
    };
  });

  function statusOf(contact: Contact): string {
    if (contact.blockedByMe || contact.relation === 'blocked') return s.statusBlocked;
    const relation: RelationState = contact.relation;
    if (relation === 'established') return s.statusEstablished;
    if (relation === 'closed') return s.statusClosed;
    if (relation === 'pending') return s.statusPending;
    return s.statusUnknown;
  }

  function presenceOf(contact: Contact): string {
    // Presence is rendered only from the cmsg contact; never invented.
    return contact.online ? s.online : s.offline;
  }

  type MutationKind = 'block' | 'unblock' | 'reopen';

  async function mutate(peer: string, kind: MutationKind) {
    if (busyKind !== '') return;
    error = '';
    busyPeer = peer;
    busyKind = kind;
    try {
      // Unblocking only returns a closed relation; reopening is an explicit
      // separate step. Neither ever opens chat; chat opens only on explicit
      // user navigation.
      if (kind === 'block') await client.blockMember(peer);
      else if (kind === 'unblock') await client.unblockMember(peer);
      else await client.requestReopen(peer);
      // No follow-up load after unmount: the subscriber is gone and any
      // refresh would be discarded anyway.
      if (!alive) return;
      await load();
    } catch (e) {
      if (alive) error = e instanceof Error ? e.message : s.actionFailed;
    } finally {
      if (alive) {
        busyPeer = '';
        busyKind = '';
      }
    }
  }

  function openChat(peer: string) {
    window.location.hash = `#/chat/${encodeURIComponent(peer)}`;
  }
</script>

<section class="page" aria-labelledby="contacts-title">
  <h1 id="contacts-title">{s.title}</h1>
  <p class="muted">{s.lead}</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if !loaded}
    {#if error}
      <div class="row"><Button onclick={() => void load()}>{s.retry}</Button></div>
    {:else}
      <p role="status">{s.loading}</p>
    {/if}
  {:else if contacts.length === 0}
    <EmptyState title={s.empty} hint={s.emptyHint} />
    <div class="row"><Button onclick={() => void load()}>{s.refresh}</Button></div>
  {:else}
    <ul class="gate-list">
      {#each contacts as contact (contact.memberId)}
        <li>
          <span>
            <strong>{contact.handle}</strong><br />
            <small class="muted">{presenceOf(contact)} · {statusOf(contact)}</small>
            {#if contact.blockedByMe || contact.relation === 'blocked'}
              <br /><small class="muted">{s.blockedNote}</small>
            {:else if contact.relation === 'closed'}
              <br /><small class="muted">{s.closedNote}</small>
            {:else if contact.relation === 'pending'}
              <br /><small class="muted">{s.pendingNote}</small>
            {/if}
          </span>
          <span class="row">
            <Button onclick={() => openChat(contact.memberId)}>
              {s.openChat}
            </Button>
            {#if contact.blockedByMe || contact.relation === 'blocked'}
              <Button
                variant="secondary"
                disabled={busy}
                onclick={() => void mutate(contact.memberId, 'unblock')}
              >
                {busyPeer === contact.memberId && busyKind === 'unblock' ? s.unblockBusy : s.unblock}
              </Button>
            {:else}
              <Button
                variant="danger"
                disabled={busy}
                onclick={() => void mutate(contact.memberId, 'block')}
              >
                {busyPeer === contact.memberId && busyKind === 'block' ? s.blockBusy : s.block}
              </Button>
            {/if}
            {#if !contact.blockedByMe && contact.relation === 'closed'}
              <Button
                variant="primary"
                disabled={busy}
                onclick={() => void mutate(contact.memberId, 'reopen')}
              >
                {busyPeer === contact.memberId && busyKind === 'reopen' ? s.reopenBusy : s.requestReopen}
              </Button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    <div class="row"><Button onclick={() => void load()}>{s.refresh}</Button></div>
  {/if}
</section>
