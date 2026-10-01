<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, RootCommunity } from '../../../../core/src/cmsg.js';
  import { Notice } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let communities: RootCommunity[] = $state([]);
  let selected: string | null = $state(null);
  let error = $state('');

  onMount(() => {
    void client
      .rootCommunities()
      .then((list) => {
        communities = list;
        selected = list[0]?.communityId ?? null;
      })
      .catch((e: Error) => (error = e.message));
  });
</script>

<section class="page" aria-labelledby="root-title">
  <h1 id="root-title">{en.root.title}</h1>
  <p class="muted">Godmode selects a community and may override admins. It acts on settings and admins, never on members. Admin and root calls travel through cmsg and Foyer.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  <ul class="gate-list">
    {#each communities as community (community.communityId)}
      <li>
        <span>{community.displayName}</span>
        <button
          class="select-btn"
          aria-pressed={selected === community.communityId}
          onclick={() => (selected = community.communityId)}
        >{selected === community.communityId ? 'Selected' : 'Select'}</button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .select-btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.5rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
  }
  .select-btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
</style>
