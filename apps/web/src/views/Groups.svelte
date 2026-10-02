<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CmsgClient, GroupView } from '../../../../core/src/cmsg.js';
  import { Notice, EmptyState, GroupCard, Dialog, Button, LevelBadge } from '../../../../ui/src/index.js';
  import { groupsStrings as t } from '../strings/groups.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let groups: GroupView[] = $state([]);
  let loaded = $state(false);
  let loading = $state(true);
  let loadError = $state('');
  let actionError = $state('');
  let pendingJoin: GroupView | null = $state(null);
  let consentChecked = $state(false);
  let joinBusyId: string | null = $state(null);
  let leaveBusyId: string | null = $state(null);
  let dialogBusy = $state(false);
  let loadSeq = 0;
  let errorRef: HTMLElement | null = $state(null);

  function focusError() {
    void tick().then(() => errorRef?.focus());
  }

  function messageOf(e: unknown, fallback: string): string {
    return e instanceof Error && e.message ? e.message : fallback;
  }

  // Presentation gate only: rooms and openings always confirm visibility
  // consent in the dialog; circles and ingroups join directly unless the
  // supplied view carries consent text. No size arithmetic here.
  function requiresConsent(group: GroupView): boolean {
    return group.joinConsent !== null || group.level === 'room' || group.level === 'opening';
  }

  async function load() {
    loading = true;
    loadError = '';
    const seq = ++loadSeq;
    try {
      const next = await client.groups();
      if (seq !== loadSeq) return;
      groups = next;
      loaded = true;
    } catch (e) {
      if (seq !== loadSeq) return;
      loaded = true;
      loadError = messageOf(e, t.loadFailed);
      focusError();
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  async function refresh() {
    loadSeq += 1;
    const seq = loadSeq;
    try {
      const next = await client.groups();
      if (seq !== loadSeq) return;
      groups = next;
      loaded = true;
    } catch (e) {
      if (seq !== loadSeq) return;
      loadError = messageOf(e, t.loadFailed);
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'groups') {
        // Live updates are fresher than any in-flight load; invalidate it.
        loadSeq += 1;
        groups = event.groups;
        loaded = true;
        loading = false;
      }
    });
  });

  function askJoin(id: string) {
    if (joinBusyId !== null || leaveBusyId !== null || dialogBusy) return;
    const group = groups.find((g) => g.id === id);
    if (!group) return;
    actionError = '';
    if (!requiresConsent(group)) {
      void doJoin(id, undefined);
      return;
    }
    consentChecked = false;
    pendingJoin = group;
  }

  async function doJoin(id: string, consent: true | undefined) {
    if (joinBusyId !== null || dialogBusy) return;
    if (consent === true) dialogBusy = true;
    else joinBusyId = id;
    actionError = '';
    try {
      if (consent === true) {
        await client.joinGroup(id, true);
      } else {
        await client.joinGroup(id);
      }
      pendingJoin = null;
      await refresh();
      window.location.hash = `#/groups/${encodeURIComponent(id)}`;
    } catch (e) {
      actionError = messageOf(e, t.joinFailed);
      focusError();
    } finally {
      joinBusyId = null;
      dialogBusy = false;
    }
  }

  function confirmJoin() {
    if (!pendingJoin || !consentChecked || dialogBusy) return;
    void doJoin(pendingJoin.id, true);
  }

  async function leave(id: string) {
    if (joinBusyId !== null || leaveBusyId !== null || dialogBusy) return;
    leaveBusyId = id;
    actionError = '';
    try {
      await client.leaveGroup(id);
      await refresh();
    } catch (e) {
      actionError = messageOf(e, t.leaveFailed);
      focusError();
    } finally {
      leaveBusyId = null;
    }
  }

  function closeDialog() {
    if (dialogBusy) return;
    pendingJoin = null;
  }
</script>

<section class="page groups" aria-labelledby="groups-title">
  <div class="groups-head">
    <div>
      <h1 id="groups-title">{t.title}</h1>
      <p class="muted">{t.lead}</p>
    </div>
    <Button busy={loading} busyLabel={t.loading} onclick={() => void load()}>{t.retry}</Button>
  </div>
  {#if loadError && groups.length === 0}
    <div bind:this={errorRef} tabindex="-1" class="groups-error">
      <Notice tone="error">{loadError}</Notice>
    </div>
  {:else if actionError}
    <div bind:this={errorRef} tabindex="-1" class="groups-error">
      <Notice tone="error">{actionError}</Notice>
    </div>
  {:else if loadError}
    <Notice tone="error">{loadError}</Notice>
  {/if}
  {#if loading && !loaded}
    <p aria-live="polite">{t.loading}</p>
  {:else if groups.length === 0 && !loadError}
    <EmptyState title={t.emptyTitle} hint={t.emptyHint} />
  {:else if groups.length > 0}
    <div class="grid">
      {#each groups as group (group.id)}
        <GroupCard
          {group}
          levelLabels={t.level}
          joinLabel={t.join}
          leaveLabel={t.leave}
          joinedLabel={t.joined}
          nextLabel={t.whatChangesNext}
          notificationsLabel={t.notificationsLabel}
          paceLabel={t.paceLabel}
          joiningLabel={t.joiningLabel}
          historyLabel={t.historyLabel}
          openingLabel={t.openingLabel}
          seatLabel={t.seatLabel}
          suggestionLabel={t.suggestionLabel}
          membersLabel={t.members}
          joinBusy={joinBusyId === group.id}
          leaveBusy={leaveBusyId === group.id}
          onjoin={(id) => askJoin(id)}
          onleave={(id) => void leave(id)}
          onopen={(id) => (window.location.hash = `#/groups/${encodeURIComponent(id)}`)}
        />
      {/each}
    </div>
  {/if}
  {#if pendingJoin}
    <Dialog open labelledBy="join-title" describedBy="join-consent" onclose={closeDialog}>
      <h2 id="join-title">{t.joinTitlePrefix} {pendingJoin.name}</h2>
      <p class="groups-dialog-meta">
        <LevelBadge level={pendingJoin.level} labels={t.level} />
        <span class="muted">{pendingJoin.size} {t.members}</span>
      </p>
      <p class="muted"><strong>{t.whatChangesNext}:</strong> {pendingJoin.whatChangesNext}</p>
      <p id="join-consent">{pendingJoin.joinConsent ?? t.consentCheckbox}</p>
      <label class="consent-row" for="join-consent-check">
        <input
          id="join-consent-check"
          type="checkbox"
          checked={consentChecked}
          onchange={(e) => (consentChecked = e.currentTarget.checked)}
        />
        {t.consentCheckbox}
      </label>
      <p class="muted">{t.consentNote}</p>
      <div class="dialog-actions">
        <Button variant="primary" disabled={!consentChecked} busy={dialogBusy} busyLabel={t.joiningBusy} onclick={confirmJoin}>
          {t.joinTitlePrefix} {pendingJoin.name}
        </Button>
        <Button onclick={closeDialog}>{t.cancel}</Button>
      </div>
    </Dialog>
  {/if}
</section>

<style>
  .groups {
    min-width: 0;
  }
  .groups-head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .groups-error {
    outline: none;
  }
  .groups-error:focus {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
    border-radius: var(--cmeet-radius);
  }
  .groups-dialog-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .consent-row {
    display: flex;
    gap: 0.5rem;
    align-items: start;
    margin-top: 0.75rem;
    cursor: pointer;
  }
  .consent-row input {
    width: 1.25rem;
    height: 1.25rem;
    margin-top: 0.15rem;
  }
  .consent-row input:focus-visible {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
  .dialog-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }
</style>
