<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Notice } from '../../../ui/src/index.js';
  import { pwaStrings } from './strings/pwa.js';
  import {
    SW_UNAVAILABLE_EVENT,
    isInstallPromptEvent,
    isStandaloneMode,
    type InstallPromptEvent,
  } from './pwa.js';

  // The native prompt event is single-use. It is stored only when the browser
  // actually emits it, consumed exactly once on click, and cleared whenever
  // the app is installed. No persistence, no analytics.
  let deferred: InstallPromptEvent | null = $state(null);
  let installed = $state(false);
  let busy = $state(false);
  let offlineLimited = $state(false);

  async function installNow(): Promise<void> {
    const pending = deferred;
    if (!pending || busy) return;
    busy = true;
    try {
      await pending.prompt();
    } catch {
      // A rejected prompt keeps the manual steps visible.
    } finally {
      if (deferred === pending) deferred = null;
      busy = false;
    }
  }

  onMount(() => {
    installed = isStandaloneMode();
    const media = window.matchMedia?.('(display-mode: standalone)');
    const onStandaloneChange = (event: MediaQueryListEvent) => {
      installed = event.matches;
      if (event.matches) deferred = null;
    };
    const onBeforeInstall = (event: Event) => {
      if (!isInstallPromptEvent(event)) return;
      event.preventDefault();
      if (!installed) deferred = event;
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
    };
    const onOfflineLimited = () => {
      offlineLimited = true;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(SW_UNAVAILABLE_EVENT, onOfflineLimited);
    media?.addEventListener?.('change', onStandaloneChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(SW_UNAVAILABLE_EVENT, onOfflineLimited);
      media?.removeEventListener?.('change', onStandaloneChange);
    };
  });
</script>

<section class="pwa-install" aria-label={pwaStrings.installTitle}>
  <h2>{pwaStrings.installTitle}</h2>
  <p class="muted">{pwaStrings.installLead}</p>
  {#if offlineLimited}
    <Notice tone="warning">{pwaStrings.offlineLimited}</Notice>
  {/if}
  {#if !installed && deferred}
    <div class="row">
      <Button
        variant="primary"
        onclick={installNow}
        busy={busy}
        busyLabel={pwaStrings.installingAction}
      >
        {pwaStrings.installAction}
      </Button>
    </div>
  {/if}
  <details class="pwa-help">
    <summary>{pwaStrings.helpSummary}</summary>
    <h3>{pwaStrings.iphoneTitle}</h3>
    <ol>
      {#each pwaStrings.iphoneSteps as step}
        <li>{step}</li>
      {/each}
    </ol>
    <h3>{pwaStrings.androidTitle}</h3>
    <ol>
      {#each pwaStrings.androidSteps as step}
        <li>{step}</li>
      {/each}
    </ol>
    <p class="muted">{pwaStrings.iosNote}</p>
  </details>
</section>

<style>
  .pwa-install {
    max-width: 40rem;
    margin: 0 auto;
    padding: 1rem;
  }
  .pwa-help {
    margin-top: 0.75rem;
    border: 1px solid var(--cmeet-line);
    border-radius: var(--cmeet-radius);
    padding: 0.6rem 0.9rem;
    background: var(--cmeet-surface);
  }
  .pwa-help summary {
    cursor: pointer;
    font-weight: 700;
    padding: 0.25rem 0;
  }
  .pwa-help summary:focus-visible {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
  }
  .pwa-help h3 {
    margin-bottom: 0.25rem;
  }
  .pwa-help ol {
    margin-top: 0.25rem;
    padding-left: 1.4rem;
  }
</style>
