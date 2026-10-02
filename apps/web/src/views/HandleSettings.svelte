<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, HandlePolicy } from '../../../../core/src/cmsg.js';
  import { Button, Notice, TextField } from '../../../../ui/src/index.js';
  import { handleStrings as t } from '../strings/handles.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let policy: HandlePolicy | null = $state(null);
  let next = $state('');
  let busy = $state(false);
  let loadError = $state('');
  let error = $state('');
  let done = $state(false);
  let alive = true;

  async function load() {
    loadError = '';
    try {
      const value = await client.handlePolicy();
      if (alive) policy = value;
    } catch {
      if (alive) loadError = t.loadFailed;
    }
  }

  async function change() {
    if (busy) return;
    busy = true;
    error = '';
    done = false;
    try {
      const value = await client.changeHandle(next);
      if (!alive) return;
      policy = value;
      next = '';
      done = true;
    } catch (e) {
      if (alive) error = e instanceof Error ? e.message : t.loadFailed;
    } finally {
      if (alive) busy = false;
    }
  }

  onMount(() => {
    alive = true;
    void load();
    return () => { alive = false; };
  });
</script>

<section aria-labelledby="handle-title">
  <h2 id="handle-title">{t.heading}</h2>
  {#if loadError}
    <Notice tone="error">{loadError}</Notice>
    <Button onclick={() => void load()}>{t.retry}</Button>
  {:else if policy}
    <p>{policy.summary}</p>
    {#if policy.deadlineLabel}<p class="muted">{t.deadlinePrefix}: {policy.deadlineLabel}</p>{/if}
    {#if policy.reason}<p class="muted">{t.reasonPrefix}: {policy.reason}</p>{/if}
    <p class="muted">{policy.reservedNote}</p>
    {#if error}<Notice tone="error">{error}</Notice>{/if}
    {#if done}<Notice tone="success">{t.changed}</Notice>{/if}
    {#if policy.canChange}
      {#if policy.state === 'required'}<p>{t.chooseNote}</p>{/if}
      <form novalidate onsubmit={(event) => { event.preventDefault(); void change(); }}>
        <TextField id="new-handle" label={t.newLabel} help={t.newHelp} value={next} oninput={(value) => { next = value; }} />
        <Button type="submit" variant="primary" {busy} busyLabel={t.working}>{t.change}</Button>
      </form>
    {:else}
      <p class="muted">{t.lockedNote}</p>
    {/if}
    <p class="muted">{t.displayNameNote}</p>
  {:else}
    <p aria-live="polite">{t.loading}</p>
  {/if}
</section>
