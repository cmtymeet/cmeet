<script lang="ts">
  import TextField from '../../../../../ui/src/components/TextField.svelte';
  let choices = $state(['First', 'Second', 'Multiple  spaces']);
  let value = $state('Second');
</script>

<TextField id="updated-choice" label="Answer" {choices} {value} oninput={(next) => value = next} />
<button onclick={() => choices = [...choices, 'Third']}>Refresh choices</button>
<button onclick={() => value = 'Third'}>Choose third</button>
<output>{value}</output>
