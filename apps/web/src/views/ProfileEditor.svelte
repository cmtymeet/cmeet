<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, MatchRule, ProfileSchema, ProfileValues } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, ProfilePreview } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let schema: ProfileSchema | null = $state(null);
  let values: ProfileValues = $state({});
  let rules: MatchRule[] = $state([]);
  let busy = $state(false);
  let saved = $state(false);
  let error = $state('');

  onMount(() => {
    void (async () => {
      try {
        schema = await client.schema();
        const profile = await client.ownProfile();
        values = { ...profile.values };
        rules = await client.ownRules();
      } catch (e) {
        error = e instanceof Error ? e.message : 'The profile could not be loaded.';
      }
    })();
  });

  function setValue(key: string, raw: string) {
    const field = schema?.fields.find((f) => f.key === key);
    values = { ...values, [key]: field?.kind === 'number' ? Number(raw) : raw };
    saved = false;
  }

  function ruleFor(field: string): MatchRule {
    return rules.find((r) => r.field === field) ?? { field };
  }

  function setRule(field: string, patch: Partial<MatchRule>) {
    const rest = rules.filter((r) => r.field !== field);
    rules = [...rest, { ...ruleFor(field), ...patch }];
    saved = false;
  }

  async function save() {
    error = '';
    saved = false;
    busy = true;
    try {
      const issues = await client.validateProfile(values);
      if (issues.length > 0) {
        error = issues[0]?.message ?? 'The profile is not complete yet.';
        return;
      }
      await client.saveRules($state.snapshot(rules.filter((r) => r.equals?.length || r.min !== undefined || r.max !== undefined)));
      await client.publishProfile($state.snapshot(values));
      saved = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Saving did not work. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="page" aria-labelledby="profile-title">
  <h1 id="profile-title">{en.profile.title}</h1>
  <p class="muted">There are no profile pictures. Every field has a validator; only rules use ranges.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if saved}<Notice tone="success">Profile published and checked.</Notice>{/if}
  {#if schema}
    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));">
      <form onsubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Edit profile">
        {#each schema.fields as field}
          <TextField
            id="profile-{field.key}"
            label={field.question}
            value={values[field.key] ?? ''}
            type={field.kind === 'number' ? 'number' : 'text'}
            choices={field.kind === 'choice' ? field.choices : undefined}
            multiline={field.kind === 'long-text' || field.kind === 'short-text'}
            required={field.required}
            min={field.min}
            max={field.max}
            help={field.visibility === 'private' ? 'Private: shared only under your rules.' : 'Public: visible in discovery.'}
            oninput={(v) => setValue(field.key, v)}
          />
        {/each}
        <h2>Who can see the private side</h2>
        <p class="muted">Both members must satisfy each other's rules before keys are released.</p>
        {#each schema.fields.filter((f) => f.filterable) as field}
          {@const rule = ruleFor(field.key)}
          <div class="field-row">
            <TextField
              id="rule-{field.key}"
              label={field.kind === 'number' ? `${field.question} (from–to)` : `${field.question} (allowed answers, comma separated)`}
              value={field.kind === 'number'
                ? `${rule.min ?? ''}–${rule.max ?? ''}`
                : (rule.equals ?? []).join(', ')}
              help="Leave empty for no rule on this field."
              oninput={(v) => {
                if (field.kind === 'number') {
                  const [minRaw, maxRaw] = v.split('–');
                  setRule(field.key, {
                    min: minRaw?.trim() === '' ? undefined : Number(minRaw),
                    max: maxRaw?.trim() === '' || maxRaw === undefined ? undefined : Number(maxRaw),
                  });
                } else {
                  const equals = v.split(',').map((s) => s.trim()).filter(Boolean);
                  setRule(field.key, { equals });
                }
              }}
            />
          </div>
        {/each}
        <div class="row"><Button type="submit" variant="primary" {busy} busyLabel="Publishing…">{en.profile.save}</Button></div>
      </form>
      <div>
        <h2>Preview</h2>
        <ProfilePreview {schema} {values} frontLabel={en.profile.previewFront} backLabel={en.profile.previewBack} />
      </div>
    </div>
  {:else if !error}
    <p aria-live="polite">{en.common.loading}</p>
  {/if}
</section>
