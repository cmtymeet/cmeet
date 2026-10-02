<script lang="ts">
  import { onMount } from 'svelte';
  import type { CeremonyState } from '../../../../core/src/cmsg.js';
  import { Button } from '../../../../ui/src/index.js';
  import { browserStrings as t } from '../strings/browser.js';

  interface Props {
    /** Null when no runtime is wired: the frame is honestly unavailable. */
    ceremony: { continueInPopup(): void } | null;
    watch: (listener: (state: CeremonyState) => void) => void;
  }
  let { ceremony, watch }: Props = $props();
  let state = $state<CeremonyState>('idle');

  onMount(() => {
    watch((next) => { state = next; });
  });

  const canContinue = $derived(state === 'continue-needed' || state === 'blocked' || state === 'cancelled');
</script>

<svelte:head><title>cmeet · {t.vaultTitle}</title></svelte:head>

<main class="vault">
  <h1>{t.vaultTitle}</h1>
  {#if ceremony === null}
    <p>{t.vaultUnavailable}</p>
  {:else}
    <p aria-live="polite">{state === 'idle' ? t.vaultIdle : t.states[state]}</p>
    {#if canContinue}
      <!-- The pop-up must open from a real click inside this vault-origin frame. -->
      <Button variant="primary" onclick={() => ceremony.continueInPopup()}>
        {state === 'continue-needed' ? t.vaultContinue : t.vaultRetry}
      </Button>
    {/if}
  {/if}
</main>

<style>
  .vault { padding: 0.75rem; font-family: system-ui, sans-serif; }
  h1 { font-size: 1rem; margin: 0 0 0.25rem; }
  p { margin: 0 0 0.5rem; }
</style>
