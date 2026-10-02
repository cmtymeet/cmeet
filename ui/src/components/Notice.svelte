<script lang="ts">
  interface Props {
    tone?: 'info' | 'warning' | 'error' | 'success';
    title?: string;
    children?: import('svelte').Snippet;
  }
  let { tone = 'info', title = '', children }: Props = $props();
  const alert = $derived(tone === 'error' || tone === 'warning');
</script>

<div class={`notice notice-${tone}`} role={alert ? 'alert' : 'status'}>
  {#if title}<strong>{title}</strong>{/if}
  <div>{@render children?.()}</div>
</div>

<style>
  .notice {
    border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius);
    padding: 0.8rem 1rem; background: var(--cmeet-surface); margin-block: 0.75rem;
  }
  .notice-warning { background: var(--cmeet-warn-bg); color: var(--cmeet-warn-ink); border-color: transparent; }
  .notice-error { background: var(--cmeet-danger-bg); color: var(--cmeet-danger); border-color: transparent; }
  .notice-success { background: var(--cmeet-accent-soft); }
  strong { display: block; margin-bottom: 0.25rem; }
  div { margin: 0; }
</style>
