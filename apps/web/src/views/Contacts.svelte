<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, Contact } from '../../../../core/src/cmsg.js';
  import { Button, Notice, EmptyState } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let contacts: Contact[] = $state([]);
  let error = $state('');

  async function load() {
    try {
      contacts = await client.contacts();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Contacts are unavailable right now.';
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'contacts') contacts = event.contacts;
    });
  });

  async function toggleBlock(contact: Contact) {
    error = '';
    try {
      if (contact.blockedByMe) await client.unblockMember(contact.memberId);
      else await client.blockMember(contact.memberId);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not work. Try again.';
    }
  }
</script>

<section class="page" aria-labelledby="contacts-title">
  <h1 id="contacts-title">{en.contacts.title}</h1>
  <p class="muted">Seeing contacts online is peer to peer here; the forum never keeps your contact list. Blocking hides you in the forum while you are online; your devices remember the block.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if contacts.length === 0}
    <EmptyState title="No contacts yet" hint="Answer a wave and the conversation starts here." />
  {:else}
    <ul class="gate-list">
      {#each contacts as contact (contact.memberId)}
        <li>
          <span>
            <strong>{contact.handle}</strong><br />
            <small class="muted">{contact.online ? en.common.online : en.common.offline} · {contact.relation}</small>
          </span>
          <span class="row">
            <Button onclick={() => (window.location.hash = `#/chat/${encodeURIComponent(contact.memberId)}`)}>Open chat</Button>
            <Button variant={contact.blockedByMe ? 'secondary' : 'danger'} onclick={() => void toggleBlock(contact)}>
              {contact.blockedByMe ? en.contacts.unblock : en.contacts.block}
            </Button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
