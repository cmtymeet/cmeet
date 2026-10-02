<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, RootBoardAccess } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  let {client, onjoined}: {client: CmsgClient; onjoined: () => void} = $props();
  let access: RootBoardAccess | null = $state(null);
  let busy = $state(false);
  let error = $state('');
  let alive = true;
  async function load() {
    error = '';
    try {const next = await client.rootBoardAccess(); if (alive) access = next;}
    catch (e) {if (alive) error = e instanceof Error ? e.message : 'Board access is unavailable.';}
  }
  onMount(() => {void load(); return () => {alive = false;};});
  async function enter() {
    if (busy) return;
    busy = true; error = '';
    try {await client.enterRootBoard(); if (alive) onjoined();}
    catch (e) {if (alive) error = e instanceof Error ? e.message : 'Board entry was not accepted.';}
    finally {if (alive) busy = false;}
  }
</script>
<section class="page">
  <h1>Admin board</h1>
  <p>A community for admins to meet and exchange ideas. Membership here does not make you a platform root.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if access}
    <p>{access.message}</p><p>{access.renewalLabel}</p><p>Status: {access.state}</p>
    <Button {busy} disabled={!access.canEnter || busy} onclick={() => void enter()}>Enter the board</Button>
  {:else if !error}<p role="status">Checking board access…</p>{/if}
  <Button disabled={busy} onclick={() => void load()}>Check access again</Button>
</section>
