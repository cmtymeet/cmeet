<script lang="ts">
  import type { GroupView } from '../../../core/src/cmsg.js';
  import LevelBadge from './LevelBadge.svelte';
  interface Props {
    group: GroupView;
    levelLabels?: { circle: string; ingroup: string; room: string; opening: string };
    joinLabel?: string;
    leaveLabel?: string;
    joinedLabel?: string;
    nextLabel?: string;
    notificationsLabel?: string;
    paceLabel?: string;
    joiningLabel?: string;
    historyLabel?: string;
    openingLabel?: string;
    seatLabel?: string;
    suggestionLabel?: string;
    membersLabel?: string;
    joinBusy?: boolean;
    leaveBusy?: boolean;
    onjoin?: (id: string) => void;
    onleave?: (id: string) => void;
    onopen?: (id: string) => void;
  }
  let {
    group,
    levelLabels,
    joinLabel = 'Join',
    leaveLabel = 'Leave',
    joinedLabel = 'Joined',
    nextLabel = 'What changes next',
    notificationsLabel = 'Notifications',
    paceLabel = 'Posting pace',
    joiningLabel = 'Joining',
    historyLabel = 'Newcomer history',
    openingLabel = 'Opening',
    seatLabel = 'Seat budget',
    suggestionLabel = 'Invitation',
    membersLabel = 'members',
    joinBusy = false,
    leaveBusy = false,
    onjoin,
    onleave,
    onopen,
  }: Props = $props();
  // Presentation only: every level, band and transition string below is
  // rendered verbatim from cmsg. This card never derives a level from size.
  const showSeat = $derived(group.seatBudget?.enabled === true);
</script>

<article class="group" aria-label={`${group.name}, ${group.size} ${membersLabel}`}>
  <div class="top">
    <div>
      <h3><button class="link" onclick={() => onopen?.(group.id)}>{group.name}</button></h3>
      <p class="meta">{group.size} {membersLabel}</p>
    </div>
    <LevelBadge level={group.level} labels={levelLabels} />
  </div>
  <p>{group.description}</p>
  <p class="next"><strong>{nextLabel}:</strong> {group.whatChangesNext}</p>
  {#if group.band}
    <dl class="band">
      <div><dt>{notificationsLabel}</dt><dd>{group.band.notifications}</dd></div>
      <div><dt>{paceLabel}</dt><dd>{group.band.postingPace}</dd></div>
      <div><dt>{joiningLabel}</dt><dd>{group.band.joining}</dd></div>
    </dl>
  {/if}
  {#if group.newcomerHistory}
    <p class="history"><strong>{historyLabel}:</strong> {group.newcomerHistory}</p>
  {/if}
  {#if group.opening}
    <p class="opening"><strong>{openingLabel}:</strong> {group.opening.progress} {group.opening.deadlineLabel}</p>
  {/if}
  {#if showSeat}
    <p class="seat"><strong>{seatLabel}:</strong> {group.seatBudget?.label}</p>
  {/if}
  {#if group.suggestion}<p class="suggestion"><strong>{suggestionLabel}:</strong> {group.suggestion}</p>{/if}
  <div class="actions">
    {#if group.joined}
      <span class="joined">{joinedLabel}</span>
      <button class="btn" disabled={leaveBusy} aria-busy={leaveBusy || undefined} onclick={() => onleave?.(group.id)}>{leaveLabel}</button>
    {:else}
      <button class="btn primary" disabled={joinBusy} aria-busy={joinBusy || undefined} onclick={() => onjoin?.(group.id)}>{joinLabel}</button>
    {/if}
  </div>
</article>

<style>
  .group { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 1rem; background: var(--cmeet-surface); min-width: 0; }
  .top { display: flex; justify-content: space-between; align-items: start; gap: 0.5rem; }
  h3 { margin: 0; }
  .link { font: inherit; font-weight: 700; background: none; border: 0; padding: 0; cursor: pointer; color: var(--cmeet-ink); text-decoration: underline; }
  .link:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .meta { margin: 0.15rem 0 0; color: var(--cmeet-muted); }
  .next, .history, .opening, .seat, .suggestion { font-size: 0.92rem; }
  .band { display: grid; gap: 0.35rem; margin: 0.6rem 0; padding: 0; font-size: 0.9rem; }
  .band div { display: grid; gap: 0.1rem; }
  .band dt { font-weight: 700; }
  .band dd { margin: 0; color: var(--cmeet-muted); }
  .suggestion { background: var(--cmeet-accent-soft); border-radius: 8px; padding: 0.5rem 0.7rem; }
  .actions { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; flex-wrap: wrap; }
  .joined { font-weight: 700; color: var(--cmeet-accent); }
  .btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.55rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
    min-height: 2.75rem;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn.primary { background: var(--cmeet-accent); border-color: var(--cmeet-accent); color: var(--cmeet-accent-ink); }
</style>
