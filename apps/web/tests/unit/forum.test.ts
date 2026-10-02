import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Forum from '../../src/views/Forum.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, CmsgEventHandler, DiscoveryFilter, MatchPage } from '../../../../core/src/cmsg.js';

const join = { voucher: 'VOUCHER-TEST-123', handle: 'fixture-member' };
const ownValues = {
  age: 34,
  neighbourhood: 'North',
  weekend: 'Reading',
  location: { latitude: 47.3769, longitude: 8.5417 },
};

async function admitted(options: Parameters<typeof createDevCmsg>[0] = {}) {
  const client = createDevCmsg(options);
  await client.joinWithVoucher(join);
  await client.publishProfile({ ...ownValues });
  return client;
}

function render(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Forum, { target, props: { client } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function buttonByName(target: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = [...target.querySelectorAll('button')];
  return (buttons.find((b) => b.textContent?.includes(name)) as HTMLButtonElement) ?? null;
}

async function fill(target: HTMLElement, id: string, value: string) {
  const input = target.querySelector(`#${CSS.escape(id)}`) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  expect(input).not.toBeNull();
  if (input instanceof HTMLSelectElement) {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    input!.value = value;
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await tick();
}

describe('forum discovery', () => {
  it('lists online two-way matches with schema controls and no private values', async () => {
    const { target, cleanup } = render(await admitted());
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      expect(target.textContent).toMatch(/tom-cooks/);
      expect(target.querySelector('#filter-neighbourhood')).not.toBeNull();
      expect(target.querySelector('#filter-age-min')).not.toBeNull();
      expect(target.querySelector('#filter-age-max')).not.toBeNull();
      expect(target.querySelector('#filter-location-distance')).not.toBeNull();
      // Private values never leak into discovery cards.
      expect(target.textContent).not.toMatch(/Hello\./);
      // Viewing the list sends no key or wave traffic by itself.
      expect(target.textContent).not.toMatch(/Key accepted|Not a match/);
    } finally {
      cleanup();
    }
  });

  it('narrows the list through a schema choice filter and restores it', async () => {
    const { target, cleanup } = render(await admitted());
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      await fill(target, 'filter-neighbourhood', 'East');
      await vi.waitFor(() => expect(target.textContent).not.toMatch(/ana-walks/));
      expect(target.textContent).toMatch(/tom-cooks/);
      await fill(target, 'filter-neighbourhood', '');
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
    } finally {
      cleanup();
    }
  });

  it('sends number bounds and location distanceKm as typed inputs', async () => {
    const client = await admitted();
    const spy = vi.spyOn(client, 'discover');
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      spy.mockClear();
      await fill(target, 'filter-age-min', '30');
      await fill(target, 'filter-age-max', '40');
      await vi.waitFor(() =>
        expect(spy).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ field: 'age', min: 30, max: 40 }),
          ]),
          null,
        ),
      );
      spy.mockClear();
      await fill(target, 'filter-location-distance', '5');
      await vi.waitFor(() =>
        expect(spy).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ field: 'location', maxDistanceKm: 5 }),
          ]),
          null,
        ),
      );
      // Nearby members stay; the far-away member drops out without UI distance math.
      await vi.waitFor(() => expect(target.textContent).not.toMatch(/rin-reads/));
      expect(target.textContent).toMatch(/ana-walks/);
    } finally {
      cleanup();
    }
  });

  it('maps a schema yes-no field to boolean equals without UI decisions', async () => {
    const base = await admitted();
    const extendedSchema = await base.schema();
    const withConsent = {
      ...base,
      schema: async () => ({
        ...extendedSchema,
        fields: [
          ...extendedSchema.fields,
          {
            key: 'smoker',
            question: 'Do you smoke?',
            kind: 'yes-no' as const,
            visibility: 'public' as const,
            required: false,
            filterable: true,
          },
        ],
      }),
    } satisfies CmsgClient;
    const spy = vi.spyOn(withConsent, 'discover');
    const { target, cleanup } = render(withConsent);
    try {
      await vi.waitFor(() => expect(target.querySelector('#filter-smoker')).not.toBeNull());
      await fill(target, 'filter-smoker', 'Yes');
      await vi.waitFor(() =>
        expect(spy).toHaveBeenCalledWith(
          expect.arrayContaining([{ field: 'smoker', equals: [true] }]),
          null,
        ),
      );
    } finally {
      cleanup();
    }
  });

  it('pages with the opaque cursor through Load more', async () => {
    const { target, cleanup } = render(await admitted({ pageSize: 1 }));
    try {
      await vi.waitFor(() => expect(buttonByName(target, 'Load more')).not.toBeNull());
      const before = target.textContent ?? '';
      expect(before).toMatch(/ana-walks/);
      buttonByName(target, 'Load more')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/tom-cooks/));
      expect(target.textContent).toMatch(/ana-walks/);
    } finally {
      cleanup();
    }
  });

  it('ignores stale async filter results by request generation', async () => {
    const base = await admitted();
    let releaseFirst!: (value: Awaited<ReturnType<CmsgClient['discover']>>) => void;
    const firstGate = new Promise<Awaited<ReturnType<CmsgClient['discover']>>>((resolve) => {
      releaseFirst = resolve;
    });
    const realDiscover = base.discover.bind(base);
    let calls = 0;
    const gated: CmsgClient = {
      ...base,
      discover: (discoveryFilters: DiscoveryFilter[], atCursor?: string | null): Promise<MatchPage> => {
        calls += 1;
        if (calls === 1) return firstGate;
        return realDiscover(discoveryFilters, atCursor);
      },
    };
    const { target, cleanup } = render(gated);
    try {
      await tick();
      await tick();
      await fill(target, 'filter-neighbourhood', 'East');
      await vi.waitFor(() => expect(target.textContent).toMatch(/tom-cooks/));
      expect(target.textContent).not.toMatch(/ana-walks/);
      releaseFirst({ entries: [], cursor: null });
      await tick();
      await tick();
      // The stale first page must not wipe the newer filtered view.
      expect(target.textContent).toMatch(/tom-cooks/);
      expect(target.textContent).not.toMatch(/ana-walks/);
    } finally {
      cleanup();
    }
  });

  it('shows the returned profile preview on accept and only the failing field on reject', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      buttonByName(target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Key accepted/));
      expect(target.textContent).toMatch(/Front: public profile/);

      await client.saveRules([{ field: 'age', min: 50, max: 60 }]);
      buttonByName(target, 'Refresh')!.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      buttonByName(target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Not a match on:/));
      expect(target.textContent).toMatch(/They never see your rules/);
      expect(target.textContent).not.toMatch(/raw key/i);
    } finally {
      cleanup();
    }
  });

  it('shows the full owner reason for incoming key decisions with look-back', async () => {
    const base = await admitted();
    let handler: CmsgEventHandler | null = null;
    const withCapture: CmsgClient = {
      ...base,
      subscribe: (next) => {
        handler = next;
        return base.subscribe(next);
      },
    };
    const { target, cleanup } = render(withCapture);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Private profile exchanges/));
      expect(target.textContent).toMatch(/ana-walks/);
      handler!({
        type: 'key-decision',
        peer: 'member-ana',
        result: { status: 'rejected', failingField: 'age', reason: 'Age 34 is below the minimum 50.' },
      });
      await vi.waitFor(() =>
        expect(target.textContent).toMatch(/Age 34 is below the minimum 50/),
      );
      expect(target.textContent).toMatch(/look back/);
    } finally {
      cleanup();
    }
  });

  it('composes the first wave through sendWave with busy guards and the returned outcome', async () => {
    const client = await admitted();
    const spy = vi.spyOn(client, 'sendWave');
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      buttonByName(target, 'Write first wave')!.click();
      await tick();
      await fill(target, 'wave-member-ana', 'Hello from the forum!');
      const send = buttonByName(target, 'Send wave')!;
      send.click();
      send.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Wave sent\. Status:/));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('member-ana', 'Hello from the forum!');
    } finally {
      cleanup();
    }
  });

  it('clears departed candidates after a contacts event from blocking', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/tom-cooks/));
      await client.blockMember('member-tom');
      await vi.waitFor(() => expect(target.textContent).not.toMatch(/tom-cooks/));
      expect(target.textContent).toMatch(/ana-walks/);
    } finally {
      cleanup();
    }
  });

  it('keeps error, loading and empty states distinct on injected failures', async () => {
    const failingDiscover = createDevCmsg({ failActions: ['discover'] });
    await failingDiscover.joinWithVoucher(join);
    await failingDiscover.publishProfile({ ...ownValues });
    const first = render(failingDiscover);
    try {
      await vi.waitFor(() => expect(first.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(first.target.textContent).toMatch(/unavailable/);
    } finally {
      first.cleanup();
    }

    const failingKey = await admitted({ failActions: ['requestPrivateKey'] });
    const second = render(failingKey);
    try {
      await vi.waitFor(() => expect(second.target.textContent).toMatch(/ana-walks/));
      buttonByName(second.target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(second.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(second.target.textContent).toMatch(/Fixture failure/);
    } finally {
      second.cleanup();
    }

    const failingWave = await admitted({ failActions: ['sendWave'] });
    const third = render(failingWave);
    try {
      await vi.waitFor(() => expect(third.target.textContent).toMatch(/ana-walks/));
      buttonByName(third.target, 'Write first wave')!.click();
      await tick();
      await fill(third.target, 'wave-member-ana', 'Hello!');
      buttonByName(third.target, 'Send wave')!.click();
      await vi.waitFor(() => expect(third.target.textContent).toMatch(/Fixture failure/));
    } finally {
      third.cleanup();
    }
  });
});
