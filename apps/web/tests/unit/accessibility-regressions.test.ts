import { describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import AccessibilityHarness from './fixtures/AccessibilityHarness.svelte';

// The jsdom build used for component tests does not implement the dialog
// modal platform methods. Define them temporarily for the mounted test and
// restore afterwards. The component itself is never mocked.
function installDialogPolyfill(): () => void {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const prevShowModal = proto['showModal'];
  const prevClose = proto['close'];
  proto['showModal'] = function (this: Element) {
    (this as unknown as Record<string, unknown>)['open'] = true;
  };
  proto['close'] = function (this: Element) {
    (this as unknown as Record<string, unknown>)['open'] = false;
  };
  return () => {
    proto['showModal'] = prevShowModal;
    proto['close'] = prevClose;
  };
}

function closeCountOf(target: HTMLElement): number {
  return Number(target.querySelector('[data-testid="close-count"]')?.textContent ?? 'NaN');
}

function dialogStateOf(target: HTMLElement): string {
  return target.querySelector('[data-testid="dialog-state"]')?.textContent ?? '';
}

function clickTestId(target: HTMLElement, id: string) {
  (target.querySelector(`[data-testid="${id}"]`) as HTMLElement).click();
}

describe('dialog repeat dismissal after a temporary refusal', () => {
  it('delivers every Escape request so a refused close can be retried', async () => {
    const restore = installDialogPolyfill();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(AccessibilityHarness, {
      target,
      props: { startOpen: true, progressInitial: 0.25 },
    });
    try {
      await tick();
      await tick();
      expect(target.querySelector('dialog')).not.toBeNull();
      expect(dialogStateOf(target)).toBe('open');
      expect(closeCountOf(target)).toBe(0);

      // The parent refuses this dismissal and stays open (busy).
      clickTestId(target, 'refuse-once');
      await tick();
      target.querySelector('dialog')?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
      await tick();
      expect(closeCountOf(target)).toBe(1);
      expect(dialogStateOf(target)).toBe('open');
      expect(target.querySelector('dialog')).not.toBeNull();

      // The retry must reach the parent again instead of being deduped.
      target.querySelector('dialog')?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
      await tick();
      expect(closeCountOf(target)).toBe(2);
      expect(dialogStateOf(target)).toBe('closed');
      expect(target.querySelector('dialog')).toBeNull();

      // Reopening keeps working through the same controlled prop.
      clickTestId(target, 'open-dialog');
      await tick();
      await tick();
      expect(target.querySelector('dialog')).not.toBeNull();
      target.querySelector('dialog')?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
      await tick();
      expect(closeCountOf(target)).toBe(3);
      expect(dialogStateOf(target)).toBe('closed');
    } finally {
      await unmount(component);
      target.remove();
      restore();
    }
  });

  it('delivers repeated backdrop requests after a temporary refusal', async () => {
    const restore = installDialogPolyfill();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(AccessibilityHarness, {
      target,
      props: { startOpen: true, progressInitial: 0.25 },
    });
    try {
      await tick();
      await tick();
      const first = target.querySelector('dialog') as HTMLDialogElement | null;
      expect(first).not.toBeNull();

      clickTestId(target, 'refuse-once');
      await tick();
      // jsdom reports a zero rect, so a click at (100,100) is outside the
      // dialog bounds and takes the backdrop path.
      first?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }),
      );
      await tick();
      expect(closeCountOf(target)).toBe(1);
      expect(dialogStateOf(target)).toBe('open');

      target.querySelector('dialog')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }),
      );
      await tick();
      expect(closeCountOf(target)).toBe(2);
      expect(dialogStateOf(target)).toBe('closed');
    } finally {
      await unmount(component);
      target.remove();
      restore();
    }
  });
});

describe('progressbar reactive value', () => {
  it('updates only the observable aria-valuenow when the harnessed value changes', async () => {
    const restore = installDialogPolyfill();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(AccessibilityHarness, {
      target,
      props: { startOpen: false, progressInitial: 0.25 },
    });
    try {
      await tick();
      const bar = () => target.querySelector('[role="progressbar"]');
      expect(bar()?.getAttribute('aria-valuenow')).toBe('25');

      clickTestId(target, 'progress-over');
      await tick();
      expect(bar()?.getAttribute('aria-valuenow')).toBe('100');

      clickTestId(target, 'progress-under');
      await tick();
      expect(bar()?.getAttribute('aria-valuenow')).toBe('0');

      clickTestId(target, 'progress-half');
      await tick();
      expect(bar()?.getAttribute('aria-valuenow')).toBe('50');

      clickTestId(target, 'progress-zero');
      await tick();
      expect(bar()?.getAttribute('aria-valuenow')).toBe('0');
    } finally {
      await unmount(component);
      target.remove();
      restore();
    }
  });
});
