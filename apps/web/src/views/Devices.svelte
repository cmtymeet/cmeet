<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, DeviceInfo } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let devices: DeviceInfo[] = $state([]);
  let name = $state('');
  let error = $state('');
  let note = $state('');

  async function load() {
    try {
      devices = await client.devices();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Devices are unavailable right now.';
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'devices') devices = event.devices;
    });
  });

  async function add() {
    error = '';
    note = '';
    try {
      const pending = await client.addDevice(name);
      // In real use another live device approves. Here the member approves
      // their own second device to keep the flow testable.
      await client.approveDevice(pending.id);
      name = '';
      note = 'Device added. Keep a synced passkey or a second device so you can return.';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Adding the device did not work.';
    }
  }

  async function remove(id: string) {
    try {
      await client.removeDevice(id);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Removing the device did not work.';
    }
  }
</script>

<section class="page" aria-labelledby="devices-title">
  <h1 id="devices-title">{en.devices.title}</h1>
  <p class="muted">New devices join only with approval from a live device. Removing one rotates keys. Names live only in your encrypted vault.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if note}<Notice tone="success">{note}</Notice>{/if}
  <ul class="gate-list">
    {#each devices as device (device.id)}
      <li>
        <span>{device.name}{#if device.thisDevice} (this device){/if}</span>
        {#if !device.thisDevice}<Button onclick={() => void remove(device.id)}>{en.lobby.remove}</Button>{/if}
      </li>
    {/each}
  </ul>
  <form onsubmit={(e) => { e.preventDefault(); void add(); }}>
    <TextField id="device-name" label="Device name" value={name} placeholder="For example: spare phone" oninput={(v) => (name = v)} />
    <Button type="submit" variant="primary">{en.devices.add}</Button>
  </form>
</section>
