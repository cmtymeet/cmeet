<script lang="ts">
  interface Props {
    value: number;
    label: string;
  }
  let { value, label }: Props = $props();
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
</script>

<div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
  <div class="bar" style="width: {pct}%"></div>
</div>

<style>
  .progress { background: var(--cmeet-line); border-radius: 999px; height: 0.6rem; overflow: hidden; }
  .bar { background: var(--cmeet-accent); height: 100%; transition: width 0.3s ease; }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
</style>
