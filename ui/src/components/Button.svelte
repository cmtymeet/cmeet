<script lang="ts">
  interface Props {
    variant?: 'primary' | 'secondary' | 'danger' | 'text';
    type?: 'button' | 'submit';
    disabled?: boolean;
    busy?: boolean;
    busyLabel?: string;
    onclick?: (event: MouseEvent) => void;
    children?: import('svelte').Snippet;
  }
  let { variant = 'secondary', type = 'button', disabled = false, busy = false, busyLabel = 'Loading…', onclick, children }: Props = $props();
</script>

<button
  {type}
  class="btn btn-{variant}"
  disabled={disabled || busy}
  aria-busy={busy || undefined}
  {onclick}
>
  {#if busy}<span class="spinner" aria-hidden="true"></span> {busyLabel}{:else}{@render children?.()}{/if}
</button>

<style>
  .btn {
    font: inherit;
    border-radius: var(--cmeet-radius);
    border: 1px solid var(--cmeet-line);
    padding: 0.6rem 1rem;
    cursor: pointer;
    background: var(--cmeet-surface);
    color: var(--cmeet-ink);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-primary { background: var(--cmeet-accent); border-color: var(--cmeet-accent); color: var(--cmeet-accent-ink); }
  .btn-danger { background: var(--cmeet-danger-bg); border-color: var(--cmeet-danger); color: var(--cmeet-danger); }
  .btn-text { border-color: transparent; background: transparent; text-decoration: underline; padding: 0.25rem 0.5rem; min-height: 0; }
  .spinner {
    width: 1em; height: 1em; border-radius: 50%;
    border: 2px solid currentColor; border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
