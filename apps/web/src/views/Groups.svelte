<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, GroupView } from '../../../../core/src/cmsg.js';
  import { Notice, EmptyState, GroupCard } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let groups: GroupView[] = $state([]);
  let error = $state('');

  async function load() {
    try {
      groups = await client.groups();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Groups are unavailable right now.';
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'groups') groups = event.groups;
    });
  });

  async function join(id: string) {
    const group = groups.find((g) => g.id === id);
    if (group?.joinConsent && !window.confirm(`${group.joinConsent}\n\nJoin ${group.name}?`)) return;
    try {
      await client.joinGroup(id);
      await load();
      window.location.hash = `#/groups/${encodeURIComponent(id)}`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Joining did not work.';
    }
  }

  async function leave(id: string) {
    try {
      await client.leaveGroup(id);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Leaving did not work.';
    }
  }
</script>

<section class="page" aria-labelledby="groups-title">
  <h1 id="groups-title">{en.groups.title}</h1>
  <p class="muted">One group idea at three sizes. Growing more visible always needs everyone's consent; shrinking stays private on its own. Joining never costs a wave.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if groups.length === 0 && !error}
    <p aria-live="polite">{en.common.loading}</p>
  {:else if groups.length === 0}
    <EmptyState title="No groups yet" hint="Seed rooms from your community will appear here." />
  {:else}
    <div class="grid">
      {#each groups as group (group.id)}
        <GroupCard
          {group}
          levelLabels={en.groups.level}
          joinLabel={en.groups.join}
          leaveLabel={en.groups.leave}
          joinedLabel={en.groups.joined}
          nextLabel={en.groups.whatChangesNext}
          onjoin={(id) => void join(id)}
          onleave={(id) => void leave(id)}
          onopen={(id) => (window.location.hash = `#/groups/${encodeURIComponent(id)}`)}
        />
      {/each}
    </div>
  {/if}
</section>
