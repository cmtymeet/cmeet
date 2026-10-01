<script lang="ts">
  import type { CmsgClient, RootCommunity } from '../../../../core/src/cmsg.js';
  import { Notice, Button } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let communities: RootCommunity[] = $state([]);
  let selected: string | null = $state(null);
  let error = $state('');

  let signedIn = $state(false);
  let busy = $state(false);
  async function signIn() {
    if (busy) return;
    busy = true; error = '';
    try {
      await client.signInRole('root');
      communities = await client.rootCommunities();
      selected = communities[0]?.communityId ?? null;
      signedIn = true;
    } catch (e) { error = e instanceof Error ? e.message : 'Sign-in did not work.'; }
    finally { busy = false; }
  }
</script>

<section class="page" aria-labelledby="root-title">
  <h1 id="root-title">{en.root.title}</h1>
  <p class="muted">Select a community to manage its settings and admins. Sign in with your passkey to enter this portal.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if !signedIn}<Button {busy} onclick={() => void signIn()}>Sign in as root</Button>{/if}
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
