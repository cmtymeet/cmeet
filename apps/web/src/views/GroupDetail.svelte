<script lang="ts">
  import { memberName } from '../../../../ui/src/member-name.js';
  import { onMount } from 'svelte';
  import type {
    CmsgClient,
    Contact,
    GroupForkProposal,
    GroupView,
  } from '../../../../core/src/cmsg.js';
  import { Button, Notice, LevelBadge } from '../../../../ui/src/index.js';
  import { groupDetailStrings as s } from '../strings/group-detail.js';

  interface Props {
    client: CmsgClient;
    id: string;
  }
  let { client, id }: Props = $props();

  let group: GroupView | null = $state(null);
  let allGroups: GroupView[] = $state([]);
  let contactList: Contact[] = $state([]);
  let error = $state('');
  let loadError = $state('');
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
  let selected: string[] = $state([]);
  let forkTarget = $state('');

  // Route/teardown epoch: bumped on every id change, on unmount, and when a
  // groups event drops our group. Mutation lifecycles check it before touching
  // busy flags, notes or errors, so a newer route's state is never cleared.
  let generation = 0;
  // Newer-event marker: bumped on every groups event. It guards applying stale
  // DATA only and never extends a mutation lifecycle.
  let eventSeq = 0;
  let alive = false;

  // Same mounted route still live (mutation lifecycle guard).
  function routeLive(token: number, target: string): boolean {
    return alive && token === generation && target === id;
  }

  // Same route with no newer event since `seen` (stale-data guard).
  function dataLive(token: number, target: string, seen: number): boolean {
    return routeLive(token, target) && seen === eventSeq;
  }

  // One mutation at a time: a second action while any runs is ignored, and all
  // controls below render this lock through their disabled state.
  const anyBusy = $derived(
    sending || proposing || consenting !== null || welcoming || dismissing,
  );

  function handleFor(memberId: string): string {
    const member = group?.members?.find((m) => m.id === memberId);
    if (member) return memberName(member.handle, member.displayName);
    const contact = contactList.find((c) => c.memberId === memberId);
    return contact ? memberName(contact.handle, contact.displayName) : s.unknownMember;
  }

  const selectedHandles: string[] = $derived(selected.map((memberId) => handleFor(memberId)));

  function toggleMember(memberId: string, checked: boolean) {
    selected = checked
      ? [...new Set([...selected, memberId])]
      : selected.filter((m) => m !== memberId);
  }

  async function load(target: string, token: number, seen: number) {
    let list: GroupView[];
    try {
      list = await client.groups();
    } catch (e) {
      if (!dataLive(token, target, seen)) return;
      loadError = e instanceof Error ? e.message : s.loadFailed;
      loading = false;
      return;
    }
    if (!dataLive(token, target, seen)) return;
    allGroups = list;
    const next = list.find((g) => g.id === target) ?? null;
    group = next;
    if (!next) loadError = s.unavailable;
    loading = false;
    let contacts: Contact[] = [];
    try {
      contacts = await client.contacts();
    } catch {
      return;
    }
    if (!dataLive(token, target, seen)) return;
    contactList = contacts;
  }

  async function refreshInto(token: number, target: string, seen: number): Promise<void> {
    let list: GroupView[];
    try {
      list = await client.groups();
    } catch {
      return;
    }
    if (!dataLive(token, target, seen)) return;
    allGroups = list;
    const next = list.find((g) => g.id === target) ?? null;
    if (next) {
      group = next;
      return;
    }
    generation += 1;
    group = null;
    loading = false;
    loadError = s.unavailable;
  }

  $effect(() => {
    const target = id;
    generation += 1;
    const token = generation;
    const seen = eventSeq;
    error = '';
    loadError = '';
    forkNote = '';
    welcomeNote = '';
    group = null;
    allGroups = [];
    contactList = [];
    draft = '';
    forkLabel = '';
    forkDetail = '';
    selected = [];
    forkTarget = '';
    sending = false;
    proposing = false;
    consenting = null;
    welcoming = false;
    dismissing = false;
    loading = true;
    void load(target, token, seen);
  });

  onMount(() => {
    alive = true;
    const off = client.subscribe((event) => {
      if (!alive || event.type !== 'groups') return;
      const target = id;
      allGroups = event.groups;
      const found = event.groups.find((g) => g.id === target);
      eventSeq += 1;
      if (found) {
        group = found;
        loading = false;
        loadError = '';
      } else {
        // Membership invalidated: clear now and stop any old load restoring it.
        generation += 1;
        group = null;
        loading = false;
        loadError = s.unavailable;
        sending = proposing = welcoming = dismissing = false;
        consenting = null;
      }
    });
    return () => {
      alive = false;
      generation += 1;
      off();
    };
  });

  async function send() {
    const target = id;
    const token = generation;
    if (anyBusy) return;
    const text = draft.trim();
    if (!text || !group) return;
    sending = true;
    error = '';
    try {
      await client.sendGroupMessage(target, text);
      if (!routeLive(token, target)) return;
      // Locked during send, so only clear text this request actually delivered.
      if (draft.trim() === text) draft = '';
      await refreshInto(token, target, eventSeq);
    } catch (e) {
      if (routeLive(token, target)) error = e instanceof Error ? e.message : s.sendFailed;
    } finally {
      if (routeLive(token, target)) sending = false;
    }
  }

  async function propose() {
    const target = id;
    const token = generation;
    if (anyBusy) return;
    if (!group) return;
    const label = forkLabel.trim();
    if (!label) {
      error = s.emptyProposal;
      return;
    }
    const detail = forkDetail.trim();
    const roster = [...selected];
    const wantTarget = forkKind === 'merge' ? forkTarget : '';
    proposing = true;
    error = '';
    forkNote = '';
    const seen = eventSeq;
    try {
      const proposal: GroupForkProposal = { groupId: target, kind: forkKind, label, detail };
      if (roster.length > 0) proposal.memberIds = roster;
      if (wantTarget) proposal.targetGroupId = wantTarget;
      // Authoritative result: the returned view proves the recorded proposal.
      const updated = await client.proposeFork(proposal);
      if (!routeLive(token, target)) return;
      if (seen === eventSeq) {
        // No newer event arrived; apply the returned view directly.
        group = updated;
        allGroups = allGroups.some((g) => g.id === target)
          ? allGroups.map((g) => (g.id === target ? updated : g))
          : [...allGroups, updated];
      }
      // Fields were locked during the request, so clearing cannot drop edits.
      forkNote = s.proposalRecorded;
      forkLabel = '';
      forkDetail = '';
      selected = [];
      forkTarget = '';
    } catch (e) {
      if (routeLive(token, target)) error = e instanceof Error ? e.message : s.proposeFailed;
    } finally {
      if (routeLive(token, target)) proposing = false;
    }
  }

  async function consent(forkId: string) {
    const target = id;
    const token = generation;
    if (anyBusy) return;
    if (!group) return;
    consenting = forkId;
    error = '';
    forkNote = '';
    try {
      // Authoritative result: the returned group proves the consent outcome.
      const moved = await client.consentFork(target, forkId);
      if (!routeLive(token, target)) return;
      forkNote = `${s.consentRecordedIn} “${moved.name}”. ${s.nonmoversNote}`;
      await refreshInto(token, target, eventSeq);
    } catch (e) {
      if (routeLive(token, target)) error = e instanceof Error ? e.message : s.consentFailed;
    } finally {
      if (routeLive(token, target)) consenting = null;
    }
  }

  async function welcome() {
    const target = id;
    const token = generation;
    if (anyBusy) return;
    if (!group) return;
    welcoming = true;
    error = '';
    welcomeNote = '';
    try {
      const reply = await client.welcomeMember(target);
      if (!routeLive(token, target)) return;
      welcomeNote = reply;
    } catch (e) {
      if (routeLive(token, target)) error = e instanceof Error ? e.message : s.welcomeFailed;
    } finally {
      if (routeLive(token, target)) welcoming = false;
    }
  }

  async function dismiss() {
    const target = id;
    const token = generation;
    if (!group || anyBusy) return;
    dismissing = true;
    error = '';
    try {
      await client.dismissGroupSuggestion(target);
      if (routeLive(token, target)) await refreshInto(token, target, eventSeq);
    } catch (e) {
      if (routeLive(token, target)) error = e instanceof Error ? e.message : s.dismissFailed;
    } finally {
      if (routeLive(token, target)) dismissing = false;
    }
  }

</script>

<section class="page group-detail" aria-labelledby="group-title">
  {#if error || loadError}<Notice tone="error">{error || loadError}</Notice>{/if}
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
        <Button disabled={anyBusy} onclick={() => void dismiss()} busy={dismissing} busyLabel={s.dismissBusy}>
          {s.suggestionDismiss}
        </Button>
      </div>
    {/if}
    {#if forkNote}<Notice tone="success">{forkNote}</Notice>{/if}

    {#if group.welcomePrompt}
      <h2>{s.welcomeAction}</h2>
      <p>{group.welcomePrompt}</p>
      <div class="row">
        <Button disabled={anyBusy} onclick={() => void welcome()} busy={welcoming} busyLabel={s.welcomeBusy}>
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
          disabled={anyBusy}
        />
        <Button disabled={anyBusy} type="submit" variant="primary" busy={sending} busyLabel={s.sendBusy}>{s.send}</Button>
      </form>
      <p class="muted">{s.directContactNote}</p>

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
                  {fork.proposedRoster.map((memberId) => handleFor(memberId)).join(', ')}
                {:else}
                  <span class="muted">{s.emptyRoster}</span>
                {/if}
              </p>
              {#if fork.consented}
                <p class="muted">{s.consentedLabel}. {s.nonmoversNote}</p>
              {:else}
                <Button
                  disabled={anyBusy}
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
          <select
            id="fork-kind"
            value={forkKind}
            disabled={anyBusy}
            onchange={(e) => (forkKind = e.currentTarget.value as GroupForkProposal['kind'])}
          >
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
            autocomplete="off"
            disabled={anyBusy}
          />
        </div>
        <div class="field">
          <label for="fork-detail">{s.detailLabel}</label>
          <textarea
            id="fork-detail"
            value={forkDetail}
            oninput={(e) => (forkDetail = e.currentTarget.value)}
            placeholder={s.detailPlaceholder}
            rows="2"
            disabled={anyBusy}
          ></textarea>
        </div>
        {#if group.members && group.members.length > 0}
          <fieldset class="field" disabled={anyBusy}>
            <legend>{s.rosterLabel}</legend>
            <p class="muted">{s.rosterHint}</p>
            {#each group.members as member (member.id)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  onchange={(e) => toggleMember(member.id, e.currentTarget.checked)}
                />
                {handleFor(member.id)}
              </label>
            {/each}
            {#if selected.length > 0}
              <p><strong>{s.rosterPreviewLabel}:</strong> {selectedHandles.join(', ')}</p>
            {/if}
          </fieldset>
        {:else}
          <p class="muted">{s.emptyRoster}</p>
        {/if}
        {#if forkKind === 'merge'}
          <div class="field">
            <label for="fork-target">{s.targetLabel}</label>
            <select
              id="fork-target"
              value={forkTarget}
              disabled={anyBusy}
              onchange={(e) => (forkTarget = e.currentTarget.value)}
            >
              <option value="">{s.targetNone}</option>
              {#each allGroups.filter((g) => g.id !== group.id) as candidate (candidate.id)}
                <option value={candidate.id}>{candidate.name}</option>
              {/each}
            </select>
            <p class="muted">{s.targetHint}</p>
          </div>
        {/if}
        <Button disabled={anyBusy} type="submit" variant="primary" busy={proposing} busyLabel={s.proposeBusy}>
          {s.proposeAction}
        </Button>
      </form>
    {:else}
      <p>{s.hiddenNote}</p>
      <p class="muted">{s.directContactNote}</p>
    {/if}
  {:else if !error && !loadError && loading}
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
  .field label,
  .field legend {
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
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-weight: 400;
  }
  .check input {
    width: auto;
  }
</style>
