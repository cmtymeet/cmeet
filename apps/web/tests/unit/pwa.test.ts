import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import InstallPrompt from '../../src/InstallPrompt.svelte';
import { SW_UNAVAILABLE_EVENT, registerShellServiceWorker } from '../../src/pwa.js';

type PromptDouble = Event & { prompt: () => Promise<void> };

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')?.value;

function stubStandalone(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mql = {
    matches,
    media: '(display-mode: standalone)',
    addEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    }),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mql),
  });
  return mql;
}

afterEach(() => {
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window, 'matchMedia');
  } else {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  }
  vi.restoreAllMocks();
});

function render() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(InstallPrompt, { target });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function fireInstallPrompt(prompt: () => Promise<void>): PromptDouble {
  // Browser event boundary double only: a real Event carrying the real
  // prompt entry point, never a mocked component.
  const event = new Event('beforeinstallprompt', { cancelable: true }) as PromptDouble;
  event.prompt = prompt;
  window.dispatchEvent(event);
  return event;
}

function installButton(target: HTMLElement): HTMLButtonElement | null {
  const buttons = [...target.querySelectorAll('button')];
  return (buttons.find((button) => button.textContent?.includes('Install')) as HTMLButtonElement) ?? null;
}

describe('install prompt', () => {
  it('always shows collapsible home-screen help, without a native action first', async () => {
    stubStandalone(false);
    const { target, cleanup } = render();
    try {
      await tick();
      expect(target.textContent).toMatch(/Add to Home Screen/);
      expect(target.textContent).toMatch(/Share/);
      expect(target.textContent).toMatch(/browser menu/i);
      expect(target.querySelector('details')).not.toBeNull();
      expect(installButton(target)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('reveals the install action only after the event, prompts only on click, consumes once', async () => {
    stubStandalone(false);
    const prompt = vi.fn(async () => {});
    const { target, cleanup } = render();
    try {
      await tick();
      expect(installButton(target)).toBeNull();
      fireInstallPrompt(prompt);
      await tick();
      const button = installButton(target);
      expect(button).not.toBeNull();
      expect(prompt).not.toHaveBeenCalled();
      button!.click();
      await tick();
      await tick();
      expect(prompt).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(installButton(target)).toBeNull());
      expect(prompt).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('hides the install action once the app is installed', async () => {
    stubStandalone(false);
    const { target, cleanup } = render();
    try {
      await tick();
      fireInstallPrompt(async () => {});
      await tick();
      expect(installButton(target)).not.toBeNull();
      window.dispatchEvent(new Event('appinstalled'));
      await tick();
      expect(installButton(target)).toBeNull();
      // Help stays usable after installing.
      expect(target.querySelector('details')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('hides the install action in standalone display mode', async () => {
    stubStandalone(true);
    const { target, cleanup } = render();
    try {
      await tick();
      fireInstallPrompt(async () => {});
      await tick();
      expect(installButton(target)).toBeNull();
      expect(target.querySelector('details')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('reports limited offline availability without claiming readiness', async () => {
    stubStandalone(false);
    const { target, cleanup } = render();
    try {
      await tick();
      expect(target.textContent).not.toMatch(/limited/);
      window.dispatchEvent(new CustomEvent(SW_UNAVAILABLE_EVENT));
      await tick();
      expect(target.textContent).toMatch(/Offline availability is limited/);
      expect(target.textContent).not.toMatch(/ready/i);
      expect(target.textContent).not.toMatch(/connected/i);
    } finally {
      cleanup();
    }
  });

  it('disposes listeners on unmount', async () => {
    stubStandalone(false);
    const prompt = vi.fn(async () => {});
    const { cleanup } = render();
    await tick();
    cleanup();
    expect(() => {
      fireInstallPrompt(prompt);
      window.dispatchEvent(new Event('appinstalled'));
      window.dispatchEvent(new CustomEvent(SW_UNAVAILABLE_EVENT));
    }).not.toThrow();
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('service worker registration', () => {
  const realServiceWorker = Object.getOwnPropertyDescriptor(window.navigator, 'serviceWorker')?.value;

  afterEach(() => {
    if (realServiceWorker === undefined) {
      Reflect.deleteProperty(window.navigator, 'serviceWorker');
    } else {
      Object.defineProperty(window.navigator, 'serviceWorker', {
        configurable: true,
        writable: true,
        value: realServiceWorker,
      });
    }
    Reflect.deleteProperty(document, 'readyState');
  });

  function stubWorker(register: () => Promise<unknown>) {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      writable: true,
      value: { register },
    });
  }

  function stubReadyState(value: string) {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => value });
  }

  it('rejects where service workers are unsupported', async () => {
    Reflect.deleteProperty(window.navigator, 'serviceWorker');
    await expect(registerShellServiceWorker()).rejects.toThrow();
  });

  it('registers at once when the document is already complete', async () => {
    const register = vi.fn(async () => ({}));
    stubWorker(register);
    stubReadyState('complete');
    await registerShellServiceWorker();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('waits for load when the document is still loading', async () => {
    const register = vi.fn(async () => ({}));
    stubWorker(register);
    stubReadyState('loading');
    const pending = registerShellServiceWorker();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    await pending;
    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('propagates rejection so the caller can report limited offline use', async () => {
    stubWorker(async () => {
      throw new Error('denied');
    });
    stubReadyState('complete');
    await expect(registerShellServiceWorker()).rejects.toThrow('denied');
  });
});
