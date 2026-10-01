<script lang="ts">
  import type { GroupLevel } from '../../../core/src/cmsg.js';
  interface Props {
    level: GroupLevel;
    labels?: Record<GroupLevel, string>;
  }
  let { level, labels = { circle: 'Circle', ingroup: 'Ingroup', room: 'Public room' } }: Props = $props();
</script>

<span class="badge badge-{level}">{labels[level]}</span>

<style>
  .badge {
    display: inline-block; font-size: 0.8rem; font-weight: 700;
    border-radius: 999px; padding: 0.15rem 0.65rem;
    background: var(--cmeet-accent-soft); color: var(--cmeet-ink);
    border: 1px solid var(--cmeet-line);
  }
  .badge-room { background: var(--cmeet-accent); color: var(--cmeet-accent-ink); border-color: transparent; }
</style>
