<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, DiscoveryFilter, ProfileSchema, PublicCard } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, EmptyState, PublicCard as Card } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let schema: ProfileSchema | null = $state(null);
  let filters: DiscoveryFilter[] = $state([]);
  let entries: PublicCard[] = $state([]);
  let busy = $state(false);
  let error = $state('');
  let keyNote = $state('');

  onMount(() => {
    void (async () => {
      try {
        schema = await client.schema();
        await search();
      } catch (e) {
        error = e instanceof Error ? e.message : 'Discovery is unavailable right now.';
      }
    })();
  });

  function setFilter(field: string, patch: Partial<DiscoveryFilter> | null) {
    const rest = filters.filter((f) => f.field !== field);
    filters = patch ? [...rest, { field, ...patch }] : rest;
    void search();
  }

  async function search() {
    error = '';
    busy = true;
    try {
      const page = await client.discover(filters);
      entries = page.entries;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Discovery is unavailable right now.';
    } finally {
      busy = false;
    }
  }

  async function wantToKnowMore(memberId: string) {
    keyNote = '';
    error = '';
    try {
      const result = await client.requestPrivateKey(memberId);
      if (result.status === 'accepted') {
        keyNote = 'Key accepted. You shared your key first, so they can look back at you.';
      } else {
        keyNote = `Not a match on: ${result.failingField ?? 'a field'}. They never see your rules or values.`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'The key request did not work.';
    }
  }
</script>

<section class="page" aria-labelledby="forum-title">
  <div class="row" style="justify-content: space-between;">
    <div>
      <h1 id="forum-title">{en.forum.title}</h1>
      <p class="muted">Filters work both ways on real values. Public-card views stay private.</p>
    </div>
    <Button {busy} busyLabel="Searching…" onclick={() => void search()}>{en.common.refresh}</Button>
  </div>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if keyNote}<Notice tone="info">{keyNote}</Notice>{/if}
  {#if schema}
    <form aria-label={en.forum.filters} onsubmit={(e) => { e.preventDefault(); void search(); }}>
      <div class="field-row">
        {#each schema.fields.filter((f) => f.filterable) as field}
          {#if field.kind === 'choice'}
            <TextField
              id="filter-{field.key}"
              label={field.question}
              value={String(filters.find((f) => f.field === field.key)?.equals?.[0] ?? '')}
              choices={field.choices}
              oninput={(v) => setFilter(field.key, v ? { equals: [v] } : null)}
            />
          {:else if field.kind === 'number'}
            <TextField
              id="filter-{field.key}-min"
              label={`${field.question} (from)`}
              type="number"
              value={filters.find((f) => f.field === field.key)?.min ?? ''}
              min={field.min}
              max={field.max}
              oninput={(v) => {
                const current = filters.find((f) => f.field === field.key);
                setFilter(field.key, v === '' && current?.max === undefined ? null : { equals: current?.equals, min: v === '' ? undefined : Number(v), max: current?.max });
              }}
            />
            <TextField
              id="filter-{field.key}-max"
              label={`${field.question} (to)`}
              type="number"
              value={filters.find((f) => f.field === field.key)?.max ?? ''}
              min={field.min}
              max={field.max}
              oninput={(v) => {
                const current = filters.find((f) => f.field === field.key);
                setFilter(field.key, v === '' && current?.min === undefined ? null : { equals: current?.equals, min: current?.min, max: v === '' ? undefined : Number(v) });
              }}
            />
          {/if}
        {/each}
      </div>
    </form>
  {/if}
  {#if !busy && entries.length === 0}
    <EmptyState title={en.forum.empty} hint="Members appear while they are online." />
  {:else}
    <div class="grid">
      {#each entries as entry (entry.memberId)}
        <Card card={entry} actionLabel={en.forum.wantToKnowMore} onaction={(id) => void wantToKnowMore(id)} />
      {/each}
    </div>
  {/if}
</section>
