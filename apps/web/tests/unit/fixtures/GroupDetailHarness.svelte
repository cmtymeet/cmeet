<script lang="ts">
  import GroupDetail from '../../../src/views/GroupDetail.svelte';
  import type { Writable } from 'svelte/store';
  import type { CmsgClient } from '../../../../core/src/cmsg.js';

  // Test-only wrapper: a single mounted GroupDetail whose route id follows a
  // store, so prop-switch races run against one live instance.
  interface Props {
    client: CmsgClient;
    route: Writable<string>;
  }
  let { client, route }: Props = $props();
  const id = $derived($route);
</script>

<GroupDetail {client} {id} />
