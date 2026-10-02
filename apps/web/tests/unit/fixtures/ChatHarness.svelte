<script lang="ts">
  import { untrack } from 'svelte';
  import Chat from '../../../src/views/Chat.svelte';
  import type { CmsgClient } from '../../../../../core/src/cmsg.js';

  interface Props {
    client: CmsgClient;
    initialPeer: string;
  }
  let { client, initialPeer }: Props = $props();

  let peer = $state(untrack(() => initialPeer));

  export function showPeer(next: string) {
    peer = next;
  }
</script>

<Chat {client} {peer} />
