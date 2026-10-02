<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Session, routeForLocation, routeHref, type Route } from './session.svelte.js';
  import { community } from './community.js';
  import { en } from '../../../ui/src/i18n/en.js';
  import Connecting from './views/Connecting.svelte';
  import Arrival from './views/Arrival.svelte';
  import Lobby from './views/Lobby.svelte';
  import ProfileEditor from './views/ProfileEditor.svelte';
  import Forum from './views/Forum.svelte';
  import Waves from './views/Waves.svelte';
  import Contacts from './views/Contacts.svelte';
  import Chat from './views/Chat.svelte';
  import Groups from './views/Groups.svelte';
  import GroupDetail from './views/GroupDetail.svelte';
  import Devices from './views/Devices.svelte';
  import AdminSchema from './views/AdminSchema.svelte';
  import Root from './views/Root.svelte';
  import Settings from './views/Settings.svelte';

  interface Props {
    session: Session;
  }
  let { session }: Props = $props();

  const currentRoute = () => routeForLocation(window.location.hash, window.location.hostname, import.meta.env.DEV);
  let route: Route = $state(currentRoute());

  function onHashChange() {
    route = currentRoute();
    void tick().then(() => document.getElementById('content')?.focus());
  }

  onMount(() => {
    window.addEventListener('hashchange', onHashChange);
    void session.start();
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      session.stop();
    };
  });

  const ready = $derived(session.ready);
  const failed = $derived(session.failed);
  const joined = $derived(session.snapshot.joined);
  const needsArrival = $derived(
    !['arrival', 'settings', 'root', 'admin-schema'].includes(route.name) && !joined,
  );

  const admitted = $derived(session.snapshot.lobby?.admitted === true);
  const needsLobby = $derived(joined && !admitted && ['forum', 'waves', 'contacts', 'chat', 'groups', 'group'].includes(route.name));

  function navCurrent(name: string) {
    return route.name === name ? 'page' : undefined;
  }

  function go(name: Route) {
    window.location.hash = routeHref(name);
  }
</script>

<svelte:head>
  <title>{community.displayName} · {en.app.name}</title>
</svelte:head>

<a class="skip-link" href="#content" onclick={(event) => { event.preventDefault(); document.getElementById('content')?.focus(); }}>{en.app.skipToContent}</a>

{#if !ready && !failed}
  <main id="content" tabindex="-1" class="layout">
    <Connecting status={session.snapshot.connection} onretry={() => session.retry()} />
  </main>
{:else if failed}
  <main id="content" tabindex="-1" class="layout">
    <Connecting status={session.snapshot.connection} onretry={() => session.retry()} />
  </main>
{:else if needsArrival}
  <main id="content" tabindex="-1" class="layout">
    <Arrival session={session.client} onjoined={() => { session.markJoined(); go({ name: 'lobby' }); }} />
  </main>
{:else}
  <nav class="topnav" aria-label="Primary">
    <span class="brand">{community.displayName}</span>
    {#if joined && admitted}
    <a href="#/forum" aria-current={navCurrent('forum')}>Discover</a>
    <a href="#/waves" aria-current={navCurrent('waves')}>
      First contact{#if session.snapshot.unreadWaves > 0} ({session.snapshot.unreadWaves}){/if}
    </a>
    <a href="#/groups" aria-current={route.name === 'groups' || route.name === 'group' ? 'page' : undefined}>Groups</a>
    <a href="#/contacts" aria-current={navCurrent('contacts')}>Contacts</a>
    {/if}
    {#if joined}
    <a href="#/profile" aria-current={navCurrent('profile')}>Profile</a>
    <a href="#/lobby" aria-current={navCurrent('lobby')}>Lobby</a>
    <a href="#/devices" aria-current={navCurrent('devices')}>Devices</a>
    {/if}
    <a href="#/settings" aria-current={navCurrent('settings')}>Settings</a>
  </nav>
  <main id="content" tabindex="-1" class="layout">
    {#key routeHref(route)}
    {#if needsLobby}
      <Lobby client={session.client} />
    {:else if route.name === 'arrival'}
      <Arrival session={session.client} onjoined={() => { session.markJoined(); go({ name: 'lobby' }); }} />
    {:else if route.name === 'lobby'}
      <Lobby client={session.client} />
    {:else if route.name === 'profile'}
      <ProfileEditor client={session.client} />
    {:else if route.name === 'forum'}
      <Forum client={session.client} />
    {:else if route.name === 'waves'}
      <Waves client={session.client} />
    {:else if route.name === 'contacts'}
      <Contacts client={session.client} />
    {:else if route.name === 'chat'}
      <Chat client={session.client} peer={route.peer} />
    {:else if route.name === 'groups'}
      <Groups client={session.client} />
    {:else if route.name === 'group'}
      <GroupDetail client={session.client} id={route.id} />
    {:else if route.name === 'devices'}
      <Devices client={session.client} />
    {:else if route.name === 'admin-schema'}
      <AdminSchema client={session.client} />
    {:else if route.name === 'root'}
      <Root client={session.client} />
    {:else}
      <Settings client={session.client} />
    {/if}
    {/key}
  </main>
{/if}
