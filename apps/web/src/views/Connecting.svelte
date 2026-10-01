<script lang="ts">
  import type { ConnectionStatus } from '../../../../core/src/cmsg.js';
  import { ProgressBar, Button } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    status: ConnectionStatus;
    onretry?: () => void;
  }
  let { status, onretry }: Props = $props();
</script>

<section class="page" aria-labelledby="connect-title">
  <p class="muted">{en.app.name}</p>
  <h1 id="connect-title">{en.connection.title}</h1>
  <p>{en.connection.lead}</p>
  <p aria-live="polite">{status.message}</p>
  <ProgressBar value={status.progress} label={en.connection.title} />
  {#if status.phase === 'failed'}
    <p role="alert">{en.connection.failed}</p>
    <Button variant="primary" onclick={() => onretry?.()}>{en.connection.retry}</Button>
  {/if}
</section>
