<script lang="ts">
  import { untrack } from 'svelte';
  import Dialog from '../../../../../ui/src/components/Dialog.svelte';
  import ProgressBar from '../../../../../ui/src/components/ProgressBar.svelte';

  interface Props {
    startOpen?: boolean;
    progressInitial?: number;
  }
  let { startOpen = true, progressInitial = 0.25 }: Props = $props();

  // Controlled dialog: the harness owns `open`, so a refused dismissal keeps
  // the dialog mounted exactly like a busy parent would.
  let open = $state(untrack(() => startOpen));
  let refuseOnce = $state(false);
  let closeCount = $state(0);
  let progress = $state(untrack(() => progressInitial));

  function handleClose() {
    closeCount += 1;
    if (refuseOnce) {
      // Temporary refusal: stay open this time; the next request must still
      // reach the parent.
      refuseOnce = false;
      return;
    }
    open = false;
  }
</script>

{#if open}
  <Dialog {open} labelledBy="harness-title" onclose={handleClose}>
    <h2 id="harness-title">Harness dialog</h2>
    <p>Harness body.</p>
  </Dialog>
{/if}

<button type="button" data-testid="open-dialog" onclick={() => (open = true)}>Open dialog</button>
<button type="button" data-testid="refuse-once" onclick={() => (refuseOnce = true)}>Refuse next close</button>
<span data-testid="close-count">{closeCount}</span>
<span data-testid="dialog-state">{open ? 'open' : 'closed'}</span>

<ProgressBar value={progress} label="Loading" />
<button type="button" data-testid="progress-zero" onclick={() => (progress = 0)}>Set 0</button>
<button type="button" data-testid="progress-half" onclick={() => (progress = 0.5)}>Set half</button>
<button type="button" data-testid="progress-over" onclick={() => (progress = 1.5)}>Set over</button>
<button type="button" data-testid="progress-under" onclick={() => (progress = -0.25)}>Set under</button>
<span data-testid="progress-state">{progress}</span>
