<script lang="ts">
  // Real snippet-children harness for Dialog rerender tests.
  // Owns `open` like a production parent: Dialog only requests close,
  // this harness decides. Exercises implicit snippet children, label
  // association and open -> closed -> open rerender with focus restore.
  import Dialog from '../../../../ui/src/components/Dialog.svelte';

  interface Props {
    labelledBy?: string;
    startOpen?: boolean;
    onclose?: () => void;
  }

  let { labelledBy = 'harness-title', startOpen = true, onclose }: Props = $props();
  let open = $state(startOpen);

  function handleClose(): void {
    open = false;
    onclose?.();
  }
</script>

<button type="button" data-testid="opener" onclick={() => (open = true)}>Open dialog</button>
<Dialog {open} {labelledBy} onclose={handleClose}>
  <h2 id={labelledBy}>Harness dialog</h2>
  <p>Real snippet children.</p>
  <button type="button" data-testid="inner-close" onclick={handleClose}>Close</button>
</Dialog>
