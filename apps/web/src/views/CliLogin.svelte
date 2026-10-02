<script lang="ts">
  import { onMount } from 'svelte';
  import type { CliLoginPort, CliLoginRequest, CliLoginStatus, CliLoginRefusal } from '../../../../core/src/cli-login.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { cliLoginStrings as t } from '../strings/cli-login.js';

  interface Props {
    port: CliLoginPort | null;
    launch: string;
    pageOrigin: string;
  }
  let { port, launch, pageOrigin }: Props = $props();

  let request: CliLoginRequest | null = $state(null);
  let refusal: CliLoginRefusal | null = $state(null);
  let status: CliLoginStatus | null = $state(null);
  let busy = $state(false);
  let alive = true;

  onMount(() => {
    alive = true;
    if (port === null) {
      refusal = 'unavailable';
      return () => { alive = false; };
    }
    void port.inspect(launch, pageOrigin).then(
      (result) => {
        if (!alive) return;
        // The page re-checks the origin it displays, so a wrong address is never offered.
        if (result.ok && result.request.communityOrigin === pageOrigin) request = result.request;
        else refusal = result.ok ? 'origin-mismatch' : result.reason;
      },
      () => { if (alive) refusal = 'unavailable'; },
    );
    return () => { alive = false; };
  });

  async function begin() {
    if (busy || port === null || request === null) return;
    busy = true;
    status = null;
    try {
      const result = await port.begin();
      if (alive) status = result;
    } catch {
      if (alive) status = { state: 'failed', retryable: false };
    } finally {
      if (alive) busy = false;
    }
  }

  async function cancel() {
    if (port === null) return;
    try {
      const result = await port.cancel();
      if (alive) status = result;
    } catch {
      if (alive) status = { state: 'cancelled', retryable: false };
    }
  }
</script>

<svelte:head><title>cmeet · {t.title}</title></svelte:head>

<main class="layout">
  <h1>{t.title}</h1>
  {#if refusal}
    <Notice tone="error">{t.refusal[refusal]}</Notice>
  {:else if request}
    {#if status?.state === 'done'}
      <Notice tone="success">{t.done} {t.closeNote}</Notice>
    {:else}
      <p>{t.community}: <strong>{request.communityOrigin}</strong></p>
      <p>{t.handoff} {request.handoffLabel}.</p>
      <p class="muted">{request.expiresLabel} {t.noServers}</p>
      {#if status}
        <Notice tone="error">{status.message ?? (status.state === 'cancelled' ? t.cancelled : t.failed)}</Notice>
      {/if}
      {#if status === null || status.retryable}
        <div class="row">
          <Button variant="primary" {busy} busyLabel={t.beginBusy} onclick={() => void begin()}>
            {status ? t.retry : t.begin}
          </Button>
          <Button onclick={() => void cancel()}>{t.cancel}</Button>
        </div>
      {/if}
    {/if}
  {:else}
    <p aria-live="polite">{t.checking}</p>
  {/if}
</main>
