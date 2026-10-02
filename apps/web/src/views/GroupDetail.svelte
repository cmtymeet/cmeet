<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, GroupForkProposal, GroupView } from '../../../../core/src/cmsg.js';
  import { Button, Notice, LevelBadge } from '../../../../ui/src/index.js';
  import { groupDetailStrings as s } from '../strings/group-detail.js';

  interface Props {
    client: CmsgClient;
    id: string;
  }
  let { client, id }: Props = $props();

  let group: GroupView | null = $state(null);
  let error = $state('');
  let loading = $state(true);
  let sending = $state(false);
  let proposing = $state(false);
  let consenting: string | null = $state(null);
  let welcoming = $state(false);
  let dismissing = $state(false);
  let draft = $state('');
  let forkNote = $state('');
  let welcomeNote = $state('');
  let forkKind: GroupForkProposal['kind'] = $state('split');
  let forkLabel = $state('');
  let forkDetail = $state('');
  let forkRoster = $state('');
  let forkTarget = $state('');
  let request = 0;

  const rosterPreview: string[] = $derived(
    forkRoster
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  async function load(target: string, token: number) {
    let next: GroupView | null = null;
    try {
      const groups = await client.groups();
      next = groups.find((g) => g.id === target) ?? null;
    } catch (e) {
      if (token !== request) return;
      error = e instanceof Error ? e.message : s.loadFailed;
      loading = false;
      return;
    }
    if (token !== request) return;
    group = next;
    if (!next) error = s.unavailable;
    loading = false;
  }

  async function refresh() {
    try {
      const groups = await client.groups();
      const next = groups.find((g) => g.id === id) ?? null;
      if (next) group = next;
    } catch {
      // Keep the last rendered group; errors surface on explicit actions.
    }
  }

  $effect(() => {
    const target = id;
    request += 1;
    const token = request;
    error = '';
    forkNote = '';
    welcomeNote = '';
    group = null;
    draft = '';
    forkLabel = '';
    forkDetail = '';
    forkRoster = '';
    forkTarget = '';
    loading = true;
    void load(target, token);
  });

  onMount(() => {
    return client.subscribe((event) => {
      if (event.type === 'groups') {
        const next = event.groups.find((g) => g.id === id);
        if (next) group = next;
      }
    });
  });

  async function send() {
    const text = draft.trim();
    if (!text || !group || sending) return;
    sending = true;
    error = '';
    try {
      await client.sendGroupMessage(group.id, text);
      draft = '';
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : s.sendFailed;
    } finally {
      sending = false;
    }
  }

  async function propose() {
    if (!group || proposing) return;
    const label = forkLabel.trim();
    if (!label) {
      error = s.emptyProposal;
      return;
    }
    proposing = true;
    error = '';
    forkNote = '';
    try {
      const proposal: GroupForkProposal = {
        groupId: group.id,
        kind: forkKind,
        label,
        detail: forkDetail.trim(),
      };
      if (rosterPreview.length > 0) proposal.memberIds = [...rosterPreview];
      if (forkTarget.trim()) proposal.targetGroupId = forkTarget.trim();
      await client.proposeFork(proposal);
      forkNote = s.proposalRecorded;
      forkLabel = '';
      forkDetail = '';
      forkRoster = '';
      forkTarget = '';
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : s.proposeFailed;
    } finally {
      proposing = false;
    }
  }

  async function consent(forkId: string) {
    if (!group || consenting) return;
    consenting = forkId;
    error = '';
    forkNote = '';
    try {
      await client.consentFork(group.id, forkId);
      forkNote = `${s.consentRecorded} ${s.nonmoversNote}`;
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : s.consentFailed;
    } finally {
      consenting = null;
    }
  }

  async function welcome() {
    if (!group || welcoming) return;
    welcoming = true;
    error = '';
    welcomeNote = '';
    try {
      welcomeNote = await client.welcomeMember(group.id);
    } catch (e) {
      error = e instanceof Error ? e.message : s.welcomeFailed;
    } finally {
      welcoming = false;
    }
  }

  async function dismiss() {
    if (!group || dismissing) return;
    dismissing = true;
    error = '';
    try {
      await client.dismissGroupSuggestion(group.id);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : s.dismissFailed;
    } finally {
      dismissing = false;
    }
  }
</script>

<section class="page group-detail" aria-labelledby="group-title">
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if group}
    <p><a href="#/groups">← {s.backToGroups}</a></p>
    <h1 id="group-title">{group.name}</h1>
    <p class="row">
      <LevelBadge
        level={group.level}
        labels={{ circle: 'Circle', ingroup: 'Ingroup', room: 'Public room', opening: 'Opening room' }}
      />
      <span class="muted">{group.size} {s.membersSuffix}</span>
    </p>
    <p>{group.description}</p>
    <p><strong>{s.whatChangesNext}:</strong> {group.whatChangesNext}</p>
    {#if group.band}
      <dl class="band">
        <div><dt>{s.bandLabel} · notifications</dt><dd>{group.band.notifications}</dd></div>
        <div><dt>{s.bandLabel} · posting pace</dt><dd>{group.band.postingPace}</dd></div>
        <div><dt>{s.bandLabel} · joining</dt><dd>{group.band.joining}</dd></div>
      </dl>
    {/if}
    <p><strong>{s.newcomerHistoryLabel}:</strong> {group.newcomerHistory}</p>
    {#if group.lineage && group.lineage.length > 0}
      <p><strong>{s.lineageLabel}:</strong> {group.lineage.join(' → ')}</p>
    {/if}
    {#if group.opening}
      <p><strong>{s.openingProgressLabel}:</strong> {group.opening.progress} {group.opening.deadlineLabel}</p>
    {/if}
    {#if group.seatBudget?.enabled}
      <p><strong>{s.seatLabel}:</strong> {group.seatBudget.label}</p>
    {/if}
    {#if group.level === 'room' || group.level === 'opening'}
      <Notice tone="info">{s.roomConsentNote}</Notice>
    {/if}
    {#if group.suggestion}
      <Notice tone="info">{group.suggestion}</Notice>
      <div class="row">
        <Button onclick={() => void dismiss()} busy={dismissing} busyLabel={s.dismissBusy}>
          {s.suggestionDismiss}
        </Button>
      </div>
    {/if}
    {#if forkNote}<Notice tone="success">{forkNote}</Notice>{/if}

    {#if group.welcomePrompt}
      <h2>{s.welcomeAction}</h2>
      <p>{group.welcomePrompt}</p>
      <div class="row">
        <Button onclick={() => void welcome()} busy={welcoming} busyLabel={s.welcomeBusy}>
          {s.welcomeAction}
        </Button>
      </div>
      {#if welcomeNote}<Notice tone="info">{s.welcomeReplyLabel}: {welcomeNote}</Notice>{/if}
    {/if}

    {#if group.joined}
      <h2 id="messages-heading">{s.messagesLabel}</h2>
      <ul class="thread" aria-labelledby="messages-heading" aria-live="polite">
        {#each group.messages as message (message.id)}
          <li class="bubble" class:out={message.outgoing}><div>{message.text}</div></li>
        {/each}
      </ul>
      {#if group.messages.length === 0}<p class="muted">{s.quietNote}</p>{/if}
      <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
        <label class="visually-hidden" for="group-composer">{s.composerLabel}</label>
        <input
          id="group-composer"
          value={draft}
          oninput={(e) => (draft = e.currentTarget.value)}
          placeholder={s.composerLabel}
          autocomplete="off"
          maxlength="2000"
        />
        <Button type="submit" variant="primary" busy={sending} busyLabel={s.sendBusy}>{s.send}</Button>
      </form>
      <p class="muted">{s.directContactNote} <a href="#/waves">{s.directContactLink}</a></p>

      <h2>{s.forksTitle}</h2>
      <p class="muted">{s.forksLead}</p>
      {#if group.forks && group.forks.length > 0}
        <ul class="fork-list">
          {#each group.forks as fork (fork.id)}
            <li class="fork">
              <h3>{fork.label}</h3>
              <p>{fork.detail}</p>
              <p>
                <strong>{s.proposedRosterLabel}:</strong>
                {#if fork.proposedRoster.length > 0}
                  {fork.proposedRoster.join(', ')}
                {:else}
                  <span class="muted">{s.emptyRoster}</span>
                {/if}
              </p>
              {#if fork.consented}
                <p class="muted">{s.consentedLabel}. {s.nonmoversNote}</p>
              {:else}
                <Button
                  onclick={() => void consent(fork.id)}
                  busy={consenting === fork.id}
                  busyLabel={s.consentBusy}
                >
                  {s.consentAction}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{s.noForks}</p>
      {/if}

      <h2>{s.proposeTitle}</h2>
      <p class="muted">{s.proposeLead}</p>
      <form
        class="fork-form"
        onsubmit={(e) => { e.preventDefault(); void propose(); }}
      >
        <div class="field">
          <label for="fork-kind">{s.kindLabel}</label>
          <select id="fork-kind" value={forkKind} onchange={(e) => (forkKind = e.currentTarget.value as GroupForkProposal['kind'])}>
            <option value="add">{s.kinds.add}</option>
            <option value="exclusion">{s.kinds.exclusion}</option>
            <option value="split">{s.kinds.split}</option>
            <option value="merge">{s.kinds.merge}</option>
            <option value="open">{s.kinds.open}</option>
            <option value="exit">{s.kinds.exit}</option>
          </select>
        </div>
        <div class="field">
          <label for="fork-label">{s.nameLabel}</label>
          <input
            id="fork-label"
            value={forkLabel}
            oninput={(e) => (forkLabel = e.currentTarget.value)}
            placeholder={s.namePlaceholder}
            maxlength="120"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="fork-detail">{s.detailLabel}</label>
          <textarea
            id="fork-detail"
            value={forkDetail}
            oninput={(e) => (forkDetail = e.currentTarget.value)}
            placeholder={s.detailPlaceholder}
            maxlength="2000"
            rows="2"
          ></textarea>
        </div>
        <div class="field">
          <label for="fork-roster">{s.rosterLabel}</label>
          <input
            id="fork-roster"
            value={forkRoster}
            oninput={(e) => (forkRoster = e.currentTarget.value)}
            placeholder={s.rosterPlaceholder}
            autocomplete="off"
          />
          <p class="muted">{s.rosterHint}</p>
          {#if rosterPreview.length > 0}
            <p><strong>{s.rosterPreviewLabel}:</strong> {rosterPreview.join(', ')}</p>
          {/if}
        </div>
        <div class="field">
          <label for="fork-target">{s.targetLabel}</label>
          <input
            id="fork-target"
            value={forkTarget}
            oninput={(e) => (forkTarget = e.currentTarget.value)}
            placeholder={s.targetPlaceholder}
            autocomplete="off"
          />
        </div>
        <Button type="submit" variant="primary" busy={proposing} busyLabel={s.proposeBusy}>
          {s.proposeAction}
        </Button>
      </form>
    {:else}
      <p>{s.hiddenNote}</p>
      <p class="muted">{s.directContactNote} <a href="#/waves">{s.directContactLink}</a></p>
    {/if}
  {:else if !error && loading}
    <p aria-live="polite">{s.loading}</p>
  {/if}
</section>

<style>
  .group-detail {
    min-width: 0;
  }
  .visually-hidden {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .band {
    display: grid;
    gap: 0.35rem;
    margin: 0.75rem 0;
    padding: 0;
  }
  .band div {
    display: grid;
    gap: 0.1rem;
  }
  .band dt {
    font-weight: 700;
    font-size: 0.85rem;
  }
  .band dd {
    margin: 0;
  }
  .fork-list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  .fork {
    border: 1px solid var(--cmeet-line);
    border-radius: var(--cmeet-radius);
    padding: 0.8rem 1rem;
  }
  .fork h3 {
    margin: 0 0 0.25rem;
  }
  .fork-form {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .field {
    display: grid;
    gap: 0.25rem;
  }
  .field label {
    font-weight: 700;
  }
  .field input,
  .field select,
  .field textarea {
    font: inherit;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--cmeet-line);
    border-radius: var(--cmeet-radius);
    background: var(--cmeet-surface);
    color: var(--cmeet-ink);
    width: 100%;
    max-width: 100%;
  }
  .field input:focus-visible,
  .field select:focus-visible,
  .field textarea:focus-visible {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
  .field .muted {
    margin: 0;
  }
</style>
