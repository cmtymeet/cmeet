<script lang="ts">
  import type { CmsgClient } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { community } from '../community.js';
  import HandleSettings from './HandleSettings.svelte';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let note = $state('');
  let busy = $state(false);

  async function signOut() {
    if (busy) return;
    busy = true;
    try {
      await client.disconnect();
      window.location.hash = '#/arrival';
      window.location.reload();
    } catch {
      note = 'Signing out did not work. Try again.';
      busy = false;
    }
  }
</script>

<section class="page" aria-labelledby="settings-title">
  <h1 id="settings-title">Settings</h1>
  <p class="muted">Community: {community.displayName}. Your profile and conversations belong to you.</p>
  {#if note}<Notice tone="error">{note}</Notice>{/if}
  <div class="row">
    <Button onclick={() => (window.location.hash = '#/lobby')}>Back to lobby</Button>
    <Button variant="danger" {busy} onclick={() => void signOut()}>Sign out</Button>
  </div>
  <HandleSettings {client} />
  {#if import.meta.env.DEV}
    <details><summary>Development portals</summary><p><a href="#/admin">Admin</a> · <a href="#/admin/schema">Schema</a> · <a href="#/root">Root</a></p></details>
  {/if}
</section>
