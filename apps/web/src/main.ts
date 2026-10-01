import { mount } from 'svelte';
import App from './App.svelte';
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

const app = mount(App, { target: document.getElementById('app')! });

// Offline-capable shell. Content stays on devices and the DHT; the worker
// only caches same-origin app files.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

export default app;
