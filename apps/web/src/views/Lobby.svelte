<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, LobbyState } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let lobby: LobbyState | null = $state(null);
  let error = $state('');

  onMount(() => {
    void client.lobby().then((state) => (lobby = state)).catch((e: Error) => (error = e.message));
    const stop = client.subscribe((event) => {
      if (event.type === 'lobby') lobby = event.lobby;
    });
    return stop;
  });
</script>

<section class="page" aria-labelledby="lobby-title">
  <h1 id="lobby-title">{en.lobby.title}</h1>
  <p>{en.lobby.lead}</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if lobby}
    <p>Handle: <strong>{lobby.handle}</strong></p>
    <h2>Active requirements</h2>
    <ul class="gate-list">
      {#each lobby.gates as gate}
        <li>
          <span>{gate.label}<br /><small class="muted">{gate.detail}</small></span>
          <span>{gate.state === 'complete' ? 'Complete' : 'Action needed'}</span>
        </li>
      {/each}
    </ul>
    <h2>{en.lobby.devices}</h2>
    <ul class="gate-list">
      {#each lobby.devices as device}
        <li><span>{device.name}{#if device.thisDevice} (this device){/if}</span><a href="#/devices">Manage</a></li>
      {/each}
    </ul>
    <p class="muted">Protect access: use a synced passkey or another device.</p>
    {#if lobby.expiryWarning}<Notice tone="warning">{lobby.expiryWarning}</Notice>{/if}
    <div class="row">
      <Button variant="primary" disabled={!lobby.admitted} onclick={() => (window.location.hash = '#/forum')}>
        {en.lobby.enter}
      </Button>
      {#if !lobby.profileComplete}
        <Button onclick={() => (window.location.hash = '#/profile')}>Complete profile</Button>
      {/if}
    </div>
  {:else if !error}
    <p aria-live="polite">{en.common.loading}</p>
  {/if}
</section>
