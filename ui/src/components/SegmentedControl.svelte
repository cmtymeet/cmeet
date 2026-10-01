<script lang="ts" generics="T extends string">
  interface Props {
    label: string;
    options: { value: T; label: string }[];
    current: T;
    onselect?: (value: T) => void;
  }
  let { label, options, current, onselect }: Props = $props();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    if (options.length === 0) return;
    event.preventDefault();
    let index = options.findIndex((option) => option.value === current);
    if (index < 0) index = 0;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    const nextValue = options[next].value;
    if (nextValue !== current) onselect?.(nextValue);
    const list = event.currentTarget as HTMLElement | null;
    list?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
</script>

<div class="segmented" role="tablist" aria-label={label} tabindex="-1" onkeydown={handleKeydown}>
  {#each options as option}
    <button
      type="button"
      role="tab"
      aria-selected={current === option.value}
      tabindex={current === option.value ? 0 : -1}
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
