<script lang="ts">
  import TextField from '../../../../ui/src/components/TextField.svelte';

  interface Props {
    id: string;
    label: string;
    choices?: string[];
    multiline?: boolean;
  }
  let { id, label, choices, multiline = false }: Props = $props();
  let error = $state('Login is required.');
</script>

<TextField {id} {label} value="" help="Use 3+ characters." {error} {choices} {multiline} required />
<button type="button" data-testid="clear-error" onclick={() => (error = '')}>Clear error</button>
