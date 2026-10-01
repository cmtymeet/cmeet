<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, ProfileSchema, SchemaField } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, ProfilePreview } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let schema: ProfileSchema | null = $state(null);
  let impact = $state('');
  let error = $state('');
  let dragging: string | null = $state(null);

  const sample = { age: 34, neighbourhood: 'North', weekend: 'Hiking', lookingFor: 'Friendship', about: 'Hello.' };

  onMount(() => {
    void client
      .adminSchema()
      .then((s) => (schema = s))
      .catch((e: Error) => (error = e.message));
  });

  function move(key: string, direction: -1 | 1) {
    if (!schema) return;
    const index = schema.fields.findIndex((f) => f.key === key);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= schema.fields.length) return;
    const fields = [...schema.fields];
    const [field] = fields.splice(index, 1);
    fields.splice(next, 0, field!);
    schema = { ...schema, fields };
  }

  function patch(key: string, patch: Partial<SchemaField>) {
    if (!schema) return;
    schema = { ...schema, fields: schema.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) };
  }

  function onDrop(targetKey: string) {
    if (!schema || !dragging || dragging === targetKey) return;
    const fields = schema.fields.filter((f) => f.key !== dragging);
    const at = fields.findIndex((f) => f.key === targetKey);
    const moved = schema.fields.find((f) => f.key === dragging);
    if (!moved || at < 0) return;
    fields.splice(at, 0, moved);
    schema = { ...schema, fields };
    dragging = null;
  }

  async function save() {
    if (!schema) return;
    error = '';
    impact = '';
    try {
      const result = await client.adminSaveSchema($state.snapshot(schema));
      impact = `${result.note} Profiles needing changes: ${result.profilesNeedingChanges}.`;
      schema = await client.adminSchema();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Saving the schema did not work.';
    }
  }
</script>

<section class="page" aria-labelledby="admin-title">
  <h1 id="admin-title">{en.admin.title}</h1>
  <p class="muted">Drag questions to order them, or use the move buttons. The preview on the right always shows the member view: public front, private back.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if impact}<Notice tone="info">{impact}</Notice>{/if}
  {#if schema}
    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));">
      <div>
        <h2>Profile questions</h2>
        {#each schema.fields as field, i (field.key)}
          <div
            class="schema-row"
            class:dragging={dragging === field.key}
            draggable="true"
            role="listitem"
            aria-label={`Question ${i + 1}: ${field.question}`}
            ondragstart={() => (dragging = field.key)}
            ondragend={() => (dragging = null)}
            ondragover={(e) => e.preventDefault()}
            ondrop={() => onDrop(field.key)}
          >
            <span class="muted" aria-hidden="true">⋮⋮</span>
            <span style="flex:1;">{field.question} <small class="muted">({field.kind}, {field.visibility})</small></span>
            <Button onclick={() => move(field.key, -1)}>↑</Button>
            <Button onclick={() => move(field.key, 1)}>↓</Button>
          </div>
          <details>
            <summary>Answer style</summary>
            <TextField
              id="kind-{field.key}"
              label="Answer style"
              value={field.kind}
              choices={['choice', 'number', 'yes-no', 'location', 'short-text', 'long-text']}
              oninput={(v) => patch(field.key, { kind: v as SchemaField['kind'] })}
            />
            <TextField
              id="vis-{field.key}"
              label="Visibility"
              value={field.visibility}
              choices={['public', 'private']}
              oninput={(v) => patch(field.key, { visibility: v as SchemaField['visibility'] })}
            />
          </details>
        {/each}
        <div class="row" style="margin-top: 0.75rem;">
          <Button variant="primary" onclick={() => void save()}>{en.admin.save}</Button>
        </div>
      </div>
      <div>
        <h2>{en.admin.preview}</h2>
        <ProfilePreview {schema} values={sample} frontLabel={en.profile.previewFront} backLabel={en.profile.previewBack} />
      </div>
    </div>
  {:else if !error}
    <p aria-live="polite">{en.common.loading}</p>
  {/if}
</section>
