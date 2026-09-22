<script>
  import { onMount } from 'svelte';
  import { createAppController } from './lib/app.js';
  import { createAutomationApi } from './lib/automation.js';

  export let controllerFactory = createAppController;

  const initialState = {
    auth: 'loading',
    authenticated: false,
    member: null,
    config: { communityName: 'cmeet' },
    profile: null,
    entries: [],
    conversations: [],
    activeConversation: null,
    accounting: { status: 'unknown', accepted: null, eligibleAt: null },
    connectivity: { online: false, status: 'offline' },
    error: null
  };

  let controller;
  let unsubscribe = () => {};
  let state = initialState;
  let page = 'discover';
  let authMode = 'join';
  let voucher = '';
  let draftName = '';
  let draftBio = '';
  let profileDirty = false;
  let composer = '';
  let busyAction = '';
  let mobileNavOpen = false;
  let automation;
  let automationPolicy = null;
  let automationKeys = [];
  let automationError = '';
  let automationBusy = false;
  let automationName = '';
  let automationScopes = [];
  let automationExpiry = '';
  let newAutomationSecret = '';
  let mcpEndpoint = '';
  let mcpCapabilities = [];

  $: signedIn = state.auth === 'authenticated' || state.authenticated === true;
  $: isOnline = typeof state.connectivity === 'object' ? state.connectivity?.online === true : state.connectivity === 'online';
  $: connectionLabel = isOnline ? 'Connected' : 'Waiting for connection';
  $: activeConversation = state.activeConversation;
  $: activeConversationId = activeConversation?.id ?? activeConversation?.memberId ?? '';
  $: visibleEntries = Array.isArray(state.entries) ? state.entries : [];
  $: conversations = Array.isArray(state.conversations) ? state.conversations : [];
  $: activeMessages = Array.isArray(state.messages) ? state.messages : (activeConversation?.messages ?? []);
  $: activePersonOnline = activeConversation?.online === true;
  $: activeContactPending = isPendingContact(activeConversation);
  $: activeWaitingPeer = isWaitingForAcceptance(activeConversation);
  $: activeAwaitingAnswer = isAwaitingAnswer(activeConversation);
  $: activeHasOutgoing = activeMessages.some(message => message?.outgoing === true);
  $: activeCanSendIntroduction = activeAwaitingAnswer && activeConversation?.canSendIntroduction === true;
  $: accountingPending = ['starting', 'pending', 'degraded'].includes(state.accounting?.status);
  $: messagesAvailable = !['starting', 'pending', 'degraded'].includes(state.accounting?.status);

  function conversationId(value) {
    return value?.memberId ?? value?.id ?? '';
  }

  function isPendingContact(value) {
    return value?.pendingContact === true || value?.contactState === 'awaitingAcceptance' || value?.contactState === 'pendingContact' || value?.phase === 'awaitingAcceptance' || value?.phase === 'pendingContact';
  }

  function isWaitingForAcceptance(value) {
    return value?.contactState === 'awaitingPeer' || value?.contactState === 'waitingPeer' || value?.phase === 'awaitingPeer' || value?.phase === 'waitingPeer' || value?.status === 'waitingPeer';
  }

  function isAwaitingAnswer(value) {
    return value?.contactState === 'awaitingAnswer' || value?.phase === 'consented';
  }

  function accountingMessage(value) {
    if (Number.isSafeInteger(value?.eligibleAt) && value.eligibleAt > 0) {
      try {
        return `Messaging will be available after ${new Date(value.eligibleAt * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`;
      } catch {
        return 'Messaging will be available once membership is ready.';
      }
    }
    return 'Messaging will be available once membership is ready. Profiles and discovery remain available.';
  }

  function messageTime(timestamp) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 1) return '';
    try {
      return new Date(timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function safeError(error) {
    if (!error) return '';
    if (error?.safeMessage === true && typeof error.message === 'string') return error.message.slice(0, 240);
    if (error?.name === 'ApiError') {
      if (error.status === 401) return 'Sign in is required.';
      if (error.status === 403) return 'This request was not accepted.';
      if (error.category === 'network') return 'The community service is unavailable.';
      return 'The community service could not complete that request.';
    }
    return 'Something went wrong. Try again.';
  }

  function normalize(next) {
    if (!next || typeof next !== 'object') return initialState;
    return { ...initialState, ...next, error: next.error ? safeError(next.error) : null };
  }

  onMount(() => {
    try {
      automation = createAutomationApi();
      if (typeof controllerFactory !== 'function') throw new TypeError('Application controller factory is unavailable');
      controller = controllerFactory();
      unsubscribe = controller.subscribe((next) => {
        state = normalize(next);
        if (state.profile && !profileDirty) {
          draftName = state.profile.displayName ?? '';
          draftBio = state.profile.bio ?? '';
        }
      });
      const result = controller.init?.();
      if (result?.catch) result.catch((error) => (state = { ...state, error: safeError(error) }));
    } catch (error) {
      state = { ...state, auth: 'signed-out', error: safeError(error) };
    }
    return () => unsubscribe?.();
  });

  async function run(action, operation) {
    if (!controller || busyAction) return;
    busyAction = action;
    state = { ...state, error: null };
    try {
      await operation();
    } catch (error) {
      state = { ...state, error: safeError(error) };
    } finally {
      busyAction = '';
    }
  }

  function submitVoucher() {
    const value = voucher.trim();
    if (!value) {
      state = { ...state, error: 'Enter the voucher you received to join.' };
      return;
    }
    // Admission validation belongs to cvld on the server. The client only checks presence.
    run('join', () => controller.register(value));
  }

  function signIn() {
    // login() must stay directly behind this user gesture so the WebAuthn prompt can open.
    run('signin', () => controller.login());
  }

  function signOut() {
    run('signout', async () => {
      await controller.logout();
      clearAutomationSecret();
      automationKeys = [];
      page = 'discover';
      mobileNavOpen = false;
    });
  }

  function goTo(nextPage) {
    page = nextPage;
    mobileNavOpen = false;
    if (nextPage !== 'settings') clearAutomationSecret();
    if (nextPage === 'settings') void loadAutomation();
  }

  async function loadAutomation() {
    if (!automation || automationBusy) return;
    automationBusy = true;
    automationError = '';
    try {
      automationPolicy = await automation.policy();
      automationKeys = await automation.list();
      mcpEndpoint = automationPolicy.mcpEndpoint ?? '';
      mcpCapabilities = automationPolicy.mcpCapabilities;
    } catch (error) {
      automationPolicy = null;
      automationKeys = [];
      automationError = safeError(error);
    } finally {
      automationBusy = false;
    }
  }

  function toggleAutomationScope(scope) {
    automationScopes = automationScopes.includes(scope)
      ? automationScopes.filter(value => value !== scope)
      : [...automationScopes, scope];
  }

  async function createAutomationKey() {
    if (!automationPolicy || !automationName.trim() || !automationScopes.length || !automationExpiry) return;
    automationBusy = true;
    automationError = '';
    newAutomationSecret = '';
    try {
      const created = await automation.create({ name: automationName.trim(), scopes: automationScopes, expiresAt: Math.floor(Date.now() / 1000) + Number(automationExpiry) });
      newAutomationSecret = created?.token ?? '';
      automationName = '';
      automationScopes = [];
      automationExpiry = '';
      automationKeys = await automation.list();
    } catch (error) {
      automationError = safeError(error);
    } finally {
      automationBusy = false;
    }
  }

  async function revokeAutomationKey(id) {
    automationBusy = true;
    automationError = '';
    try {
      await automation.revoke(id);
      automationKeys = await automation.list();
    } catch (error) {
      automationError = safeError(error);
    } finally {
      automationBusy = false;
    }
  }

  function clearAutomationSecret() {
    newAutomationSecret = '';
  }

  async function copyText(value) {
    if (!value || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return;
    try { await navigator.clipboard.writeText(value); } catch { automationError = 'Copy was not available.'; }
  }

  function refreshDiscovery() {
    run('discover', () => controller.discover());
  }

  function openConversation(entry) {
    const memberId = conversationId(entry);
    if (!memberId) return;
    run('open', async () => {
      await controller.openConversation(memberId);
      page = 'messages';
    });
  }

  function respondToContact(entry, answer) {
    const method = answer ? controller?.answerContact : controller?.declineContact;
    if (typeof method !== 'function') return;
    const memberId = conversationId(entry);
    if (!memberId) return;
    run(answer ? 'answer' : 'decline', async () => {
      await controller.openConversation(memberId);
      await method();
    });
  }

  function sendCurrentMessage() {
    const text = composer.trim();
    if (!text || !activeConversationId) return;
    run('send', async () => {
      await controller.sendMessage(text);
      composer = '';
    });
  }

  function closeConversation() {
    run('close', async () => {
      await controller.closeConversation();
      page = 'messages';
    });
  }

  function saveProfile() {
    const displayName = draftName.trim();
    const bio = draftBio.trim();
    if (!displayName) {
      state = { ...state, error: 'Add a display name before saving.' };
      return;
    }
    run('profile', async () => {
      await controller.saveProfile({ displayName, bio });
      profileDirty = false;
    });
  }

  function profileInput(event) {
    profileDirty = true;
    if (event.currentTarget.name === 'displayName') draftName = event.currentTarget.value;
    if (event.currentTarget.name === 'bio') draftBio = event.currentTarget.value;
  }
</script>

<svelte:head>
  <title>cmeet · private community</title>
  <meta name="description" content="A private community space for people you choose to meet." />
  <meta name="theme-color" content="#10251d" />
</svelte:head>

{#if !signedIn}
  <main class="auth-layout">
    <section class="auth-intro" aria-labelledby="welcome-title">
      <a class="brand brand-large" href="/" aria-label="cmeet home">
        <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
        <span>cmeet</span>
      </a>
      <div class="intro-copy">
        <p class="eyebrow">A private room to meet</p>
        <h1 id="welcome-title">Good conversations start with the right people.</h1>
        <p class="intro-text">Join your community with an invitation, then find the people who are around and open to a conversation.</p>
      </div>
      <p class="intro-note"><span class="status-dot" aria-hidden="true"></span> Conversations while you’re both online</p>
    </section>

    <section class="auth-card" aria-labelledby="auth-title">
      <div class="auth-card-top">
        <span class="step-label">Your community</span>
        <span class="secure-label"><span class="lock-icon" aria-hidden="true">⌑</span> Passkey ready</span>
      </div>
      <h2 id="auth-title">{authMode === 'join' ? 'Join with a voucher' : 'Welcome back'}</h2>
      <p class="auth-lead">{authMode === 'join' ? 'Use the invitation shared with you by a member.' : 'Use your passkey on this device to sign in.'}</p>

      <div class="segmented" role="tablist" aria-label="Sign in or join">
        <button class:active={authMode === 'join'} role="tab" aria-selected={authMode === 'join'} on:click={() => (authMode = 'join')}>Join</button>
        <button class:active={authMode === 'signin'} role="tab" aria-selected={authMode === 'signin'} on:click={() => (authMode = 'signin')}>Sign in</button>
      </div>

      {#if authMode === 'join'}
        <form on:submit|preventDefault={submitVoucher} novalidate>
          <label for="voucher">Invitation voucher</label>
          <input id="voucher" bind:value={voucher} autocomplete="one-time-code" spellcheck="false" placeholder="Paste your voucher" aria-describedby="voucher-help" disabled={busyAction === 'join'} />
          <p id="voucher-help" class="field-help">Your voucher is checked securely when you join.</p>
          <button class="button button-primary button-wide" type="submit" disabled={busyAction === 'join'}>
            {#if busyAction === 'join'}<span class="spinner" aria-hidden="true"></span> Checking voucher…{:else}Continue to join <span aria-hidden="true">↗</span>{/if}
          </button>
        </form>
        <p class="auth-switch">Already a member? <button class="text-button" on:click={() => (authMode = 'signin')}>Sign in with a passkey</button></p>
      {:else}
        <div class="passkey-panel">
          <div class="passkey-icon" aria-hidden="true"><span></span><span></span><span></span></div>
          <p>Your device or passkey provider confirms it’s you. No password needed.</p>
        </div>
        <button class="button button-primary button-wide" type="button" on:click={signIn} disabled={busyAction === 'signin'}>
          {#if busyAction === 'signin'}<span class="spinner" aria-hidden="true"></span> Waiting for passkey…{:else}Sign in with passkey <span aria-hidden="true">↗</span>{/if}
        </button>
        <p class="auth-switch">New here? <button class="text-button" on:click={() => (authMode = 'join')}>Join with a voucher</button></p>
      {/if}
      {#if state.error}<p class="error-message" role="alert">{state.error}</p>{/if}
    </section>
  </main>
{:else}
  <div class="app-shell">
    <aside class:open={mobileNavOpen} class="sidebar" aria-label="Primary navigation">
      <div class="sidebar-head">
        <a class="brand" href="/" aria-label="cmeet home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>cmeet</span></a>
        <button class="icon-button mobile-close" on:click={() => (mobileNavOpen = false)} aria-label="Close navigation">×</button>
      </div>
      <div class="community-switcher">
        <span class="community-avatar" aria-hidden="true">{(state.config?.communityName ?? 'c').slice(0, 1).toUpperCase()}</span>
        <span><strong>{state.config?.communityName ?? 'Your community'}</strong><small>Member space</small></span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </div>
      <nav class="nav-links">
        <button class:current={page === 'discover'} on:click={() => goTo('discover')}><span class="nav-icon" aria-hidden="true">◌</span>Discover</button>
        <button class:current={page === 'messages'} on:click={() => goTo('messages')}><span class="nav-icon" aria-hidden="true">◍</span>Messages{#if conversations.length}<span class="nav-count">{conversations.length}</span>{/if}</button>
        <button class:current={page === 'profile'} on:click={() => goTo('profile')}><span class="nav-icon" aria-hidden="true">◉</span>My profile</button>
      </nav>
      <div class="sidebar-foot">
        <div class="connection-status"><span class:online={isOnline} class="status-dot" aria-hidden="true"></span><span>{connectionLabel}</span></div>
        <button class:current={page === 'settings'} class="settings-link" on:click={() => goTo('settings')}><span class="nav-icon" aria-hidden="true">◌</span>Settings</button>
        <div class="user-chip"><span class="avatar">{(state.profile?.displayName || 'M').slice(0, 1).toUpperCase()}</span><span class="user-chip-name">{state.profile?.displayName || 'Member'}</span><button class="signout-icon" aria-label="Sign out" on:click={signOut} disabled={busyAction === 'signout'}>↪</button></div>
      </div>
    </aside>

    {#if mobileNavOpen}<button class="scrim" aria-label="Close navigation" on:click={() => (mobileNavOpen = false)}></button>{/if}
    <main class="main-content">
      <header class="topbar">
        <button class="icon-button menu-button" on:click={() => (mobileNavOpen = true)} aria-label="Open navigation">☰</button>
        <div class="breadcrumb"><span>{page === 'discover' ? 'Discover' : page === 'messages' ? 'Messages' : page === 'profile' ? 'My profile' : 'Settings'}</span>{#if activeConversation}<span class="breadcrumb-separator">/</span><strong>{activeConversation.displayName ?? 'Conversation'}</strong>{/if}</div>
        <div class="topbar-actions"><span class:online={isOnline} class="status-dot" aria-label={connectionLabel} title={connectionLabel}></span><span class="topbar-status">{connectionLabel}</span></div>
      </header>

      <div class="content-wrap">
        {#if state.error}<div class="global-error" role="alert"><span aria-hidden="true">!</span><span>{state.error}</span><button on:click={() => (state = { ...state, error: null })} aria-label="Dismiss error">×</button></div>{/if}

        {#if page === 'discover'}
          <section class="page-heading"><div><p class="eyebrow">Your community</p><h1>Discover</h1><p>See who is around and open to meeting today.</p></div><button class="button button-secondary" on:click={refreshDiscovery} disabled={busyAction === 'discover'}><span class:spin={busyAction === 'discover'} aria-hidden="true">↻</span> Refresh</button></section>
          <section class="notice-card"><span class="notice-icon" aria-hidden="true">✦</span><div><strong>Discovery is member controlled</strong><p>Only profiles that are currently available appear here. You can go offline whenever you like.</p></div></section>
          {#if busyAction === 'discover' && visibleEntries.length === 0}
            <div class="loading-row"><span class="spinner spinner-dark" aria-hidden="true"></span> Looking for people…</div>
          {:else if visibleEntries.length === 0}
            <div class="empty-state"><div class="empty-icon" aria-hidden="true">◌</div><h2>No one is around right now</h2><p>There is nobody available to discover at the moment. Check back later.</p><button class="button button-secondary" on:click={refreshDiscovery}>Try again</button></div>
          {:else}
            <div class="section-label"><span>{visibleEntries.length === 1 ? '1 person available' : `${visibleEntries.length} people available`}</span><span class="muted">Online now</span></div>
            <div class="entry-grid">{#each visibleEntries as entry (entry.memberId ?? entry.id)}<article class="person-card"><div class="person-top"><span class="avatar avatar-large">{(entry.displayName ?? entry.name ?? 'M').slice(0, 1).toUpperCase()}</span><span class="online-pill"><span class="status-dot online" aria-hidden="true"></span>Online</span></div><h2>{entry.displayName ?? entry.name ?? 'Community member'}</h2>{#if entry.bio}<p>{entry.bio}</p>{/if}<button class="button button-secondary button-small" on:click={() => openConversation(entry)} disabled={busyAction === 'open'}>Start a conversation <span aria-hidden="true">↗</span></button></article>{/each}</div>
          {/if}
        {:else if page === 'messages'}
          <section class="page-heading"><div><p class="eyebrow">Private conversations</p><h1>Messages</h1><p>Start a conversation from Discover when someone is available.</p></div></section>
          {#if accountingPending}<section class="notice-card" role="status"><span class="notice-icon" aria-hidden="true">✦</span><div><strong>Membership is being activated</strong><p>{accountingMessage(state.accounting)}</p></div></section>{/if}
          {#if activeConversation}
            <section class="conversation-panel"><div class="conversation-head"><button class="back-button" on:click={closeConversation} aria-label="Back to conversations">←</button><span class="avatar">{(activeConversation.displayName ?? 'M').slice(0, 1).toUpperCase()}</span><div><h2>{activeConversation.displayName ?? 'Conversation'}</h2><p><span class:online={activePersonOnline} class="status-dot"></span>{activeContactPending ? 'Invitation waiting for your answer' : activeWaitingPeer ? 'Waiting for invitation acceptance' : activeAwaitingAnswer ? (activeCanSendIntroduction ? activeConversation.role === 'recipient' ? 'Ready to reply' : 'Ready to begin' : activeHasOutgoing ? 'Waiting for a reply' : 'Waiting for their first message') : activePersonOnline ? 'Online now' : 'Offline'}</p></div><button class="icon-button close-chat" aria-label="Close conversation" on:click={closeConversation}>×</button></div>{#if activeContactPending}<div class="notice-card" role="status"><span class="notice-icon" aria-hidden="true">✦</span><div><strong>Invitation waiting for your answer</strong><p>Choose whether to open this conversation.</p><div class="contact-actions"><button class="button button-primary button-small" on:click={() => respondToContact(activeConversation, true)} disabled={busyAction === 'answer' || !messagesAvailable}>{busyAction === 'answer' ? 'Accepting…' : 'Accept'}</button><button class="button button-secondary button-small" on:click={() => respondToContact(activeConversation, false)} disabled={busyAction === 'decline' || !messagesAvailable}>{busyAction === 'decline' ? 'Declining…' : 'Decline'}</button></div></div></div>{/if}{#if activeAwaitingAnswer}<div class="notice-card" role="status"><span class="notice-icon" aria-hidden="true">✦</span><div><strong>{activeCanSendIntroduction ? activeConversation.role === 'recipient' ? 'Ready to reply' : 'Ready to begin' : activeHasOutgoing ? 'Waiting for a reply' : 'Waiting for their first message'}</strong><p>{activeCanSendIntroduction ? 'Send a message when you are ready.' : activeHasOutgoing ? 'Your message is waiting for a reply.' : 'They will need to start the conversation.'}</p></div></div>{/if}<div class="message-list" aria-live="polite">{#if activeMessages.length}{#each activeMessages as message}<div class:mine={message.outgoing === true} class="message"><p>{message.text ?? ''}</p><time>{messageTime(message.timestamp)}{#if message.status}<span class="message-status"> · {message.status}</span>{/if}</time></div>{/each}{:else}<div class="chat-empty"><span class="empty-icon" aria-hidden="true">✦</span><p>{activeContactPending ? 'Choose whether to open this conversation.' : activeAwaitingAnswer ? activeCanSendIntroduction ? activeConversation.role === 'recipient' ? 'Reply when you are ready.' : 'Send a first message to begin.' : activeConversation.role === 'initiator' ? 'Waiting for a reply.' : 'Waiting for their first message.' : 'This is the beginning of your conversation.'}</p><small>{activeWaitingPeer ? 'Waiting for invitation acceptance.' : activeContactPending ? 'No messages have been exchanged.' : activeAwaitingAnswer ? activeCanSendIntroduction ? 'Send a message when you are ready.' : 'Waiting for their first message.' : 'Say hello when they are online.'}</small></div>{/if}</div>{#if !activeContactPending}<form class="composer" on:submit|preventDefault={sendCurrentMessage}><label for="message" class="visually-hidden">Write a message</label><input id="message" bind:value={composer} placeholder={activeAwaitingAnswer ? activeCanSendIntroduction ? activeConversation.role === 'recipient' ? 'Write a reply…' : 'Write a first message…' : 'Waiting for their first message' : activeWaitingPeer ? 'Waiting for invitation acceptance' : activePersonOnline ? 'Write a message…' : 'They are offline'} disabled={!activePersonOnline || activeWaitingPeer || (activeAwaitingAnswer && !activeCanSendIntroduction) || !messagesAvailable || busyAction === 'send'} autocomplete="off" /><button class="send-button" type="submit" aria-label="Send message" disabled={!composer.trim() || !activePersonOnline || activeWaitingPeer || (activeAwaitingAnswer && !activeCanSendIntroduction) || !messagesAvailable || busyAction === 'send'}>↑</button></form><p class="online-only-note"><span class="status-dot" aria-hidden="true"></span> Messages can be sent while both people are online.</p>{/if}</section>
          {:else if conversations.length}
            <div class="conversation-list">{#each conversations as conversation (conversation.id ?? conversation.memberId)}<button class="conversation-row" on:click={() => openConversation(conversation)}><span class="avatar">{(conversation.displayName ?? 'M').slice(0, 1).toUpperCase()}</span><span class="conversation-copy"><strong>{conversation.displayName ?? 'Conversation'}</strong><small>{isPendingContact(conversation) ? 'Invitation waiting for your answer' : isWaitingForAcceptance(conversation) ? 'Waiting for invitation acceptance' : isAwaitingAnswer(conversation) ? conversation.canSendIntroduction === true ? conversation.role === 'recipient' ? 'Ready to reply' : 'Ready to begin' : conversation.role === 'initiator' ? 'Waiting for a reply' : 'Waiting for their first message' : conversation.lastMessage ?? 'Open conversation'}</small></span>{#if isPendingContact(conversation)}<span class="muted">Pending</span>{:else if isAwaitingAnswer(conversation)}<span class="muted">{conversation.canSendIntroduction === true ? 'Ready' : 'Waiting'}</span>{/if}<span class:online={conversation.online === true} class="status-dot"></span><span class="chevron" aria-hidden="true">›</span></button>{/each}</div>
          {:else}
            <div class="empty-state"><div class="empty-icon" aria-hidden="true">◍</div><h2>Your conversations will appear here</h2><p>When you find someone in Discover, start a conversation and it will show up in this space.</p><button class="button button-primary" on:click={() => goTo('discover')}>Go to Discover <span aria-hidden="true">↗</span></button></div>
          {/if}
        {:else if page === 'profile'}
          <section class="page-heading"><div><p class="eyebrow">Your presence</p><h1>My profile</h1><p>Choose what other members see when you are available.</p></div></section>
          <section class="profile-card"><div class="profile-cover"><span class="avatar avatar-profile">{(state.profile?.displayName || draftName || 'M').slice(0, 1).toUpperCase()}</span><div><h2>{state.profile?.displayName || draftName || 'Your profile'}</h2><p><span class="status-dot online"></span> Member</p></div></div><form class="profile-form" on:submit|preventDefault={saveProfile}><div class="form-row"><label for="displayName">Display name<input id="displayName" name="displayName" value={draftName} on:input={profileInput} maxlength="80" autocomplete="name" /></label><span class="field-caption">Shown to community members</span></div><div class="form-row"><label for="bio">Short bio<textarea id="bio" name="bio" on:input={profileInput} maxlength="280" rows="4" placeholder="A little about you">{draftBio}</textarea></label><span class="field-caption">Keep it concise and personal</span></div><div class="form-actions"><span class="muted">Visible to eligible community members.</span><button class="button button-primary" type="submit" disabled={busyAction === 'profile'}>{busyAction === 'profile' ? 'Saving…' : 'Save profile'}</button></div></form></section>
        {:else}
          <section class="page-heading"><div><p class="eyebrow">Account</p><h1>Settings</h1><p>Manage this session and your community connection.</p></div></section>
          <section class="settings-card"><div class="settings-row"><div><h2>Session</h2><p>You are signed in with a passkey on this device.</p></div><button class="button button-secondary" on:click={signOut} disabled={busyAction === 'signout'}>{busyAction === 'signout' ? 'Signing out…' : 'Sign out'}</button></div><div class="settings-row"><div><h2>Availability</h2><p>Discovery currently shows only members who are available online.</p></div><span class="availability-label"><span class:online={isOnline} class="status-dot"></span>{connectionLabel}</span></div></section>
          <section class="settings-card automation-card">
            <div class="settings-row"><div><h2>Automation access</h2><p>Create a scoped API key for approved community automation. The secret appears once.</p></div>{#if automationBusy}<span class="muted">Updating…</span>{/if}</div>
            {#if automationError}<p class="error-message" role="alert">{automationError}</p>{/if}
            {#if !automationPolicy && !automationError}<p class="muted">Loading the community automation policy…</p>{:else if automationPolicy}
              <form class="profile-form" on:submit|preventDefault={createAutomationKey}>
                <div class="form-row"><label for="automation-name">Key name<input id="automation-name" bind:value={automationName} maxlength="80" autocomplete="off" placeholder="For example, my workflow" /></label></div>
                <div class="form-row"><span class="field-caption">Allowed operations</span><div class="scope-list">{#each automationPolicy.scopes as scope}<label class="scope-option"><input type="checkbox" checked={automationScopes.includes(scope)} on:change={() => toggleAutomationScope(scope)} /> <span>{scope}</span></label>{/each}</div></div>
                <div class="form-row"><label for="automation-expiry">Expires<select id="automation-expiry" bind:value={automationExpiry}><option value="">Choose a configured lifetime</option>{#each automationPolicy.expirySeconds as seconds}<option value={seconds}>{seconds < 86400 ? `${Math.round(seconds / 3600)} hours` : `${Math.round(seconds / 86400)} days`}</option>{/each}</select></label></div>
                <div class="form-actions"><span class="muted">Keys cannot create or revoke other keys.</span><button class="button button-primary" type="submit" disabled={automationBusy || !automationName.trim() || !automationScopes.length || !automationExpiry}>Create API key</button></div>
              </form>
              {#if newAutomationSecret}<div class="secret-panel"><strong>Copy this secret now</strong><code>{newAutomationSecret}</code><div><button class="button button-secondary button-small" on:click={() => copyText(newAutomationSecret)}>Copy secret</button><button class="text-button" on:click={clearAutomationSecret}>Clear</button></div></div>{/if}
              <div class="automation-key-list"><h3>Active keys</h3>{#if automationKeys.length}{#each automationKeys as key}<div class="settings-row"><div><strong>{key.label}</strong><small>{key.scopes.join(', ')} · expires {new Date(key.expiresAt * 1000).toLocaleDateString()}</small></div><button class="button button-secondary button-small" on:click={() => revokeAutomationKey(key.id)} disabled={automationBusy}>Revoke</button></div>{/each}{:else}<p class="muted">No active API keys.</p>{/if}</div>
              {#if mcpEndpoint}<div class="mcp-panel"><div class="settings-row"><div><h3>Remote MCP</h3><p>Use the endpoint with an API key. Requests still require signed community operations.</p></div><button class="button button-secondary button-small" on:click={() => copyText(mcpEndpoint)}>Copy endpoint</button></div><code>{mcpEndpoint}</code>{#if mcpCapabilities.length}<p class="field-caption">Configured capabilities</p><ul>{#each mcpCapabilities as capability}<li><strong>{capability.name}</strong>{#if capability.description} — {capability.description}{/if}</li>{/each}</ul>{/if}</div>{/if}
            {/if}
          </section>
        {/if}
      </div>
    </main>
  </div>
{/if}
