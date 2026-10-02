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

  async function load() {
    const request = ++generation;
    try {
      const next = await client.contacts();
      if (!alive || request !== generation) return;
      contacts = next;
      loaded = true;
    } catch (e) {
      if (alive && request === generation) {
        // Preserve the existing list; report the failure plainly.
        error = e instanceof Error ? e.message : s.failed;
        loaded = true;
      }
    }
  }

  onMount(() => {
    void load();
    const stop = client.subscribe((event) => {
      if (!alive) return;
      if (event.type === 'contacts') {
        contacts = event.contacts;
        loaded = true;
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

  function isBusy(peer: string): boolean {
    return busyPeer === peer && busyKind !== '';
  }

  async function block(peer: string) {
    if (busyKind !== '') return;
    error = '';
    busyPeer = peer;
    busyKind = 'block';
    try {
      await client.blockMember(peer);
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

  async function unblock(peer: string) {
    if (busyKind !== '') return;
    error = '';
    busyPeer = peer;
    busyKind = 'unblock';
    try {
      // Unblocking only returns a closed relation; it never opens chat.
      await client.unblockMember(peer);
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

  async function reopen(peer: string) {
    if (busyKind !== '') return;
    error = '';
    busyPeer = peer;
    busyKind = 'reopen';
    try {
      await client.requestReopen(peer);
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
    <p role="status">{s.loading}</p>
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
            <Button onclick={() => openChat(contact.memberId)} disabled={isBusy(contact.memberId)}>
              {s.openChat}
            </Button>
            {#if contact.blockedByMe || contact.relation === 'blocked'}
              <Button
                variant="secondary"
                disabled={isBusy(contact.memberId)}
                onclick={() => void unblock(contact.memberId)}
              >
                {busyPeer === contact.memberId && busyKind === 'unblock' ? s.unblockBusy : s.unblock}
              </Button>
            {:else}
              <Button
                variant="danger"
                disabled={isBusy(contact.memberId)}
                onclick={() => void block(contact.memberId)}
              >
                {busyPeer === contact.memberId && busyKind === 'block' ? s.blockBusy : s.block}
              </Button>
            {/if}
            {#if !contact.blockedByMe && contact.relation === 'closed'}
              <Button
                variant="primary"
                disabled={isBusy(contact.memberId)}
                onclick={() => void reopen(contact.memberId)}
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
