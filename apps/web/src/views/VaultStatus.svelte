<script lang="ts">
  import { onMount } from 'svelte';
  import type { CeremonyState, CmsgClient } from '../../../../core/src/cmsg.js';
  import { browserStrings as t } from '../strings/browser.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();
  let state = $state<CeremonyState>('idle');

  onMount(() => {
    return client.subscribe((event) => {
      if (event.type === 'ceremony') state = event.status.state;
    });
  });
</script>

<div role="status" class="vault-status">{#if state !== 'idle'}{t.memberStatus[state]}{/if}</div>

<style>
  .vault-status:empty { display: none; }
  .vault-status { padding: 0.5rem 1rem; background: var(--cmeet-accent-soft); }
</style>
