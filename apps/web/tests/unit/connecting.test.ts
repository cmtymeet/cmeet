import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import Connecting from '../../src/views/Connecting.svelte';
import type { ConnectionStatus } from '../../../../core/src/cmsg.js';

function render(status: ConnectionStatus, onretry: () => void = () => {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Connecting, { target, props: { status, onretry } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

describe('connecting screen', () => {
  it('shows calm progress while the network stands up', () => {
    const { target, cleanup } = render({
      phase: 'bootstrapping',
      progress: 0.3,
      backend: 'tor',
      message: 'Starting Tor bootstrap.',
    });
    try {
      expect(target.querySelector('[role="progressbar"]')).not.toBeNull();
      expect(target.textContent).toMatch(/Starting Tor bootstrap/);
      expect(target.querySelector('button')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('shows failure plainly and offers a retry', () => {
    const onretry = vi.fn();
    const { target, cleanup } = render(
      {
        phase: 'failed',
        progress: 0.7,
        backend: 'tor',
        message: 'The network could not be reached.',
      },
      onretry,
    );
    try {
      expect(target.textContent).toMatch(/could not be established/);
      const button = target.querySelector('button');
      expect(button?.textContent).toMatch(/Try again/);
      button?.click();
      expect(onretry).toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
