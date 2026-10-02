import { flushSync, mount } from 'svelte';
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

// Mount the install prompt first so its beforeinstallprompt listener is
// attached before anything asynchronous runs. flushSync guarantees the
// listeners exist before the registration below can fail.
const installTarget = document.getElementById('install');
if (installTarget) {
  flushSync(() => {
    mount(InstallPrompt, { target: installTarget });
  });
}

// Register the offline shell before the client starts: a future real client
// can block, and installability must not wait for it. A missing or rejected
// worker is reported as limited offline availability, never readiness.
if (import.meta.env.PROD) {
  registerShellServiceWorker().catch(() => {
    notifyServiceWorkerUnavailable();
  });
}

const client = await createClient();
const target = document.getElementById('app')!;
const app = client
  ? mount(App, { target, props: { session: new Session(client) } })
  : mount(Unavailable, { target });

export default app;
