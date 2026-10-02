<script lang="ts">
  import { Button } from '../../../../ui/src/index.js';
  import { browserStrings as t } from '../strings/browser.js';

  interface Props {
    /** Null in production: the runtime-owned ceremony is not wired yet. */
    answer: ((status: 'approved' | 'cancelled') => void) | null;
    nonce: string;
  }
  let { answer, nonce }: Props = $props();
</script>

<svelte:head><title>cmeet · {t.popupTitle}</title></svelte:head>

<main class="popup">
  <h1>{t.popupTitle}</h1>
  {#if answer === null}
    <p>{t.popupUnavailable}</p>
  {:else if nonce === ''}
    <p>{t.popupMissing}</p>
  {:else}
    <p>{t.popupFixtureNote}</p>
    <div class="row">
      <Button variant="primary" onclick={() => answer('approved')}>{t.popupApprove}</Button>
      <Button onclick={() => answer('cancelled')}>{t.popupCancel}</Button>
    </div>
  {/if}
</main>

<style>
  .popup { padding: 1rem; font-family: system-ui, sans-serif; }
  .row { display: flex; gap: 0.5rem; }
</style>
