<script lang="ts">
  // Flashcard preview: public front, private back. No pictures by decision.
  import type { ProfileSchema, ProfileValues } from '../../../core/src/cmsg.js';
  interface Props {
    schema: ProfileSchema;
    values: ProfileValues;
    frontLabel?: string;
    backLabel?: string;
  }
  let { schema, values, frontLabel = 'Front: public profile', backLabel = 'Back: private profile' }: Props = $props();
  let side: 'front' | 'back' = $state('front');

  const publicFields = $derived(schema.fields.filter((f) => f.visibility === 'public'));
  const privateFields = $derived(schema.fields.filter((f) => f.visibility === 'private'));

  function show(value: unknown): string {
    if (value === undefined || value === '') return '—';
    return String(value);
  }
</script>

<div class="flashcard">
  <div class="segmented" role="tablist" aria-label="Profile preview side">
    <button role="tab" aria-selected={side === 'front'} class:active={side === 'front'} onclick={() => (side = 'front')}>{frontLabel}</button>
    <button role="tab" aria-selected={side === 'back'} class:active={side === 'back'} onclick={() => (side = 'back')}>{backLabel}</button>
  </div>
  {#if side === 'front'}
    <dl role="tabpanel" aria-label={frontLabel}>
      {#each publicFields as field}
        <div><dt>{field.question}</dt><dd>{show(values[field.key])}</dd></div>
      {/each}
    </dl>
  {:else}
    <dl role="tabpanel" aria-label={backLabel}>
      {#each privateFields as field}
        <div><dt>{field.question}</dt><dd>{show(values[field.key])}</dd></div>
      {/each}
      {#if privateFields.length === 0}<p class="muted">Nothing private yet.</p>{/if}
    </dl>
  {/if}
</div>

<style>
  .flashcard { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 1rem; background: var(--cmeet-surface); }
  .segmented { display: inline-flex; border: 1px solid var(--cmeet-line); border-radius: 999px; overflow: hidden; margin-bottom: 0.75rem; }
  .segmented button { font: inherit; border: 0; background: transparent; color: var(--cmeet-ink); padding: 0.45rem 0.9rem; cursor: pointer; }
  .segmented button.active { background: var(--cmeet-accent); color: var(--cmeet-accent-ink); }
  .segmented button:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: -3px; }
  dl { display: grid; gap: 0.6rem; margin: 0; }
  dt { font-size: 0.85rem; color: var(--cmeet-muted); }
  dd { margin: 0; font-weight: 600; }
  .muted { color: var(--cmeet-muted); }
</style>
