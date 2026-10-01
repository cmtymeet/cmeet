<script lang="ts">
  interface Props {
    title: string;
    hint?: string;
    actionLabel?: string;
    onaction?: () => void;
  }
  let { title, hint = '', actionLabel = '', onaction }: Props = $props();
</script>

<div class="empty">
  <h2>{title}</h2>
  {#if hint}<p>{hint}</p>{/if}
  {#if actionLabel}<button class="btn" onclick={() => onaction?.()}>{actionLabel}</button>{/if}
</div>

<style>
  .empty { text-align: center; padding: 2.5rem 1rem; color: var(--cmeet-muted); }
  .empty h2 { color: var(--cmeet-ink); }
  .btn {
    font: inherit; border-radius: var(--cmeet-radius); border: 1px solid var(--cmeet-line);
    padding: 0.6rem 1rem; background: var(--cmeet-surface); color: var(--cmeet-ink); cursor: pointer;
  }
  .btn:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
</style>
