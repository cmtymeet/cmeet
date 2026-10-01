<script lang="ts">
  import type { CmsgClient } from '../../../../core/src/cmsg.js';
  import { Button, Notice } from '../../../../ui/src/index.js';
  import { community } from '../community.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let note = $state('');

  async function signOut() {
    try {
      await client.disconnect();
      window.location.hash = '#/arrival';
      window.location.reload();
    } catch {
      note = 'Signing out did not work. Try again.';
    }
  }
</script>

<section class="page" aria-labelledby="settings-title">
  <h1 id="settings-title">Settings</h1>
  <p class="muted">Community: {community.displayName}. Theme: {community.theme}. English first; more languages follow the same string keys.</p>
  {#if note}<Notice tone="error">{note}</Notice>{/if}
  <div class="row">
    <Button onclick={() => (window.location.hash = '#/lobby')}>Back to lobby</Button>
    <Button variant="danger" onclick={() => void signOut()}>Sign out</Button>
  </div>
</section>
