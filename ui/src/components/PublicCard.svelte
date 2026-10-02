<script lang="ts">
  import { memberName } from '../member-name.js';
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
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? `${value.latitude}, ${value.longitude}` : value}`)
      .join(', ');
  }
</script>

<article class="card" aria-label={`Public profile of ${memberName(card.handle, card.displayName)}`}>
  <div class="top">
    <span class="avatar" aria-hidden="true">{card.handle.slice(0, 1).toUpperCase()}</span>
    <div>
      <h3>{memberName(card.handle, card.displayName)}</h3>
      <p class="presence">{card.online ? 'Online' : 'Offline'}</p>
    </div>
  </div>
  <p class="values">{describeValues()}</p>
  <section class="record" aria-label="Introduction outcomes">
    {#if card.record?.status === 'available'}
      <dl>
        <div><dt>Accepted</dt><dd>{new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(card.record.accepted)}</dd></div>
        <div><dt>Declined</dt><dd>{new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(card.record.declined)}</dd></div>
        <div><dt>Punished</dt><dd>{new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(card.record.punished)}</dd></div>
      </dl>
      <p>Shares of introduction outcomes, shown after enough responses and a current record check. These are context, not a rating of a person.</p>
    {:else}
      <p>Introduction outcomes are available only after enough responses and a current record check.</p>
    {/if}
  </section>
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
  .record { color: var(--cmeet-muted); font-size: 0.9rem; }
  dl { display: flex; flex-wrap: wrap; gap: 1rem; }
  dd { margin: 0; color: var(--cmeet-ink); }
  .btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.55rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
</style>
