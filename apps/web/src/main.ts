import { flushSync, mount } from 'svelte';
import App from './App.svelte';
import Unavailable from './Unavailable.svelte';
import InstallPrompt from './InstallPrompt.svelte';
import { createClient, Session } from './session.svelte.js';
import { notifyServiceWorkerUnavailable, registerShellServiceWorker } from './pwa.js';
import CliLogin from './views/CliLogin.svelte';
import { createCliLoginPort, isCliLoginHash, takeLaunch } from './browser/cli-login.js';
import { isVaultHost } from './browser/origins.js';
import { mountVault } from './browser/vault-entry.js';
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
if (installTarget && !isVaultHost(window.location.hostname)) {
  flushSync(() => {
    mount(InstallPrompt, { target: installTarget });
  });
}

// Register the offline shell before the client starts: a future real client
// can block, and installability must not wait for it. A missing or rejected
// worker is reported as limited offline availability, never readiness.
if (import.meta.env.PROD && !isVaultHost(window.location.hostname)) {
  registerShellServiceWorker().catch(() => {
    notifyServiceWorkerUnavailable();
  });
}

const target = document.getElementById('app')!;
let app;
if (isVaultHost(window.location.hostname)) {
  // vault.<community>.<base>: only the vault frame or the sign-in pop-up, never the member app.
  app = await mountVault(target);
} else if (isCliLoginHash(window.location.hash)) {
  // The page opened by "cmeet login": the launch fragment goes to the runtime port only.
  const launch = takeLaunch(window);
  const port = await createCliLoginPort(window.location.search);
  app = mount(CliLogin, { target, props: { port, launch, pageOrigin: window.location.origin } });
} else {
  const client = await createClient();
  app = client
    ? mount(App, { target, props: { session: new Session(client) } })
    : mount(Unavailable, { target });
}

export default app;
