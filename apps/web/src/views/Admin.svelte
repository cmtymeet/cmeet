<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CmsgClient } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import AdminRoles from './AdminRoles.svelte';
  let {client}: {client: CmsgClient} = $props();
  let signedIn = $state(false);
  let busy = $state(false);
  let error = $state('');
  let alive = true;
  onDestroy(() => {alive = false;});
  async function signIn() {
    if (busy) return;
    busy = true; error = '';
    try { await client.signInRole('admin'); if (alive) signedIn = true; }
    catch (e) { if (alive) error = e instanceof Error ? e.message : 'Sign-in was not accepted.'; }
    finally { if (alive) busy = false; }
  }
</script>
<section class="page">
  <h1>Community admin garden</h1>
  <p>Use your passkey to open this community’s administration.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  <Button {busy} onclick={() => void signIn()}>{signedIn ? 'Sign in again' : 'Sign in as admin'}</Button>
  {#if signedIn}
    <p><a href="#/admin/schema">Edit the profile schema</a></p>
    <AdminRoles {client} />
  {/if}
</section>
