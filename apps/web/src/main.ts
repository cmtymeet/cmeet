import { mount } from 'svelte';
import App from './App.svelte';
import Unavailable from './Unavailable.svelte';
import InstallPrompt from './InstallPrompt.svelte';
import { createClient, Session } from './session.svelte.js';
import { notifyServiceWorkerUnavailable, registerShellServiceWorker } from './pwa.js';
import './app.css';
import { community } from './community.js';

// White-label theme: a token override only, no component changes.
import forestThemeUrl from '../../../ui/src/themes/forest.css?url';
import harbourThemeUrl from '../../../ui/src/themes/harbour.css?url';

const themeUrls = { forest: forestThemeUrl, harbour: harbourThemeUrl } as const;
if (community.theme !== 'default') {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeUrls[community.theme];
  document.head.appendChild(link);
}

// Mount the install prompt before the async client starts so the
// beforeinstallprompt listener is captured while the app still loads.
const installTarget = document.getElementById('install');
if (installTarget) {
  mount(InstallPrompt, { target: installTarget });
}

const client = await createClient();
const target = document.getElementById('app')!;
const app = client
  ? mount(App, { target, props: { session: new Session(client) } })
  : mount(Unavailable, { target });

// Offline-capable shell. Content stays on devices and the DHT; the worker
// only caches same-origin app files. Registration must not wait only for a
// future load event: the document may already be complete (see pwa.ts).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerShellServiceWorker().catch(() => {
    // Offline use stays limited; never claim the connection is ready.
    notifyServiceWorkerUnavailable();
  });
}

export default app;
