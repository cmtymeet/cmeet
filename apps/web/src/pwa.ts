// Thin browser helpers for installability and the offline shell.
// Presentation only: no domain logic, no fetches, no storage, no analytics.

export const SW_UNAVAILABLE_EVENT = 'cmeet:sw-unavailable';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

export function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return typeof (event as Partial<InstallPromptEvent>).prompt === 'function';
}

export function isStandaloneMode(scope?: {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}): boolean {
  try {
    const target =
      scope ??
      (typeof window !== 'undefined'
        ? {
            matchMedia: window.matchMedia?.bind(window),
            navigator: window.navigator,
          }
        : undefined);
    if (!target) return false;
    if (target.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    return target.navigator?.standalone === true;
  } catch {
    return false;
  }
}

export function notifyServiceWorkerUnavailable(
  target: Pick<EventTarget, 'dispatchEvent'> = window,
): void {
  target.dispatchEvent(new CustomEvent(SW_UNAVAILABLE_EVENT));
}

export async function registerShellServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are unavailable.');
  }
  const register = () => navigator.serviceWorker.register('./sw.js');
  // The document may already be past loading, so never wait only for a
  // future load event that has already fired.
  if (document.readyState === 'complete') return register();
  await new Promise<void>((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
      return;
    }
    window.addEventListener('load', () => resolve(), { once: true });
  });
  return register();
}
