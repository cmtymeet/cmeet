<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type {
    CmsgClient,
    RootCommunity,
    RootCommunityView,
    RootSetting,
  } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { rootStrings as s } from '../strings/root.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  type SettingMode = 'inherit' | 'empty' | 'value';

  let communities: RootCommunity[] = $state([]);
  let selected: string | null = $state(null);
  let view: RootCommunityView | null = $state(null);
  let drafts: Record<string, { mode: SettingMode; value: string }> = $state({});
  let adminInput = $state('');
  let adminNote = $state('');
  let settingNote = $state('');

  let signedIn = $state(false);
  let busy = $state(false);
  let loadingCommunity = $state(false);
  let savingKey: string | null = $state(null);
  let adminBusy = $state(false);
  let error = $state('');
  let errorRef: HTMLElement | null = $state(null);

  /** Generation guard: a slow community response never overwrites a newer selection. */
  let requestSeq = 0;
  let alive = true;
  onDestroy(() => {
    alive = false;
    requestSeq++;
  });

  function displayName(id: string): string {
    return communities.find((c) => c.communityId === id)?.displayName ?? id;
  }

  function seedDraft(mode: SettingMode, value: string) {
    return { mode, value };
  }

  function draftFor(setting: RootSetting) {
    const mode: SettingMode = setting.inherited
      ? 'inherit'
      : setting.overrideValue === null
        ? 'empty'
        : 'value';
    return seedDraft(mode, setting.overrideValue ?? '');
  }

  function seedDrafts(next: RootCommunityView) {
    const seeded: Record<string, { mode: SettingMode; value: string }> = {};
    for (const setting of next.settings) {
      seeded[setting.key] = draftFor(setting);
    }
    drafts = seeded;
  }

  function showError(message: string) {
    error = message;
    if (alive) void tick().then(() => errorRef?.focus());
  }

  async function signIn() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await client.signInRole('root');
      if (!alive) return;
      communities = await client.rootCommunities();
      if (!alive) return;
      signedIn = true;
      const first = communities[0]?.communityId ?? null;
      if (first) await selectCommunity(first);
    } catch (e) {
      if (!alive) return;
      showError(e instanceof Error ? e.message : s.signInFailed);
    } finally {
      busy = false;
    }
  }

  async function selectCommunity(id: string) {
    if (savingKey !== null || adminBusy) return;
    const seq = ++requestSeq;
    selected = id;
    view = null;
    settingNote = '';
    adminNote = '';
    adminInput = '';
    error = '';
    loadingCommunity = true;
    try {
      const next = await client.rootCommunity(id);
      if (!alive || seq !== requestSeq || selected !== id) return;
      view = next;
      seedDrafts(next);
    } catch (e) {
      if (!alive || seq !== requestSeq || selected !== id) return;
      showError(e instanceof Error ? e.message : s.settingFailed);
    } finally {
      if (alive && seq === requestSeq) loadingCommunity = false;
    }
  }

  function describeChoice(key: string): string {
    const draft = drafts[key];
    if (!draft) return '';
    if (draft.mode === 'inherit') return s.inherits;
    if (draft.mode === 'empty') return s.explicitEmpty;
    return draft.value;
  }

  async function saveSetting(key: string) {
    if (!selected || controlsDisabled) return;
    const draft = drafts[key];
    if (!draft) return;
    const communityId = selected;
    const seq = requestSeq;
    const mode = draft.mode;
    const value = draft.value;
    savingKey = key;
    error = '';
    settingNote = '';
    try {
      const next = await client.rootSetSetting(
        communityId,
        key,
        mode,
        mode === 'value' ? value : undefined,
      );
      if (!alive || seq !== requestSeq || selected !== communityId) return;
      view = next;
      const saved = next.settings.find((item) => item.key === key);
      if (saved) drafts = { ...drafts, [key]: draftFor(saved) };
      settingNote = `${key}: ${s.settingSaved}`;
    } catch (e) {
      if (!alive || seq !== requestSeq || selected !== communityId) return;
      showError(e instanceof Error ? e.message : s.settingFailed);
    } finally {
      savingKey = null;
    }
  }

  async function addAdmin() {
    if (!selected || controlsDisabled) return;
    const communityId = selected;
    const seq = requestSeq;
    const adminId = adminInput.trim();
    error = '';
    adminNote = '';
    if (!adminId) {
      showError(s.emptyAdminId);
      return;
    }
    adminBusy = true;
    try {
      const next = await client.rootSetAdmin(communityId, adminId, true);
      if (!alive || seq !== requestSeq || selected !== communityId) return;
      view = next;
      adminInput = '';
      adminNote = s.settingSaved;
    } catch (e) {
      if (!alive || seq !== requestSeq || selected !== communityId) return;
      showError(e instanceof Error ? e.message : s.adminFailed);
    } finally {
      adminBusy = false;
    }
  }

  async function removeAdmin(adminId: string) {
    if (!selected || controlsDisabled) return;
    const communityId = selected;
    const seq = requestSeq;
    error = '';
    adminNote = '';
    adminBusy = true;
    try {
      const next = await client.rootSetAdmin(communityId, adminId, false);
      if (!alive || seq !== requestSeq || selected !== communityId) return;
      view = next;
      adminNote = s.settingSaved;
    } catch (e) {
      if (!alive || seq !== requestSeq || selected !== communityId) return;
      showError(e instanceof Error ? e.message : s.adminFailed);
    } finally {
      adminBusy = false;
    }
  }

  const controlsDisabled = $derived(busy || loadingCommunity || savingKey !== null || adminBusy);
  /** Community switching stays available while loading so the generation
   * guard is exercised; it locks only while a mutation is being saved. */
  const selectionLocked = $derived(savingKey !== null || adminBusy);
</script>

<section class="page root-page" aria-labelledby="root-title">
  <h1 id="root-title">{s.title}</h1>
  <p class="muted">{s.lead}</p>
  {#if error}
    <div bind:this={errorRef} tabindex="-1" class="error-focus">
      <Notice tone="error">{error}</Notice>
    </div>
  {/if}
  {#if !signedIn}
    <Button {busy} busyLabel={s.signInBusy} onclick={() => void signIn()}>{s.signIn}</Button>
  {/if}

  {#if signedIn}
    <h2>{s.communitiesHeading}</h2>
    <ul class="gate-list">
      {#each communities as community (community.communityId)}
        <li>
          <span>{community.displayName}</span>
          <button
            class="select-btn"
            aria-pressed={selected === community.communityId}
            disabled={selectionLocked}
            onclick={() => void selectCommunity(community.communityId)}
          >{selected === community.communityId ? s.selected : s.select}</button>
        </li>
      {/each}
    </ul>

    {#if loadingCommunity}
      <p aria-live="polite" class="muted">{s.loadingCommunity}</p>
    {/if}

    {#if view && selected}
      <h2>{s.settingsHeading} · {displayName(selected)}</h2>
      {#if settingNote}<Notice tone="success">{settingNote}</Notice>{/if}
      {#if view.settings.length === 0}
        <p class="muted">{s.noSettings}</p>
      {/if}
      <div class="root-grid">
        {#each view.settings as setting (setting.key)}
          {@const draft = drafts[setting.key]}
          <article class="setting-card" aria-labelledby="setting-{setting.key}">
            <h3 id="setting-{setting.key}">{setting.label}</h3>
            <p class="muted">{setting.help}</p>
            <dl class="setting-values">
              <dt>{s.effectiveValue}</dt>
              <dd>{setting.effectiveValue === '' ? s.explicitEmpty : setting.effectiveValue}</dd>
              <dt>{s.currentChoice}</dt>
              <dd>
                {#if setting.inherited}
                  {s.inherits}
                {:else if setting.overrideValue === null}
                  {s.explicitEmpty}
                {:else}
                  {setting.overrideValue}
                {/if}
              </dd>
            </dl>
            {#if !setting.editable}
              <p class="muted">{s.managedByPlatform}</p>
            {/if}
            {#if draft}
              <fieldset class="mode-group" disabled={!setting.editable || controlsDisabled}>
                <legend>{s.modeLegend} · {setting.label}</legend>
                <label>
                  <input
                    type="radio"
                    name="mode-{setting.key}"
                    value="inherit"
                    checked={draft.mode === 'inherit'}
                    onchange={() => (drafts = { ...drafts, [setting.key]: { ...draft, mode: 'inherit' } })}
                  />
                  {s.modeInherit}
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode-{setting.key}"
                    value="empty"
                    checked={draft.mode === 'empty'}
                    onchange={() => (drafts = { ...drafts, [setting.key]: { ...draft, mode: 'empty' } })}
                  />
                  {s.modeEmpty}
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode-{setting.key}"
                    value="value"
                    checked={draft.mode === 'value'}
                    onchange={() => (drafts = { ...drafts, [setting.key]: { ...draft, mode: 'value' } })}
                  />
                  {s.modeValue}
                </label>
              </fieldset>
              {#if draft.mode === 'value'}
                <div class="field">
                  <label for="root-value-{setting.key}">{s.valueLabel} · {setting.label}</label>
                  <input
                    id="root-value-{setting.key}"
                    value={draft.value}
                    disabled={!setting.editable || controlsDisabled}
                    oninput={(e) => (drafts = {
                      ...drafts,
                      [setting.key]: { ...draft, value: (e.currentTarget as HTMLInputElement).value },
                    })}
                  />
                </div>
              {:else}
                <p class="muted">{s.currentChoice}: {describeChoice(setting.key)}</p>
              {/if}
              <Button
                variant="primary"
                busy={savingKey === setting.key}
                disabled={!setting.editable || controlsDisabled}
                onclick={() => void saveSetting(setting.key)}
              >{s.saveSetting} {setting.label}</Button>
            {/if}
          </article>
        {/each}
      </div>

      <h2>{s.adminsHeading} · {displayName(selected)}</h2>
      {#if adminNote}<Notice tone="success">{adminNote}</Notice>{/if}
      {#if view.admins.length === 0}
        <p class="muted">{s.noAdmins}</p>
      {/if}
      <ul class="gate-list">
        {#each view.admins as admin (admin.id)}
          <li>
            <span>{admin.label} <small class="muted">({admin.id})</small></span>
            <Button disabled={controlsDisabled} onclick={() => void removeAdmin(admin.id)}>
              {s.removeAdmin} {admin.id}
            </Button>
          </li>
        {/each}
      </ul>
      <div class="field">
        <label for="root-admin-id">{s.adminIdLabel}</label>
        <input
          id="root-admin-id"
          value={adminInput}
          placeholder="admin-2"
          aria-describedby="root-admin-id-help"
          disabled={controlsDisabled}
          oninput={(e) => (adminInput = (e.currentTarget as HTMLInputElement).value)}
        />
        <p id="root-admin-id-help" class="help">{s.adminIdHelp}</p>
      </div>
      <Button busy={adminBusy} disabled={controlsDisabled} onclick={() => void addAdmin()}>{s.addAdmin}</Button>
    {/if}
  {/if}
</section>

<style>
  .root-page { min-width: 0; }
  .error-focus:focus { outline: none; }
  .error-focus:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .select-btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.5rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
    min-height: 2.75rem;
  }
  .select-btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .select-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .root-grid {
    display: grid; gap: 0.9rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  }
  .setting-card {
    border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius);
    padding: 0.9rem; background: var(--cmeet-surface); min-width: 0;
  }
  .setting-card h3 { margin: 0 0 0.25rem; }
  .setting-values { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 0.5rem 0; }
  .setting-values dt { font-weight: 600; }
  .setting-values dd { margin: 0; overflow-wrap: anywhere; }
  .mode-group { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 0.6rem 0.8rem; display: grid; gap: 0.4rem; margin: 0.5rem 0; }
  .mode-group label { display: flex; gap: 0.5rem; align-items: center; min-height: 2.75rem; }
  .mode-group input { width: 1.25rem; height: 1.25rem; }
  .field { display: grid; gap: 0.35rem; margin-block: 0.6rem; }
  .field label { font-weight: 600; }
  .field input {
    font: inherit; color: var(--cmeet-ink); background: var(--cmeet-surface);
    border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius);
    padding: 0.55rem 0.7rem; max-width: 28rem; width: 100%;
  }
  .field input:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .help { color: var(--cmeet-muted); font-size: 0.9rem; margin: 0; }
</style>
