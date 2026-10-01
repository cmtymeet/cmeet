<script lang="ts">
  // Accessible dialog: labelled, modal, closes on Escape, moves focus in.
  interface Props {
    open: boolean;
    labelledBy: string;
    describedBy?: string;
    onclose?: () => void;
    children?: import('svelte').Snippet;
  }
  let { open, labelledBy, describedBy, onclose, children }: Props = $props();
  let dialogEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (open) {
      const target = dialogEl?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      (target ?? dialogEl)?.focus();
    }
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose?.();
  }
</script>

{#if open}
  <div class="scrim" onclick={() => onclose?.()} aria-hidden="true"></div>
  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    tabindex="-1"
    {onkeydown}
  >
    {@render children?.()}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); }
  .dialog {
    position: fixed; inset-inline: 1rem; top: 10vh; max-width: 32rem; margin-inline: auto;
    background: var(--cmeet-surface); color: var(--cmeet-ink);
    border-radius: var(--cmeet-radius); padding: 1.25rem;
    box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.25);
  }
  .dialog:focus { outline: 3px solid var(--cmeet-focus); outline-offset: 2px; }
</style>
