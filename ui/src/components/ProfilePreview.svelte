<script lang="ts">
  import { memberName } from '../member-name.js';
  // Flashcard preview: public front, private back. No pictures by decision.
  import SegmentedControl from './SegmentedControl.svelte';
  import type { ProfileSchema, ProfileValues } from '../../../core/src/cmsg.js';
  interface Props {
    schema: ProfileSchema;
    values: ProfileValues;
    handle?: string;
    frontLabel?: string;
    backLabel?: string;
  }
  let { schema, values, handle, frontLabel = 'Front: public profile', backLabel = 'Back: private profile' }: Props = $props();
  let side: 'front' | 'back' = $state('front');

  const publicFields = $derived(schema.fields.filter((f) => f.visibility === 'public'));
  const privateFields = $derived(schema.fields.filter((f) => f.visibility === 'private'));

  const nameField = $derived(publicFields.find((field) => field.shownAsName));
  const nameValue = $derived(nameField ? values[nameField.key] : undefined);

  function show(value: ProfileValues[string] | undefined): string {
    if (value === undefined || value === '') return '—';
    return typeof value === 'object' ? `${value.latitude}, ${value.longitude}` : String(value);
  }
</script>

<div class="flashcard">
  {#if handle}<p class="identity">{memberName(handle, typeof nameValue === 'string' ? nameValue : undefined)}</p>{/if}
  <div class="tabs">
    <SegmentedControl
      label="Profile preview side"
      options={[
        { value: 'front' as const, label: frontLabel },
        { value: 'back' as const, label: backLabel },
      ]}
      current={side}
      onselect={(value) => (side = value)}
    />

  </div>
  {#if side === 'front'}
    <section aria-label={frontLabel}>
      <dl>
        {#each publicFields as field}
          <div><dt>{field.question}</dt><dd>{show(values[field.key])}</dd></div>
        {/each}
      </dl>
    </section>
  {:else}
    <section aria-label={backLabel}>
      <dl>
        {#each privateFields as field}
          <div><dt>{field.question}</dt><dd>{show(values[field.key])}</dd></div>
        {/each}
      </dl>
      {#if privateFields.length === 0}<p class="muted">Nothing private yet.</p>{/if}
    </section>
  {/if}
</div>

<style>
  .flashcard { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 1rem; background: var(--cmeet-surface); }
  .tabs { margin-bottom: 0.75rem; }
  dl { display: grid; gap: 0.6rem; margin: 0; }
  dt { font-size: 0.85rem; color: var(--cmeet-muted); }
  dd { margin: 0; font-weight: 600; }
  .muted { color: var(--cmeet-muted); }
</style>
