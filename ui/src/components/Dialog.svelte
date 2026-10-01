<script lang="ts">
  // The browser manages modal focus. The parent controls `open`; cleanup
  // closes the dialog and restores its opener when dismissed or unmounted.
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    labelledBy: string;
    describedBy?: string;
    onclose?: () => void;
    children?: Snippet;
  }

  let { open, labelledBy, describedBy, onclose, children }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  // Dedupe user requests per open cycle. Plain (non-reactive) state keeps
  // the effect below keyed only on `open` and the bound dialog element.
  let requested = false;

  $effect(() => {
    const node = dialogEl;
    if (!node || !open) return;
    requested = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!node.open) node.showModal();
    return () => {
      if (node.open) node.close();
      if (opener && opener.isConnected) opener.focus();
    };
  });

  function requestClose() {
    if (!open || requested || !onclose) return;
    requested = true;
    onclose();
  }

  function handleCancel(event: Event) {
    // Escape: keep native close suppressed and let the parent decide.
    event.preventDefault();
    requestClose();
  }

  function handleBackdropClick(event: MouseEvent) {
    const node = dialogEl;
    if (!node || event.target !== node) return;
    // Padding clicks also target the dialog element, so only clicks with
    // pointer coordinates outside the bounding rectangle are backdrops.
    const rect = node.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside) requestClose();
  }
</script>

<dialog
  bind:this={dialogEl}
  aria-labelledby={labelledBy}
  aria-describedby={describedBy}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  {@render children?.()}
</dialog>

<style>
  dialog {
    position: fixed;
    inset-inline: 1rem;
    top: 10vh;
    bottom: auto;
    width: calc(100% - 2rem);
    max-width: 32rem;
    margin-inline: auto;
    margin-block: 0;
    background: var(--cmeet-surface);
    color: var(--cmeet-ink);
    border: none;
    border-radius: var(--cmeet-radius);
    padding: 1.25rem;
    box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.25);
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  dialog:focus {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
</style>
