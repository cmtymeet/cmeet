<script lang="ts">
  // Snippet-children rerender harness: Button and Notice render live snippet
  // content. Bumping state must update the same DOM nodes in place.
  import Button from '../../../../ui/src/components/Button.svelte';
  import Notice from '../../../../ui/src/components/Notice.svelte';

  let count = $state(1);
</script>

<Button variant="primary"><span data-testid="btn-label">Count {count}</span></Button>
<Notice tone="info" title="Harness"><span data-testid="notice-body">Body {count}</span></Notice>
<button type="button" data-testid="bump" onclick={() => (count += 1)}>Bump</button>
