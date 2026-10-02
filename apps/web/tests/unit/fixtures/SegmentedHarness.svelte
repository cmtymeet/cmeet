<script lang="ts">
  // Stateful rerender harness for SegmentedControl: owns `current` so
  // keyboard/pointer selection visibly swaps selection and roving tabindex.
  import SegmentedControl from '../../../../../ui/src/components/SegmentedControl.svelte';

  const options = [
    { value: 'front' as const, label: 'Front' },
    { value: 'back' as const, label: 'Back' },
  ];
  type Value = (typeof options)[number]['value'];
  let current: Value = $state('front');
</script>

<SegmentedControl label="Preview side" options={[...options]} {current} onselect={(value: Value) => (current = value)} />
<output data-testid="current">{current}</output>
