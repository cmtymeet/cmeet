<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, DeviceInfo, RestoreView } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, Dialog } from '../../../../ui/src/index.js';
  import { devicesStrings as s } from '../strings/devices.js';
  let { client }: { client: CmsgClient } = $props();
  let devices: DeviceInfo[] = $state([]);
  let loaded = $state(false), busy = $state(false);
  let name = $state(''), error = $state(''), note = $state('');
  let editing = $state(''), rename = $state('');
  let confirmation: { device: DeviceInfo; action: 'approve' | 'remove' } | null = $state(null);
  let restore: RestoreView | null = $state(null);
  let alive = true;
  let errorRegion: HTMLDivElement | undefined = $state();
  $effect(() => { if (error) errorRegion?.focus(); });

  async function load() {
    error = '';
    try { const next = await client.devices(); if (alive) { devices = next; loaded = true; } }
    catch (e) { if (alive) error = e instanceof Error ? e.message : s.failed; }
  }
  onMount(() => {
    void load();
    const stop = client.subscribe(e => { if (e.type === 'devices' && alive) devices = e.devices; });
    return () => { alive = false; stop(); };
  });
  async function act(action: () => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; note = '';
    try { await action(); }
    catch (e) { if (alive) error = e instanceof Error ? e.message : s.failed; }
    finally { if (alive) busy = false; }
  }
  async function add() {
    await client.addDevice(name);
    if (alive) { name = ''; note = s.added; }
  }
  async function confirm() {
    if (!confirmation) return;
    const { device, action } = confirmation;
    if (action === 'approve') await client.approveDevice(device.id);
    else await client.removeDevice(device.id);
    if (alive) confirmation = null;
  }
</script>
<section class="page" aria-labelledby="devices-title">
  <h1 id="devices-title">{s.title}</h1>
  <p>{s.lead}</p><p class="muted">{s.loss}</p>
  {#if error}<div bind:this={errorRegion} tabindex="-1"><Notice tone="error">{error}</Notice></div>{/if}
  {#if note}<Notice tone="success">{note}</Notice>{/if}
  {#if !loaded && !error}<p role="status">{s.loading}</p>{/if}
  {#if !loaded && error}<Button onclick={() => void load()}>{s.retry}</Button>{/if}
  {#if loaded && devices.length === 0}<p>{s.empty}</p>{/if}
  <ul class="gate-list">
    {#each devices as device (device.id)}
      <li>
        <div><strong>{device.name}</strong> {#if device.thisDevice}{s.current}{/if}
          <p>{device.state === 'pending' ? s.pending : s.active}</p>
        </div>
        {#if editing === device.id}
          <form onsubmit={(e) => { e.preventDefault(); void act(async () => { await client.renameDevice(device.id, rename); if (alive) editing = ''; }); }}>
            <TextField id={`rename-${device.id}`} label={s.name} value={rename} oninput={v => rename = v} />
            <Button type="submit" disabled={busy}>{s.save}</Button>
            <Button disabled={busy} onclick={() => editing = ''}>{s.cancel}</Button>
          </form>
        {:else}
          <div class="row">
            <Button disabled={busy} onclick={() => { editing = device.id; rename = device.name; }}>{s.rename}</Button>
            {#if device.state === 'pending'}<Button disabled={busy} onclick={() => confirmation = { device, action: 'approve' }}>{s.approve}</Button>{/if}
            {#if !device.thisDevice}<Button disabled={busy} onclick={() => confirmation = { device, action: 'remove' }}>{s.remove}</Button>{/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  <form onsubmit={e => { e.preventDefault(); void act(add); }}>
    <TextField id="device-name" label={s.name} value={name} oninput={v => name = v} />
    <Button type="submit" variant="primary" {busy}>{s.add}</Button>
  </form>
  <p><Button disabled={busy} onclick={() => void act(async () => { const result = await client.restoreVault(); if (alive) restore = result; })}>{s.restore}</Button></p>
  {#if restore}
    <section aria-labelledby="recovery-title"><h2 id="recovery-title">{s.restoreTitle}</h2>
      <Notice tone={restore.state === 'ready' ? 'success' : 'warning'}><strong>{s.restoreStates[restore.state]}</strong><p>{restore.message}</p></Notice>
    </section>
  {/if}
  {#if confirmation}
    <Dialog open labelledBy="device-confirm-title" onclose={() => { if (!busy) confirmation = null; }}>
      <h2 id="device-confirm-title">{confirmation.action === 'approve' ? s.pairingTitle : s.removeTitle}</h2>
      <p><strong>{confirmation.device.name}</strong></p>
      <p>{confirmation.action === 'approve' ? s.pairingHelp : s.removeHelp}</p>
      {#if error}<Notice tone="error">{error}</Notice>{/if}
      <div class="row">
        <Button disabled={busy} onclick={() => confirmation = null}>{s.cancel}</Button>
        <Button {busy} variant={confirmation.action === 'approve' ? 'primary' : 'danger'} onclick={() => void act(confirm)}>{confirmation.action === 'approve' ? s.confirmApprove : s.confirmRemove}</Button>
      </div>
    </Dialog>
  {/if}
</section>
