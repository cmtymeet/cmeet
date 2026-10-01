<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CmsgClient, MatchRule, ProfileSchema, ProfileValues } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, ProfilePreview } from '../../../../ui/src/index.js';
  import { profileStrings } from '../strings/profile.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  // Forward-compatible shapes from PORT-CONTRACT: a location answer is an
  // explicit { latitude, longitude } pair, a location rule carries only a
  // collected maxDistanceKm, and yes/no rule equality may hold booleans.
  // The UI collects these typed inputs and never computes with them.
  interface LocationValue {
    latitude: number;
    longitude: number;
  }
  type FormValues = Record<string, string | number | boolean | LocationValue>;
  type RuleEx = Omit<MatchRule, 'equals'> & {
    equals?: (string | number | boolean)[];
    maxDistanceKm?: number;
  };

  let schema: ProfileSchema | null = $state(null);
  let values: FormValues = $state({});
  let rules: RuleEx[] = $state([]);
  // Raw drafts preserve what the member typed: a cleared number input stays
  // cleared (absent) instead of collapsing to 0, and half-typed locations
  // survive until both halves parse.
  let numberInputs: Record<string, string> = $state({});
  let locationDrafts: Record<string, { lat: string; lon: string }> = $state({});
  let busy = $state(false);
  let saved = $state(false);
  let error = $state('');
  let fieldErrors: Record<string, string> = $state({});
  let published = $state(false);
  let revision: number | null = $state(null);
  let errorBox: HTMLElement | null = $state(null);

  function isLocation(value: unknown): value is LocationValue {
    if (typeof value !== 'object' || value === null) return false;
    const pair = value as Record<string, unknown>;
    return typeof pair.latitude === 'number' && typeof pair.longitude === 'number';
  }

  function hasConstraint(rule: RuleEx): boolean {
    return (
      (rule.equals?.length ?? 0) > 0 ||
      rule.min !== undefined ||
      rule.max !== undefined ||
      rule.maxDistanceKm !== undefined
    );
  }

  onMount(() => {
    void (async () => {
      try {
        schema = await client.schema();
        const profile = await client.ownProfile();
        values = { ...(profile.values as unknown as FormValues) };
        published = profile.published;
        revision = profile.revision;
        rules = [...((await client.ownRules()) as unknown as RuleEx[])];
        for (const field of schema.fields) {
          if (field.kind === 'number') {
            const current = values[field.key];
            numberInputs[field.key] = typeof current === 'number' ? String(current) : '';
          }
          if (field.kind === 'location') {
            const current = values[field.key];
            locationDrafts[field.key] = isLocation(current)
              ? { lat: String(current.latitude), lon: String(current.longitude) }
              : { lat: '', lon: '' };
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : profileStrings.loadFailed;
      }
    })();
  });

  function parseOptionalNumber(raw: string): number | undefined {
    const text = raw.trim();
    if (text === '') return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function setTextValue(key: string, raw: string) {
    if (raw.trim() === '') {
      const rest = { ...values };
      delete rest[key];
      values = rest;
    } else {
      values = { ...values, [key]: raw };
    }
    saved = false;
  }

  function setNumberValue(key: string, raw: string) {
    numberInputs = { ...numberInputs, [key]: raw };
    const next = parseOptionalNumber(raw);
    if (next === undefined) {
      const rest = { ...values };
      delete rest[key];
      values = rest;
    } else {
      values = { ...values, [key]: next };
    }
    saved = false;
  }

  function setYesNoValue(key: string, raw: string) {
    if (raw === '') {
      const rest = { ...values };
      delete rest[key];
      values = rest;
    } else {
      values = { ...values, [key]: raw === 'Yes' };
    }
    saved = false;
  }

  function setLocationValue(key: string, part: 'lat' | 'lon', raw: string) {
    const current = locationDrafts[key] ?? { lat: '', lon: '' };
    const next = { ...current, [part]: raw };
    locationDrafts = { ...locationDrafts, [key]: next };
    const latitude = Number(next.lat.trim());
    const longitude = Number(next.lon.trim());
    if (next.lat.trim() !== '' && next.lon.trim() !== '' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      values = { ...values, [key]: { latitude, longitude } };
    } else {
      const rest = { ...values };
      delete rest[key];
      values = rest;
    }
    saved = false;
  }

  function yesNoDisplay(key: string): string {
    const current = values[key];
    if (current === true) return 'Yes';
    if (current === false) return 'No';
    return '';
  }

  function visibilityHelp(field: { visibility: 'public' | 'private' }): string {
    return field.visibility === 'private' ? profileStrings.privateHelp : profileStrings.publicHelp;
  }

  function ruleFor(field: string): RuleEx {
    return rules.find((rule) => rule.field === field) ?? { field };
  }

  function setRule(field: string, patch: Partial<RuleEx>) {
    const next = { ...ruleFor(field), ...patch };
    const rest = rules.filter((rule) => rule.field !== field);
    rules = hasConstraint(next) ? [...rest, next] : rest;
    saved = false;
  }

  function setRuleText(field: string, raw: string) {
    const equals = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    setRule(field, { equals: equals.length > 0 ? equals : undefined });
  }

  function setRuleBound(field: string, bound: 'min' | 'max', raw: string) {
    setRule(field, { [bound]: parseOptionalNumber(raw) } as Partial<RuleEx>);
  }

  function setRuleYesNo(field: string, raw: string) {
    if (raw === '') setRule(field, { equals: undefined });
    else setRule(field, { equals: [raw === 'Yes'] });
  }

  function ruleYesNoDisplay(field: string): string {
    const first = ruleFor(field).equals?.[0];
    if (first === true || first === 'Yes') return 'Yes';
    if (first === false || first === 'No') return 'No';
    return '';
  }

  function setRuleDistance(field: string, raw: string) {
    setRule(field, { maxDistanceKm: parseOptionalNumber(raw) });
  }

  function focusField(field: string) {
    const direct = document.getElementById(`profile-${field}`);
    if (direct) {
      direct.focus();
      return;
    }
    document.getElementById(`profile-${field}-lat`)?.focus();
  }

  async function save() {
    error = '';
    fieldErrors = {};
    saved = false;
    if (!schema) return;
    busy = true;
    try {
      // Validation belongs to cmsg alone: collect typed inputs, then ask.
      const snapshot = { ...values } as unknown as ProfileValues;
      const issues = await client.validateProfile(snapshot);
      if (issues.length > 0) {
        const mapped: Record<string, string> = {};
        for (const issue of issues) mapped[issue.field] = issue.message;
        fieldErrors = mapped;
        error =
          issues.length === 1
            ? (issues[0]?.message ?? profileStrings.validationSummary)
            : `${profileStrings.validationSummary} (${issues.length})`;
        await tick();
        if (issues[0]) focusField(issues[0].field);
        return;
      }
      const ruleSnapshot = rules.filter(hasConstraint).map((rule) => ({ ...rule })) as unknown as MatchRule[];
      await client.saveRules(ruleSnapshot);
      // A failed publish keeps the last valid form state; only a returned
      // profile marks the form published.
      const result = await client.publishProfile(snapshot);
      published = result.profile.published;
      revision = result.profile.revision;
      values = { ...(result.profile.values as unknown as FormValues) };
      saved = true;
      fieldErrors = {};
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : profileStrings.saveFailed;
      saved = false;
      await tick();
      errorBox?.focus();
    } finally {
      busy = false;
    }
  }

  // Location pairs and yes/no answers have no pictures to show; format them
  // as plain text so the shared flashcard stays a text-only preview.
  const previewValues = $derived.by(() => {
    const out: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(values)) {
      if (isLocation(value)) out[key] = `${value.latitude}, ${value.longitude}`;
      else if (typeof value === 'boolean') out[key] = value ? 'Yes' : 'No';
      else if (typeof value === 'string' || typeof value === 'number') out[key] = value;
    }
    return out as ProfileValues;
  });
</script>

<section class="page" aria-labelledby="profile-title">
  <h1 id="profile-title">{profileStrings.title}</h1>
  <p class="muted">{profileStrings.lead}</p>
  <p class="muted" aria-live="polite">
    {#if published && revision !== null}{profileStrings.statusPublishedPrefix}{revision}{:else}{profileStrings.statusDraft}{/if}
  </p>
  {#if !published}<p class="muted">{profileStrings.newProfileNote}</p>{/if}
  {#if error}
    <div bind:this={errorBox} tabindex="-1" class="error-focus">
      <Notice tone="error">{error}</Notice>
    </div>
  {/if}
  {#if saved}<Notice tone="success">{profileStrings.publishedOk}</Notice>{/if}
  {#if schema}
    <div class="grid">
      <form onsubmit={(e) => { e.preventDefault(); void save(); }} aria-label={profileStrings.formLabel}>
        {#each schema.fields as field}
          {#if field.kind === 'choice'}
            <TextField
              id="profile-{field.key}"
              label={field.question}
              value={String(values[field.key] ?? '')}
              choices={field.choices}
              required={field.required}
              help={visibilityHelp(field)}
              error={fieldErrors[field.key]}
              oninput={(v) => setTextValue(field.key, v)}
            />
          {:else if field.kind === 'number'}
            <TextField
              id="profile-{field.key}"
              label={field.question}
              type="number"
              value={numberInputs[field.key] ?? ''}
              required={field.required}
              min={field.min}
              max={field.max}
              help={visibilityHelp(field)}
              error={fieldErrors[field.key]}
              oninput={(v) => setNumberValue(field.key, v)}
            />
          {:else if field.kind === 'yes-no'}
            <TextField
              id="profile-{field.key}"
              label={field.question}
              value={yesNoDisplay(field.key)}
              choices={['Yes', 'No']}
              required={field.required}
              help={visibilityHelp(field)}
              error={fieldErrors[field.key]}
              oninput={(v) => setYesNoValue(field.key, v)}
            />
          {:else if field.kind === 'location'}
            <fieldset class="loc">
              <legend>{field.question}{#if field.required} <span aria-hidden="true">*</span>{/if}</legend>
              <p class="muted">{profileStrings.locationHelp} {visibilityHelp(field)}</p>
              <div class="loc-pair">
                <TextField
                  id="profile-{field.key}-lat"
                  label={profileStrings.latitudeLabel}
                  type="number"
                  value={locationDrafts[field.key]?.lat ?? ''}
                  required={field.required}
                  error={fieldErrors[field.key]}
                  oninput={(v) => setLocationValue(field.key, 'lat', v)}
                />
                <TextField
                  id="profile-{field.key}-lon"
                  label={profileStrings.longitudeLabel}
                  type="number"
                  value={locationDrafts[field.key]?.lon ?? ''}
                  required={field.required}
                  error={fieldErrors[field.key]}
                  oninput={(v) => setLocationValue(field.key, 'lon', v)}
                />
              </div>
            </fieldset>
          {:else}
            <TextField
              id="profile-{field.key}"
              label={field.question}
              value={String(values[field.key] ?? '')}
              multiline={true}
              required={field.required}
              help={visibilityHelp(field)}
              error={fieldErrors[field.key]}
              oninput={(v) => setTextValue(field.key, v)}
            />
          {/if}
        {/each}
        <h2>{profileStrings.rulesTitle}</h2>
        <p class="muted">{profileStrings.rulesLead}</p>
        {#each schema.fields.filter((f) => f.filterable) as field}
          {#if field.kind === 'number'}
            {@const rule = ruleFor(field.key)}
            <div class="field-row">
              <TextField
                id="rule-{field.key}-min"
                label={`${field.question} ${profileStrings.minSuffix}`}
                type="number"
                value={rule.min ?? ''}
                help={profileStrings.ruleAnyHelp}
                oninput={(v) => setRuleBound(field.key, 'min', v)}
              />
              <TextField
                id="rule-{field.key}-max"
                label={`${field.question} ${profileStrings.maxSuffix}`}
                type="number"
                value={rule.max ?? ''}
                help={profileStrings.ruleAnyHelp}
                oninput={(v) => setRuleBound(field.key, 'max', v)}
              />
            </div>
          {:else if field.kind === 'yes-no'}
            <TextField
              id="rule-{field.key}"
              label={field.question}
              value={ruleYesNoDisplay(field.key)}
              choices={['Yes', 'No']}
              help={profileStrings.ruleAnyHelp}
              oninput={(v) => setRuleYesNo(field.key, v)}
            />
          {:else if field.kind === 'location'}
            {@const rule = ruleFor(field.key)}
            <TextField
              id="rule-{field.key}-distance"
              label={`${field.question} ${profileStrings.distanceSuffix}`}
              type="number"
              value={rule.maxDistanceKm ?? ''}
              help={profileStrings.distanceHelp}
              oninput={(v) => setRuleDistance(field.key, v)}
            />
          {:else}
            {@const rule = ruleFor(field.key)}
            <TextField
              id="rule-{field.key}"
              label={`${field.question} ${profileStrings.choicesRuleSuffix}`}
              value={(rule.equals ?? []).join(', ')}
              help={profileStrings.ruleAnyHelp}
              oninput={(v) => setRuleText(field.key, v)}
            />
          {/if}
        {/each}
        <div class="row">
          <Button type="submit" variant="primary" {busy} busyLabel={profileStrings.saving}>{profileStrings.save}</Button>
        </div>
      </form>
      <div>
        <h2>{profileStrings.previewTitle}</h2>
        <ProfilePreview
          {schema}
          values={previewValues}
          frontLabel={profileStrings.previewFront}
          backLabel={profileStrings.previewBack}
        />
      </div>
    </div>
  {:else if !error}
    <p aria-live="polite">{profileStrings.loading}</p>
  {/if}
</section>

<style>
  .loc {
    border: 1px solid var(--cmeet-line);
    border-radius: var(--cmeet-radius);
    padding: 0.6rem 0.8rem;
    margin-block: 0.6rem;
  }
  .loc legend {
    font-weight: 600;
    padding-inline: 0.3rem;
  }
  .loc-pair {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 1fr 1fr;
  }
  .error-focus {
    border-radius: var(--cmeet-radius);
  }
  .error-focus:focus {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
  @media (max-width: 30rem) {
    .loc-pair {
      grid-template-columns: 1fr;
    }
  }
</style>
