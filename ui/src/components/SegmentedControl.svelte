<script lang="ts" generics="T extends string">
  interface Props {
    label: string;
    options: { value: T; label: string }[];
    current: T;
    onselect?: (value: T) => void;
  }
  let { label, options, current, onselect }: Props = $props();
</script>

<div class="segmented" role="tablist" aria-label={label}>
  {#each options as option}
    <button
      role="tab"
      aria-selected={current === option.value}
      class:active={current === option.value}
      onclick={() => onselect?.(option.value)}
    >{option.label}</button>
  {/each}
</div>

<style>
  .segmented { display: inline-flex; border: 1px solid var(--cmeet-line); border-radius: 999px; overflow: hidden; }
  .segmented button { font: inherit; border: 0; background: transparent; color: var(--cmeet-ink); padding: 0.5rem 1rem; cursor: pointer; }
  .segmented button.active { background: var(--cmeet-accent); color: var(--cmeet-accent-ink); }
  .segmented button:focus-visible { outline: 3px solid var(--cmeet-focus); outline-offset: -3px; }
</style>
