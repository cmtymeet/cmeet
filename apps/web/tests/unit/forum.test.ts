import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Forum from '../../src/views/Forum.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type {
  CmsgClient,
  CmsgEventHandler,
  DiscoveryFilter,
  MatchPage,
  ProfileExchange,
} from '../../../../core/src/cmsg.js';

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
    cleanup: async () => {
      await unmount(component);
      target.remove();
    },
  };
}

function cardByHandle(target: HTMLElement, handle: string) {
  return [...target.querySelectorAll('article')].find((card) =>
    card.getAttribute('aria-label') === `Public profile of ${handle}`,
  ) ?? null;
}

function buttonByName(target: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = [...target.querySelectorAll('button')];
  return (buttons.find((b) => b.textContent?.includes(name)) as HTMLButtonElement) ?? null;
}

function captureEvents(base: CmsgClient): { client: CmsgClient; handler: () => CmsgEventHandler | null } {
  let handler: CmsgEventHandler | null = null;
  const client: CmsgClient = {
    ...base,
    subscribe: (next) => {
      handler = next;
      return base.subscribe(next);
    },
  };
  return { client, handler: () => handler };
}

async function fill(target: HTMLElement, id: string, value: string) {
  const input = [...target.querySelectorAll('[id]')].find((element) => element.id === id) as
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
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      expect(cardByHandle(target, 'tom-cooks')).not.toBeNull();
      expect(target.querySelector('#filter-neighbourhood')).not.toBeNull();
      expect(target.querySelector('#filter-age-min')).not.toBeNull();
      expect(target.querySelector('#filter-age-max')).not.toBeNull();
      expect(target.querySelector('#filter-location-distance')).not.toBeNull();
      // Private values never leak into discovery cards.
      expect(target.textContent).not.toMatch(/Hello\./);
      // Viewing the list sends no key or wave traffic by itself.
      expect(target.textContent).not.toMatch(/Key accepted|Not a match/);
    } finally {
      await cleanup();
    }
  });

  it('narrows the list through a schema choice filter and restores it', async () => {
    const { target, cleanup } = render(await admitted());
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      await fill(target, 'filter-neighbourhood', 'East');
      await vi.waitFor(() => expect(cardByHandle(target, 'tom-cooks')).not.toBeNull());
      expect(cardByHandle(target, 'ana-walks')).toBeNull();
      await fill(target, 'filter-neighbourhood', '');
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
    } finally {
      await cleanup();
    }
  });

  it('sends number bounds and location distanceKm as typed inputs', async () => {
    const client = await admitted();
    const spy = vi.spyOn(client, 'discover');
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
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
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      expect(cardByHandle(target, 'rin-reads')).toBeNull();
    } finally {
      await cleanup();
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
      await cleanup();
    }
  });

  it('pages with the opaque cursor through Load more', async () => {
    const { target, cleanup } = render(await admitted({ pageSize: 1 }));
    try {
      await vi.waitFor(() => expect(buttonByName(target, 'Load more')).not.toBeNull());
      const before = target.textContent ?? '';
      expect(before).toMatch(/ana-walks/);
      buttonByName(target, 'Load more')?.click();
      await vi.waitFor(() => expect(cardByHandle(target, 'tom-cooks')).not.toBeNull());
      expect(cardByHandle(target, 'ana-walks')).not.toBeNull();
    } finally {
      await cleanup();
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
      await vi.waitFor(() => expect(calls).toBe(1));
      await fill(target, 'filter-neighbourhood', 'East');
      await vi.waitFor(() => expect(cardByHandle(target, 'tom-cooks')).not.toBeNull());
      expect(cardByHandle(target, 'ana-walks')).toBeNull();
      releaseFirst({ entries: [], cursor: null });
      await tick();
      await tick();
      // The stale first page must not wipe the newer filtered view.
      expect(cardByHandle(target, 'tom-cooks')).not.toBeNull();
      expect(cardByHandle(target, 'ana-walks')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('drops a stale search completion after a reset removed a departed member', async () => {
    const base = await admitted();
    const full = await base.discover([]);
    const anaOnly = full.entries.filter((e) => e.memberId === 'member-ana');
    expect(anaOnly.length).toBe(1);
    let releaseStale!: (value: MatchPage) => void;
    const staleGate = new Promise<MatchPage>((resolve) => {
      releaseStale = resolve;
    });
    const realDiscover = base.discover.bind(base);
    let calls = 0;
    const gated: CmsgClient = {
      ...base,
      discover: (discoveryFilters: DiscoveryFilter[], atCursor?: string | null): Promise<MatchPage> => {
        calls += 1;
        if (calls === 1) return staleGate;
        return realDiscover(discoveryFilters, atCursor);
      },
    };
    const { client, handler } = captureEvents(gated);
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(calls).toBe(1));
      // A reset arrives while the first search is still in flight: only ana remains.
      handler()!({ type: 'matches', page: { entries: anaOnly, cursor: null }, reset: true });
      await tick();
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      // The stale search resolves late with the departed member included.
      releaseStale(full);
      await tick();
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(cardByHandle(target, 'ana-walks')).not.toBeNull();
      expect(cardByHandle(target, 'tom-cooks')).toBeNull();
      // The interrupted page is not stuck loading: controls stay usable.
      expect(target.textContent).not.toMatch(/Loading…/);
      expect(target.querySelector('#filter-neighbourhood')).not.toBeNull();
      expect(target.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('ignores a late key response after a filter reset without resurfacing the preview', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      // The key request takes 200ms in the fixture; reset the filters at once.
      buttonByName(target, 'Want to know more')!.click();
      await fill(target, 'filter-neighbourhood', 'East');
      await vi.waitFor(() => expect(cardByHandle(target, 'tom-cooks')).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 350));
      // The stale acceptance must not resurface a preview or note afterwards.
      expect(target.textContent).not.toMatch(/Front: public profile/);
      expect(target.textContent).not.toMatch(/Key accepted/);
      expect(target.textContent).not.toMatch(/Checking…/);
      expect(cardByHandle(target, 'tom-cooks')).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('disables the card action while its key request is pending', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      buttonByName(target, 'Want to know more')!.click();
      await tick();
      expect(buttonByName(target, 'Want to know more')?.disabled).toBe(true);
      await vi.waitFor(() => expect(target.textContent).toMatch(/Key accepted/));
      expect(buttonByName(target, 'Want to know more')?.disabled).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('writes nothing and starts no further requests after unmount teardown', async () => {
    const base = await admitted();
    const exchangesSpy = vi.spyOn(base, 'profileExchanges');
    const { target, cleanup } = render(base);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      expect(exchangesSpy).toHaveBeenCalled();
      exchangesSpy.mockClear();
      // Start a key request (200ms fixture delay) and unmount before it lands.
      buttonByName(target, 'Want to know more')!.click();
      await cleanup();
      await new Promise((resolve) => setTimeout(resolve, 400));
      // The late response must not trigger the follow-up exchanges refresh.
      expect(exchangesSpy).not.toHaveBeenCalled();
    } finally {
      try {
        await cleanup();
      } catch {
        // Already unmounted above; teardown itself must stay safe.
      }
    }
  });

  it('ignores delivered events after unmount without throwing', async () => {
    const base = await admitted();
    const { client, handler } = captureEvents(base);
    const { cleanup } = render(client);
    await tick();
    await tick();
    cleanup();
    expect(() =>
      handler()!({
        type: 'key-decision',
        peer: 'member-ana',
        result: { status: 'accepted' },
      }),
    ).not.toThrow();
    await tick();
  });

  it('survives repeated identical key decisions without duplicate keys', async () => {
    const base = await admitted();
    const warnings: string[] = [];
    const errors: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    const { client, handler } = captureEvents(base);
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Private profile exchanges/));
      const rowsBefore = target.querySelectorAll('.key-list li').length;
      const decision = {
        type: 'key-decision' as const,
        peer: 'member-ana',
        result: { status: 'accepted' as const },
      };
      handler()!(decision);
      handler()!(decision);
      await tick();
      await tick();
      await vi.waitFor(() =>
        expect(target.querySelectorAll('.key-list li').length).toBe(rowsBefore),
      );
      expect(warnings.join('\n')).not.toMatch(/duplicate/i);
      expect(errors.join('\n')).not.toMatch(/duplicate/i);
    } finally {
      await cleanup();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('shows the returned profile preview on accept and only the failing field on reject', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      buttonByName(target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Key accepted/));
      expect(target.textContent).toMatch(/Front: public profile/);

      buttonByName(target, 'Refresh')!.click();
      await tick();
      await vi.waitFor(() => expect(buttonByName(target, 'Want to know more')).not.toBeNull());
      // Rules can change after discovery. The owner rechecks on the key request.
      await client.saveRules([{ field: 'age', min: 50, max: 60 }]);
      buttonByName(target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Not a match on:/));
      expect(target.textContent).toMatch(/Your matching rules stay private/);
      expect(target.textContent).not.toMatch(/raw key/i);
    } finally {
      await cleanup();
    }
  });

  it('discloses the full owner reason only for explicit incoming exchanges', async () => {
    const base = await admitted();
    const realExchanges = base.profileExchanges.bind(base);
    const incomingRejected: ProfileExchange = {
      id: 'exchange-incoming-rejected-1',
      peer: 'member-rin',
      handle: 'rin-reads',
      direction: 'incoming',
      result: {
        status: 'rejected',
        failingField: 'age',
        reason: 'Age 29 is below the minimum 50.',
      },
    };
    const withIncoming: CmsgClient = {
      ...base,
      profileExchanges: async () => [...(await realExchanges()), incomingRejected],
    };
    const { target, cleanup } = render(withIncoming);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Private profile exchanges/));
      // The incoming owner reason is shown in full.
      await vi.waitFor(() =>
        expect(target.textContent).toMatch(/Age 29 is below the minimum 50/),
      );
      // A rejected incoming request must not claim the requester profile stays
      // available for look-back: only the accepted seed exchange says so.
      expect(target.textContent?.match(/look back at them/g)?.length ?? 0).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('never renders a reason for an outgoing refusal, only the failing field', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(buttonByName(target, 'Want to know more')).not.toBeNull());
      await client.saveRules([{ field: 'age', min: 50, max: 60 }]);
      buttonByName(target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Not a match on: age/));
      expect(target.textContent).not.toMatch(/Reason:/);
    } finally {
      await cleanup();
    }
  });

  it('composes the first wave through sendWave with busy guards and the returned outcome', async () => {
    const client = await admitted();
    const spy = vi.spyOn(client, 'sendWave');
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
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
      await cleanup();
    }
  });

  it('clears departed candidates after a contacts event from blocking', async () => {
    const client = await admitted();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(cardByHandle(target, 'tom-cooks')).not.toBeNull());
      await client.blockMember('member-tom');
      await vi.waitFor(() => expect(cardByHandle(target, 'ana-walks')).not.toBeNull());
      expect(cardByHandle(target, 'tom-cooks')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('keeps error, loading and empty states distinct on injected failures', async () => {
    const failingDiscover = createDevCmsg({ failActions: ['discover'] });
    await failingDiscover.joinWithVoucher(join);
    await failingDiscover.publishProfile({ ...ownValues });
    const first = render(failingDiscover);
    try {
      await vi.waitFor(() => expect(first.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(first.target.textContent).toMatch(/Fixture failure/);
    } finally {
      await first.cleanup();
    }

    const failingKey = await admitted({ failActions: ['requestPrivateKey'] });
    const second = render(failingKey);
    try {
      await vi.waitFor(() => expect(cardByHandle(second.target, 'ana-walks')).not.toBeNull());
      buttonByName(second.target, 'Want to know more')!.click();
      await vi.waitFor(() => expect(second.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(second.target.textContent).toMatch(/Fixture failure/);
    } finally {
      await second.cleanup();
    }

    const failingWave = await admitted({ failActions: ['sendWave'] });
    const third = render(failingWave);
    try {
      await vi.waitFor(() => expect(cardByHandle(third.target, 'ana-walks')).not.toBeNull());
      buttonByName(third.target, 'Write first wave')!.click();
      await tick();
      await fill(third.target, 'wave-member-ana', 'Hello!');
      buttonByName(third.target, 'Send wave')!.click();
      await vi.waitFor(() => expect(third.target.textContent).toMatch(/Fixture failure/));
    } finally {
      await third.cleanup();
    }
  });
});
