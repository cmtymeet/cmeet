<script lang="ts">
  import type { CmsgClient, ProfileSchema, ProfileValues, SchemaField } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, ProfilePreview } from '../../../../ui/src/index.js';
  import { adminSchemaStrings as s } from '../strings/admin-schema.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();
  let schema: ProfileSchema | null = $state(null);
  let impact = $state('');
  let error = $state('');
  let dragging: string | null = $state(null);
  let signedIn = $state(false);
  let signingIn = $state(false);
  let saving = $state(false);
  let draftCounter = $state(1);
  let sampleValues: ProfileValues = $state({});
  let errorRegion: HTMLElement | null = $state(null);

  $effect(() => {
    if (error && errorRegion) errorRegion.focus();
  });

  async function signIn() {
    if (signingIn) return;
    error = '';
    impact = '';
    signingIn = true;
    try {
      await client.signInRole('admin');
      signedIn = true;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : s.signInHelp;
    } finally {
      signingIn = false;
    }
  }

  async function load() {
    error = '';
    try {
      schema = await client.adminSchema();
    } catch (e) {
      error = e instanceof Error ? e.message : s.loadFailed;
    }
  }

  function move(key: string, direction: -1 | 1) {
    if (!schema) return;
    const index = schema.fields.findIndex((f) => f.key === key);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= schema.fields.length) return;
    const fields = [...schema.fields];
    const [field] = fields.splice(index, 1);
    fields.splice(next, 0, field!);
    schema = { ...schema, fields };
    impact = '';
  }

  function patch(key: string, patch: Partial<SchemaField>) {
    if (!schema) return;
    schema = { ...schema, fields: schema.fields.map((field) => {
      if (field.key !== key) return field;
      const next = { ...field, ...patch };
      if (next.visibility !== 'public' || !['short-text', 'long-text'].includes(next.kind)) next.shownAsName = false;
      return next;
    }) };
    impact = '';
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
    impact = '';
  }

  function addQuestion() {
    if (!schema) return;
    const taken = new Set(schema.fields.map((f) => f.key));
    let key = `draft-${draftCounter++}`;
    while (taken.has(key)) key = `draft-${draftCounter++}`;
    const field: SchemaField = {
      key,
      question: s.newQuestionDefault,
      kind: 'short-text',
      visibility: 'private',
      required: false,
      filterable: false,
      shownAsName: false,
    };
    schema = { ...schema, fields: [...schema.fields, field] };
    impact = '';
    error = '';
  }

  function removeQuestion(key: string) {
    if (!schema) return;
    schema = { ...schema, fields: schema.fields.filter((f) => f.key !== key) };
    const next = { ...sampleValues };
    delete next[key];
    sampleValues = next;
    impact = '';
  }

  function setSample(key: string, kind: SchemaField['kind'], raw: string) {
    if (raw === '') {
      const next = { ...sampleValues };
      delete next[key];
      sampleValues = next;
      return;
    }
    if (kind === 'number') {
      const n = Number(raw);
      sampleValues = { ...sampleValues, [key]: Number.isNaN(n) ? raw : n };
      return;
    }
    if (kind === 'yes-no') {
      sampleValues = { ...sampleValues, [key]: raw === 'Yes' };
      return;
    }
    sampleValues = { ...sampleValues, [key]: raw };
  }

  function setCoordinate(key: string, part: 'latitude' | 'longitude', raw: string) {
    const previous = sampleValues[key];
    const coords = typeof previous === 'object' ? previous : { latitude: NaN, longitude: NaN };
    sampleValues = { ...sampleValues, [key]: { ...coords, [part]: raw === '' ? NaN : Number(raw) } };
  }

  function sampleText(key: string, kind: SchemaField['kind']): string {
    const value = sampleValues[key];
    if (value === undefined) return '';
    if (kind === 'yes-no') return value === true ? 'Yes' : value === false ? 'No' : String(value);
    return String(value);
  }

  function choicesText(field: SchemaField): string {
    return (field.choices ?? []).join(', ');
  }

  function setChoices(key: string, raw: string) {
    const choices = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    patch(key, { choices });
  }

  function setBound(key: string, bound: 'min' | 'max', raw: string) {
    if (raw.trim() === '') {
      patch(key, { [bound]: undefined } as Partial<SchemaField>);
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    patch(key, { [bound]: n } as Partial<SchemaField>);
  }

  async function save() {
    if (!schema || saving) return;
    error = '';
    impact = '';
    saving = true;
    try {
      const result = await client.adminSaveSchema($state.snapshot(schema));
      impact = s.impact(result.note, result.profilesNeedingChanges, result.grandfathered);
      schema = await client.adminSchema();
    } catch (e) {
      error = e instanceof Error ? e.message : s.saveFailed;
    } finally {
      saving = false;
    }
  }
</script>

<section class="page admin-schema" aria-labelledby="admin-title">
  <h1 id="admin-title">{s.title}</h1>
  <p class="muted">{s.lead}</p>
  {#if error}
    <div bind:this={errorRegion} tabindex="-1" class="error-focus">
      <Notice tone="error">{error}</Notice>
    </div>
  {/if}
  {#if impact}<Notice tone="info">{impact}</Notice>{/if}

  {#if !signedIn}
    <p class="muted">{s.signInHelp}</p>
    <Button variant="primary" busy={signingIn} busyLabel={s.signingIn} onclick={() => void signIn()}>
      {s.signIn}
    </Button>
  {:else if schema}
    <div class="admin-grid">
      <fieldset class="admin-editor" disabled={saving}>
        <h2>{s.questionsHeading}</h2>
        <p class="muted">{s.reorderHelp}</p>
        <ol class="schema-list">
          {#each schema.fields as field, i (field.key)}
            <li class="schema-item" aria-label={`Question ${i + 1}: ${field.question}`}>
              <div
                role="group"
                aria-label="Question order"
                class="schema-row"
                class:dragging={dragging === field.key}
                draggable="true"
                ondragstart={() => (dragging = field.key)}
                ondragend={() => (dragging = null)}
                ondragover={(e) => e.preventDefault()}
                ondrop={() => onDrop(field.key)}
              >
                <span class="grip" aria-hidden="true">⋮⋮</span>
                <span class="grow">{field.question} <small class="muted">({field.kind}, {field.visibility})</small></span>
                <Button onclick={() => move(field.key, -1)} disabled={i === 0}>↑ {s.moveUpLabel}</Button>
                <Button onclick={() => move(field.key, 1)} disabled={i === schema.fields.length - 1}>↓ {s.moveDownLabel}</Button>
              </div>
            <div class="field-editor">
              <TextField
                id="question-{field.key}"
                label={s.questionLabel}
                value={field.question}
                oninput={(v) => patch(field.key, { question: v })}
              />
              <TextField
                id="kind-{field.key}"
                label={s.answerStyleLabel}
                value={field.kind}
                choices={[...s.answerStyles]}
                oninput={(v) => patch(field.key, { kind: v as SchemaField['kind'] })}
              />
              <TextField
                id="vis-{field.key}"
                label={s.visibilityLabel}
                value={field.visibility}
                choices={[...s.visibilityChoices]}
                oninput={(v) => patch(field.key, { visibility: v as SchemaField['visibility'] })}
              />
              {#if field.kind === 'choice'}
                <TextField
                  id="choices-{field.key}"
                  label={s.choicesLabel}
                  value={choicesText(field)}
                  help={s.choicesHelp}
                  placeholder="Hiking, Cooking, Music"
                  oninput={(v) => setChoices(field.key, v)}
                />
              {/if}
              {#if field.kind === 'number'}
                <div class="bounds-row">
                  <TextField
                    id="min-{field.key}"
                    label={s.minLabel}
                    type="number"
                    value={field.min ?? ''}
                    help={s.boundsHelp}
                    oninput={(v) => setBound(field.key, 'min', v)}
                  />
                  <TextField
                    id="max-{field.key}"
                    label={s.maxLabel}
                    type="number"
                    value={field.max ?? ''}
                    help={s.boundsHelp}
                    oninput={(v) => setBound(field.key, 'max', v)}
                  />
                </div>
              {/if}
              {#if field.visibility === 'public' && (field.kind === 'short-text' || field.kind === 'long-text')}
                <label class="check" for="name-{field.key}">
                  <input id="name-{field.key}" type="checkbox" checked={field.shownAsName === true}
                    onchange={(event) => patch(field.key, { shownAsName: event.currentTarget.checked })} />
                  {s.shownAsName}
                </label>
                <p class="muted">{s.nameHelp}</p>
              {/if}
              <div class="check-row">
                <label class="check" for="required-{field.key}">
                  <input
                    id="required-{field.key}"
                    type="checkbox"
                    checked={field.required}
                    onchange={(e) => patch(field.key, { required: (e.currentTarget as HTMLInputElement).checked })}
                  />
                  {s.requiredLabel}
                </label>
                <label class="check" for="filterable-{field.key}">
                  <input
                    id="filterable-{field.key}"
                    type="checkbox"
                    checked={field.filterable}
                    onchange={(e) => patch(field.key, { filterable: (e.currentTarget as HTMLInputElement).checked })}
                  />
                  {s.filterableLabel}
                </label>
              </div>
              <div class="row">
                <Button variant="danger" onclick={() => removeQuestion(field.key)}>{s.removeLabel}</Button>
              </div>
            </div>
            </li>
          {/each}
        </ol>
        <div class="row row-gap">
          <Button onclick={() => addQuestion()}>{s.addLabel}</Button>
          <Button variant="primary" busy={saving} busyLabel={s.saving} onclick={() => void save()}>{s.save}</Button>
        </div>
      </fieldset>
      <div class="admin-preview">
        <h2>{s.preview}</h2>
        <div class="preview-card"><ProfilePreview handle="sample-member" {schema} values={sampleValues} frontLabel={s.frontLabel} backLabel={s.backLabel} /></div>
        <h3>{s.sampleHeading}</h3>
        <p class="muted">{s.sampleHelp}</p>
        {#each schema.fields as field (field.key)}
          {#if field.kind === 'location'}
            {#each ['latitude', 'longitude'] as coordinate}
              <TextField id={`sample-${field.key}-${coordinate}`} label={`${field.question} (${coordinate}, sample)`} type="number"
                value={typeof sampleValues[field.key] === 'object' ? (sampleValues[field.key] as {latitude: number; longitude: number})[coordinate as 'latitude' | 'longitude'] : ''}
                oninput={(value) => setCoordinate(field.key, coordinate as 'latitude' | 'longitude', value)} />
            {/each}
          {:else}
          <TextField
            id="sample-{field.key}"
            label={`${field.question} (sample)`}
            value={sampleText(field.key, field.kind)}
            type={field.kind === 'number' ? 'number' : 'text'}
            choices={field.kind === 'choice' ? field.choices : field.kind === 'yes-no' ? ['Yes', 'No'] : undefined}
            placeholder={s.samplePlaceholder}
            oninput={(v) => setSample(field.key, field.kind, v)}
          />
          {/if}
        {/each}
      </div>
    </div>
  {:else if error}
    <Button onclick={() => void load()}>{s.retry}</Button>
  {:else if !error}
    <p aria-live="polite">{s.loading}</p>
  {/if}
</section>

<style>
  .admin-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  }
  .admin-editor { border: 0; padding: 0; margin: 0; min-width: 0; }
  @media (min-width: 52rem) { .preview-card { position: sticky; top: 1rem; z-index: 1; background: var(--cmeet-surface); } }
  .schema-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.35rem;
  }
  .schema-item {
    list-style: none;
    display: grid;
    gap: 0.35rem;
  }
  .grow { flex: 1; }
  .grip { color: var(--cmeet-muted); }
  .field-editor {
    border: 1px solid var(--cmeet-line);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    margin-bottom: 0.6rem;
  }
  .bounds-row {
    display: grid;
    gap: 0.6rem;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  }
  .check-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-block: 0.6rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 600;
    min-height: 2.75rem;
  }
  .check input {
    width: 1.25rem;
    height: 1.25rem;
  }
  .check input:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .row-gap { margin-top: 0.75rem; }
  .error-focus:focus { outline: none; }
  .error-focus:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
</style>
