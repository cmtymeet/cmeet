<script lang="ts">
  import type { Wave } from '../../../core/src/cmsg.js';
  interface Props {
    wave: Wave;
    answerLabel?: string;
    closeLabel?: string;
    punishLabel?: string;
    punishNote?: string;
    disabled?: boolean;
    onanswer?: (id: string) => void;
    onclose?: (id: string) => void;
    onpunish?: (id: string) => void;
  }
  let {
    wave, answerLabel = 'Answer', closeLabel = 'Respectfully close', punishLabel = 'Punish',
    punishNote = 'Punish costs both participants and blocks the sender.',
    disabled = false, onanswer, onclose, onpunish,
  }: Props = $props();
</script>

<article class="wave" aria-label={`First contact from ${wave.fromHandle}`}>
  <h3>First contact from {wave.fromHandle}</h3>
  <p class="message">{wave.message}</p>
  <div class="actions">
    <button class="btn primary" disabled={disabled || wave.state !== 'pending'} onclick={() => onanswer?.(wave.id)}>{answerLabel}</button>
    <button class="btn" disabled={disabled || wave.state !== 'pending'} onclick={() => onclose?.(wave.id)}>{closeLabel}</button>
    <button class="btn danger" disabled={disabled || wave.state !== 'pending'} onclick={() => onpunish?.(wave.id)}>{punishLabel}</button>
  </div>
  <p class="note">{punishNote}</p>
  {#if wave.state !== 'pending'}<p class="state">Status: {wave.state}</p>{/if}
</article>

<style>
  .wave { border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius); padding: 1rem; background: var(--cmeet-surface); }
  h3 { margin: 0 0 0.4rem; }
  .message { font-size: 1.05rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; }
  .btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.55rem 0.9rem; background: var(--cmeet-surface); color: var(--cmeet-ink);
    cursor: pointer; min-height: 2.75rem;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn.primary { background: var(--cmeet-accent); border-color: var(--cmeet-accent); color: var(--cmeet-accent-ink); }
  .btn.danger { background: var(--cmeet-danger-bg); border-color: var(--cmeet-danger); color: var(--cmeet-danger); }
  .note, .state { font-size: 0.9rem; color: var(--cmeet-muted); }
</style>
