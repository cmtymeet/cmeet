<script lang="ts">
  import type { PublicCard } from '../../../core/src/cmsg.js';
  interface Props {
    card: PublicCard;
    actionLabel?: string;
    disabled?: boolean;
    onaction?: (memberId: string) => void;
  }
  let { card, actionLabel = 'Want to know more', disabled = false, onaction }: Props = $props();

  function describeValues(): string {
    return Object.entries(card.values)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }
</script>

<article class="card" aria-label={`Public profile of ${card.handle}`}>
  <div class="top">
    <span class="avatar" aria-hidden="true">{card.handle.slice(0, 1).toUpperCase()}</span>
    <div>
      <h3>{card.handle}</h3>
      <p class="presence">{card.online ? 'Online' : 'Offline'}</p>
    </div>
  </div>
  <p class="values">{describeValues()}</p>
  {#if card.record}
    <p class="record">Welcomed by {Math.round(card.record.accepted * 100)}% of first contacts</p>
  {/if}
  <button class="btn" {disabled} onclick={() => onaction?.(card.memberId)}>{actionLabel}</button>
</article>

<style>
  .card { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 1rem; background: var(--cmeet-surface); }
  .top { display: flex; gap: 0.75rem; align-items: center; }
  .avatar {
    width: 2.5rem; height: 2.5rem; border-radius: 50%; flex: none;
    background: var(--cmeet-accent-soft); display: inline-flex;
    align-items: center; justify-content: center; font-weight: 700;
  }
  h3 { margin: 0; }
  .presence { margin: 0; color: var(--cmeet-muted); font-size: 0.9rem; }
  .values { margin: 0.6rem 0; }
  .record { font-size: 0.9rem; color: var(--cmeet-muted); }
  .btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.55rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
</style>
