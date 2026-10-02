<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CmsgClient, GateStep, LobbyState } from '../../../../core/src/cmsg.js';
  import { memberName } from '../../../../ui/src/member-name.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { lobbyStrings as strings } from '../strings/lobby.js';
  import { handleStrings } from '../strings/handles.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let lobby: LobbyState | null = $state(null);
  let loadError = $state('');
  let actionError = $state('');
  let busyId = $state('');
  let inputs: Record<string, string> = $state({});
  let alive = true;

  function statusLabel(gate: GateStep): string {
    if (gate.state === 'complete') return strings.complete;
    if (gate.state === 'waiting') return strings.waiting;
    return strings.actionNeeded;
  }

  async function load() {
    loadError = '';
    try {
      const state = await client.lobby();
      if (!alive) return;
      lobby = state;
    } catch (e) {
      if (!alive) return;
      loadError = e instanceof Error ? e.message : strings.loadFailedFallback;
      await tick();
      document.getElementById('lobby-load-error')?.focus();
    }
  }

  async function complete(id: string) {
    if (busyId) return;
    busyId = id;
    actionError = '';
    try {
      const next = await client.completeGate(id, inputs[id] ?? '');
      if (!alive) return;
      lobby = next;
      inputs = { ...inputs, [id]: '' };
    } catch (e) {
      if (!alive) return;
      actionError = e instanceof Error ? e.message : strings.refusedFallback;
      await tick();
      document.getElementById('lobby-action-error')?.focus();
    } finally {
      if (alive) busyId = '';
    }
  }

  onMount(() => {
    alive = true;
    void load();
    const stop = client.subscribe((event) => {
      if (event.type === 'lobby' && alive) lobby = event.lobby;
    });
    return () => {
      alive = false;
      stop();
    };
  });
</script>

<section class="page lobby" aria-labelledby="lobby-title">
  <h1 id="lobby-title">{strings.title}</h1>
  <p>{strings.lead}</p>
  {#if loadError}
    <div id="lobby-load-error" tabindex="-1">
      <Notice tone="error">{loadError}</Notice>
    </div>
    <div class="row">
      <Button variant="primary" onclick={() => void load()}>{strings.retry}</Button>
    </div>
  {/if}
  {#if lobby}
    <p>{strings.handleLabel}: <strong>{memberName(lobby.handle, lobby.displayName)}</strong></p>
    {#if lobby.handleChange}
      <Notice tone="warning" title={handleStrings.noticeTitle}>
        {handleStrings.reasonPrefix}: {lobby.handleChange.reason}. {handleStrings.deadlinePrefix}: {lobby.handleChange.deadlineLabel}.
        <a href="#/settings">{handleStrings.noticeAction}</a>
      </Notice>
    {/if}
    <h2>{strings.activeRequirements}</h2>
    <p class="muted">{strings.resumeNote}</p>
    {#if lobby.gates.length === 0}
      <p class="muted">{strings.noGates}</p>
    {:else}
      <ul class="gate-list">
        {#each lobby.gates as gate (gate.id)}
          <li>
            <div class="gate-main">
              <span>{gate.label}<br /><small class="muted">{gate.detail}</small></span>
              {#if gate.state === 'action-needed' && gate.action}
                <form
                  class="gate-form"
                  onsubmit={(e) => {
                    e.preventDefault();
                    void complete(gate.id);
                  }}
                >
                  {#if gate.action.inputLabel}
                  <label for="gate-input-{gate.id}">{gate.action?.inputLabel ?? strings.codeLabel}</label>
                  <input
                    id="gate-input-{gate.id}"
                    value={inputs[gate.id] ?? ''}
                    disabled={!!busyId}
                    autocomplete="off"
                    oninput={(e) => {
                      inputs = { ...inputs, [gate.id]: (e.currentTarget as HTMLInputElement).value };
                    }}
                  />
                  {/if}
                  <Button
                    disabled={!!busyId}
                    type="submit"
                    variant="primary"
                    busy={busyId === gate.id}
                    busyLabel={strings.working}
                  >
                    {gate.action?.label ?? strings.completeStep}
                  </Button>
                </form>
              {/if}
            </div>
            <span class="gate-status" data-state={gate.state}>{statusLabel(gate)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if actionError}
      <div id="lobby-action-error" tabindex="-1">
        <Notice tone="error">{actionError}</Notice>
      </div>
    {/if}
    {#if !lobby.profileComplete}
      <h2>{strings.profileHeading}</h2>
      <p class="muted">{strings.profileIncompleteNote}</p>
      <div class="row">
        <a href="#/profile">{strings.completeProfile}</a>
      </div>
    {/if}
    <h2>{strings.devices}</h2>
    <ul class="gate-list">
      {#each lobby.devices as device (device.id)}
        <li>
          <span>{device.name}{#if device.thisDevice} {strings.thisDevice}{/if}</span>
        </li>
      {/each}
    </ul>
    <div class="row">
      <a href="#/devices">{strings.manageDevices}</a>
    </div>
    <p class="muted">{strings.syncedPasskey}</p>
    {#if lobby.expiryWarning}
      <Notice tone="warning">{lobby.expiryWarning}</Notice>
    {/if}
    <div class="row">
      <!-- Never derive admission from the step list: only lobby.admitted opens the forum. -->
      <Button variant="primary" disabled={!lobby.admitted} onclick={() => (window.location.hash = '#/forum')}>
        {strings.enter}
      </Button>
    </div>
    {#if !lobby.admitted}
      <p class="muted">{strings.notAdmittedNote}</p>
    {/if}
  {:else if !loadError}
    <p aria-live="polite">{strings.loading}</p>
  {/if}
</section>

<style>
  .lobby .gate-list li {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .lobby .gate-main {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .lobby .gate-status {
    font-weight: 700;
    white-space: nowrap;
  }
  .lobby .gate-status[data-state='complete'] {
    color: var(--cmeet-accent);
  }
  .lobby .gate-form {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.5rem;
    max-width: 24rem;
  }
  .lobby .gate-form label {
    font-weight: 600;
  }
  .lobby .gate-form input {
    font: inherit;
    color: var(--cmeet-ink);
    background: var(--cmeet-surface);
    border: 1px solid var(--cmeet-line);
    border-radius: var(--cmeet-radius);
    padding: 0.55rem 0.7rem;
    width: 100%;
  }
  .lobby .gate-form input:focus-visible {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
  .lobby #lobby-load-error:focus,
  .lobby #lobby-action-error:focus {
    outline: none;
  }
</style>
