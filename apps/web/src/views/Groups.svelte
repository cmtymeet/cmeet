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
  let dialogError = $state('');
  let pendingJoin: GroupView | null = $state(null);
  let consentChecked = $state(false);
  let joinBusyId: string | null = $state(null);
  let leaveBusyId: string | null = $state(null);
  let dialogBusy = $state(false);
  // Teardown generation: bumped only on unmount. Async completions check it
  // so late responses never touch state or navigate after teardown. Kept
  // separate from loadSeq so an action's own cmsg events cannot invalidate
  // its completion.
  let alive = true;
  let lifecycle = 0;
  let loadSeq = 0;
  let errorRef: HTMLElement | null = $state(null);
  let dialogErrorRef: HTMLElement | null = $state(null);
  // Every card locks its mutation buttons while any join/leave is pending or
  // the consent dialog is open (background is inert); navigation stays live.
  let cardsLocked = $derived(
    joinBusyId !== null || leaveBusyId !== null || dialogBusy || pendingJoin !== null,
  );

  function focusError() {
    void tick().then(() => errorRef?.focus());
  }

  function focusDialogError() {
    void tick().then(() => dialogErrorRef?.focus());
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
    const life = lifecycle;
    const seq = ++loadSeq;
    try {
      const next = await client.groups();
      if (!alive || life !== lifecycle || seq !== loadSeq) return;
      groups = next;
      loaded = true;
      loadError = '';
    } catch (e) {
      if (!alive || life !== lifecycle || seq !== loadSeq) return;
      loaded = true;
      loadError = messageOf(e, t.loadFailed);
      focusError();
    } finally {
      if (alive && life === lifecycle && seq === loadSeq) loading = false;
    }
  }

  async function refresh() {
    const life = lifecycle;
    const seq = ++loadSeq;
    try {
      const next = await client.groups();
      if (!alive || life !== lifecycle || seq !== loadSeq) return;
      groups = next;
      loaded = true;
      loadError = '';
    } catch (e) {
      if (!alive || life !== lifecycle || seq !== loadSeq) return;
      loadError = messageOf(e, t.loadFailed);
    }
  }

  onMount(() => {
    alive = true;
    void load();
    const stop = client.subscribe((event) => {
      if (!alive) return;
      if (event.type === 'groups') {
        // Live updates are fresher than any in-flight load; invalidate it.
        // A successful refresh/event also clears a stale load error.
        loadSeq += 1;
        groups = event.groups;
        loaded = true;
        loading = false;
        loadError = '';
      }
    });
    return () => {
      alive = false;
      lifecycle += 1;
      loadSeq += 1;
      stop();
    };
  });

  function askJoin(id: string) {
    if (pendingJoin !== null || joinBusyId !== null || leaveBusyId !== null || dialogBusy) return;
    const group = groups.find((g) => g.id === id);
    if (!group) return;
    actionError = '';
    if (!requiresConsent(group)) {
      void doJoin(id, undefined);
      return;
    }
    consentChecked = false;
    dialogError = '';
    pendingJoin = group;
  }

  async function doJoin(id: string, consent: true | undefined) {
    if (joinBusyId !== null || dialogBusy) return;
    const life = lifecycle;
    if (consent === true) dialogBusy = true;
    else joinBusyId = id;
    actionError = '';
    if (consent === true) dialogError = '';
    try {
      if (consent === true) {
        await client.joinGroup(id, true);
      } else {
        await client.joinGroup(id);
      }
      if (!alive || life !== lifecycle) return;
      pendingJoin = null;
      dialogError = '';
      await refresh();
      if (!alive || life !== lifecycle) return;
      window.location.hash = `#/groups/${encodeURIComponent(id)}`;
    } catch (e) {
      if (!alive || life !== lifecycle) return;
      if (consent === true) {
        dialogError = messageOf(e, t.joinFailed);
        focusDialogError();
      } else {
        actionError = messageOf(e, t.joinFailed);
        focusError();
      }
    } finally {
      if (alive && life === lifecycle) {
        joinBusyId = null;
        dialogBusy = false;
      }
    }
  }

  function confirmJoin() {
    if (!pendingJoin || !consentChecked || dialogBusy) return;
    void doJoin(pendingJoin.id, true);
  }

  async function leave(id: string) {
    if (pendingJoin !== null || joinBusyId !== null || leaveBusyId !== null || dialogBusy) return;
    const life = lifecycle;
    leaveBusyId = id;
    actionError = '';
    try {
      await client.leaveGroup(id);
      if (!alive || life !== lifecycle) return;
      await refresh();
    } catch (e) {
      if (!alive || life !== lifecycle) return;
      actionError = messageOf(e, t.leaveFailed);
      focusError();
    } finally {
      if (alive && life === lifecycle) leaveBusyId = null;
    }
  }

  function closeDialog() {
    if (dialogBusy) return;
    dialogError = '';
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
          disabled={cardsLocked}
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
      <p id="join-consent">{pendingJoin.joinConsent ?? t.consentFallback}</p>
      <label class="consent-row" for="join-consent-check">
        <input
          id="join-consent-check"
          type="checkbox"
          checked={consentChecked}
          disabled={dialogBusy}
          onchange={(e) => (consentChecked = e.currentTarget.checked)}
        />
        {t.consentCheckbox}
      </label>
      <p class="muted">{t.consentNote}</p>
      {#if dialogError}
        <div bind:this={dialogErrorRef} tabindex="-1" class="groups-error">
          <Notice tone="error">{dialogError}</Notice>
        </div>
      {/if}
      <div class="dialog-actions">
        <Button variant="primary" disabled={!consentChecked} busy={dialogBusy} busyLabel={t.joiningBusy} onclick={confirmJoin}>
          {t.joinTitlePrefix} {pendingJoin.name}
        </Button>
        <Button disabled={dialogBusy} onclick={closeDialog}>{t.cancel}</Button>
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
