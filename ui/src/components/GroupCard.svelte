<script lang="ts">
  import type { GroupView } from '../../../core/src/cmsg.js';
  import LevelBadge from './LevelBadge.svelte';
  interface Props {
    group: GroupView;
    levelLabels?: { circle: string; ingroup: string; room: string };
    joinLabel?: string;
    leaveLabel?: string;
    joinedLabel?: string;
    nextLabel?: string;
    onjoin?: (id: string) => void;
    onleave?: (id: string) => void;
    onopen?: (id: string) => void;
  }
  let {
    group, levelLabels, joinLabel = 'Join', leaveLabel = 'Leave', joinedLabel = 'Joined',
    nextLabel = 'What changes next', onjoin, onleave, onopen,
  }: Props = $props();
</script>

<article class="group" aria-label={`${group.name}, ${group.size} members`}>
  <div class="top">
    <div>
      <h3><button class="link" onclick={() => onopen?.(group.id)}>{group.name}</button></h3>
      <p class="meta">{group.size} members</p>
    </div>
    <LevelBadge level={group.level} labels={levelLabels} />
  </div>
  <p>{group.description}</p>
  <p class="next"><strong>{nextLabel}:</strong> {group.whatChangesNext}</p>
  {#if group.suggestion}<p class="suggestion">{group.suggestion}</p>{/if}
  <div class="actions">
    {#if group.joined}
      <span class="joined">{joinedLabel}</span>
      <button class="btn" onclick={() => onleave?.(group.id)}>{leaveLabel}</button>
    {:else}
      <button class="btn primary" onclick={() => onjoin?.(group.id)}>{joinLabel}</button>
    {/if}
  </div>
</article>

<style>
  .group { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 1rem; background: var(--cmeet-surface); }
  .top { display: flex; justify-content: space-between; align-items: start; gap: 0.5rem; }
  h3 { margin: 0; }
  .link { font: inherit; font-weight: 700; background: none; border: 0; padding: 0; cursor: pointer; color: var(--cmeet-ink); text-decoration: underline; }
  .link:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .meta { margin: 0.15rem 0 0; color: var(--cmeet-muted); }
  .next, .suggestion { font-size: 0.92rem; }
  .suggestion { background: var(--cmeet-accent-soft); border-radius: 8px; padding: 0.5rem 0.7rem; }
  .actions { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
  .joined { font-weight: 700; color: var(--cmeet-accent); }
  .btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.55rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .btn.primary { background: var(--cmeet-accent); border-color: var(--cmeet-accent); color: var(--cmeet-accent-ink); }
</style>
