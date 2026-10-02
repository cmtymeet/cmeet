<script lang="ts">
  import { memberName } from '../../../../ui/src/member-name.js';
  import { onMount } from 'svelte';
  import type {
    CmsgClient,
    CmsgEvent,
    DiscoveryFilter,
    KeyRequestResult,
    MatchPage,
    ProfileExchange,
    ProfileSchema,
    PublicCard,
  } from '../../../../core/src/cmsg.js';
  import {
    Button,
    TextField,
    Notice,
    EmptyState,
    PublicCard as Card,
    ProfilePreview,
  } from '../../../../ui/src/index.js';
  import { forumStrings as s } from '../strings/forum.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let schema: ProfileSchema | null = $state(null);
  let filters: DiscoveryFilter[] = $state([]);
  let entries: PublicCard[] = $state([]);
  let cursor: string | null = $state(null);
  let exchanges: ProfileExchange[] = $state([]);

  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state('');
  let exchangeNote = $state('');
  let waveNote = $state('');
  let keyBusy: Record<string, boolean> = $state({});
  let keyResults: Record<string, KeyRequestResult> = $state({});
  let selectedPeer: string | null = $state(null);
  let waveDrafts: Record<string, string> = $state({});
  let waveBusy: Record<string, boolean> = $state({});

  let errorRef: HTMLDivElement | null = $state(null);

  // Presentation request generation: stale async filter results are ignored.
  // Reset/delta events invalidate outstanding searches so older responses
  // cannot resurrect departed members.
  let requestGen = 0;
  let exchangeGen = 0;
  let alive = true;

  $effect(() => {
    if (error && errorRef) errorRef.focus();
  });

  function filterFor(field: string): DiscoveryFilter | undefined {
    return filters.find((f) => f.field === field);
  }

  function setFilter(field: string, patch: Partial<DiscoveryFilter> | null) {
    const rest = filters.filter((f) => f.field !== field);
    filters = patch ? [...rest, { field, ...patch }] : rest;
    void search(true);
  }

  function setChoice(field: string, raw: string) {
    setFilter(field, raw ? { equals: [raw] } : null);
  }

  function setNumberBound(field: string, bound: 'min' | 'max', raw: string) {
    const current = filterFor(field);
    const parsed = raw === '' ? undefined : Number(raw);
    const next: Partial<DiscoveryFilter> = {
      equals: current?.equals,
      min: bound === 'min' ? parsed : current?.min,
      max: bound === 'max' ? parsed : current?.max,
      maxDistanceKm: current?.maxDistanceKm,
    };
    const empty =
      (next.equals === undefined || next.equals.length === 0) &&
      next.min === undefined &&
      next.max === undefined &&
      next.maxDistanceKm === undefined;
    setFilter(field, empty ? null : next);
  }

  function setYesNo(field: string, raw: string) {
    if (raw === '') setFilter(field, null);
    else if (raw === s.yes) setFilter(field, { equals: [true] });
    else setFilter(field, { equals: [false] });
  }

  function yesNoValue(field: string): string {
    const current = filterFor(field)?.equals?.[0];
    if (current === true) return s.yes;
    if (current === false) return s.no;
    return '';
  }

  function setDistance(field: string, raw: string) {
    const current = filterFor(field);
    const parsed = raw === '' ? undefined : Number(raw);
    const next: Partial<DiscoveryFilter> = {
      equals: current?.equals,
      min: current?.min,
      max: current?.max,
      maxDistanceKm: parsed,
    };
    const empty =
      (next.equals === undefined || next.equals.length === 0) &&
      next.min === undefined &&
      next.max === undefined &&
      next.maxDistanceKm === undefined;
    setFilter(field, empty ? null : next);
  }

  function distanceValue(field: string): string | number {
    return filterFor(field)?.maxDistanceKm ?? '';
  }

  function dedupeAppend(current: PublicCard[], incoming: PublicCard[]): PublicCard[] {
    const seen = new Set(current.map((e) => e.memberId));
    const merged = [...current];
    for (const entry of incoming) {
      if (!seen.has(entry.memberId)) {
        seen.add(entry.memberId);
        merged.push(entry);
      }
    }
    return merged;
  }

  /** Clear per-peer result actions that a replacement search would leave stale. */
  function clearStaleResults() {
    keyResults = {};
    selectedPeer = null;
    exchangeNote = '';
    waveNote = '';
  }

  async function search(reset: boolean) {
    const gen = ++requestGen;
    error = '';
    if (reset) {
      clearStaleResults();
      entries = [];
      cursor = null;
      loading = true;
    } else {
      loadingMore = true;
    }
    if (!schema) {
      try {
        const nextSchema = await client.schema();
        if (!alive || gen !== requestGen) return;
        schema = nextSchema;
      } catch (e) {
        if (!alive || gen !== requestGen) return;
        error = e instanceof Error ? e.message : s.discoveryFailed;
        loading = false;
        loadingMore = false;
        return;
      }
    }
    const snapshot = $state.snapshot(filters) as DiscoveryFilter[];
    const at = reset ? null : cursor;
    try {
      const page = await client.discover(snapshot, at);
      if (!alive || gen !== requestGen) return;
      if (reset) {
        entries = page.entries;
      } else {
        entries = dedupeAppend(entries, page.entries);
      }
      cursor = page.cursor;
    } catch (e) {
      if (!alive || gen !== requestGen) return;
      error = e instanceof Error ? e.message : s.discoveryFailed;
    } finally {
      if (!alive || gen !== requestGen) return;
      loading = false;
      loadingMore = false;
    }
  }

  function applyDelta(page: MatchPage) {
    const byId = new Map(entries.map((e) => [e.memberId, e]));
    for (const entry of page.entries) byId.set(entry.memberId, entry);
    entries = [...byId.values()];
    cursor = page.cursor;
  }

  async function reloadExchanges() {
    const gen = ++exchangeGen;
    try {
      const next = await client.profileExchanges();
      if (!alive || gen !== exchangeGen) return;
      exchanges = next;
    } catch {
      // Exchanges stay as they are; discovery errors are reported separately.
    }
  }

  function onEvent(event: CmsgEvent) {
    if (!alive) return;
    if (event.type === 'matches') {
      // Invalidate outstanding searches first: an older page resolving later
      // must not resurrect members this reset/delta already removed.
      requestGen += 1;
      // The event carries a fresh view, so no page is stuck loading.
      loading = false;
      loadingMore = false;
      error = '';
      if (event.reset) {
        clearStaleResults();
        entries = event.page.entries;
        cursor = event.page.cursor;
      } else {
        applyDelta(event.page);
      }
      return;
    }
    if (event.type === 'contacts') {
      // A block or relation change removes the peer before the forum update
      // arrives: re-run the current query so departed candidates clear.
      void search(true);
      return;
    }
    if (event.type === 'key-decision') {
      // key-decision carries no direction: never infer owner-side disclosure
      // from reason presence. Refresh exchanges; only an explicit incoming
      // exchange direction may display the full owner reason.
      void reloadExchanges();
    }
  }

  async function requestKey(memberId: string) {
    if (keyBusy[memberId]) return;
    const gen = requestGen;
    keyBusy = { ...keyBusy, [memberId]: true };
    exchangeNote = '';
    error = '';
    try {
      const result = await client.requestPrivateKey(memberId);
      if (!alive || gen !== requestGen) return;
      keyResults = { ...keyResults, [memberId]: result };
      await reloadExchanges();
      if (!alive || gen !== requestGen) return;
      if (result.status === 'accepted') {
        exchangeNote = s.keyAccepted;
      } else {
        exchangeNote = `${s.keyRejectedPrefix} ${result.failingField ?? s.failingFieldLabel}. ${s.keyRejectedSuffix}`;
      }
    } catch (e) {
      if (!alive || gen !== requestGen) return;
      error = e instanceof Error ? e.message : s.keyFailed;
    } finally {
      keyBusy = { ...keyBusy, [memberId]: false };
    }
  }

  function toggleComposer(memberId: string) {
    selectedPeer = selectedPeer === memberId ? null : memberId;
    waveNote = '';
  }

  async function sendFirstWave(memberId: string) {
    if (waveBusy[memberId]) return;
    const message = (waveDrafts[memberId] ?? '').trim();
    if (!message) {
      waveNote = s.waveEmpty;
      return;
    }
    const gen = requestGen;
    waveBusy = { ...waveBusy, [memberId]: true };
    waveNote = '';
    error = '';
    try {
      const wave = await client.sendWave(memberId, message);
      if (!alive || gen !== requestGen) return;
      waveDrafts = { ...waveDrafts, [memberId]: '' };
      waveNote = `${s.waveSentPrefix} ${wave.state}. ${wave.reason ?? ''}`.trim();
    } catch (e) {
      if (!alive || gen !== requestGen) return;
      waveNote = e instanceof Error ? e.message : s.waveFailed;
    } finally {
      waveBusy = { ...waveBusy, [memberId]: false };
    }
  }

  onMount(() => {
    alive = true;
    const detach = client.subscribe(onEvent);
    void (async () => {
      try {
        const nextSchema = await client.schema();
        if (!alive) return;
        schema = nextSchema;
        await reloadExchanges();
        if (!alive) return;
        await search(true);
      } catch (e) {
        if (!alive) return;
        error = e instanceof Error ? e.message : s.discoveryFailed;
        loading = false;
      }
    })();
    return () => {
      alive = false;
      detach();
    };
  });
</script>

<section class="page" aria-labelledby="forum-title">
  <div class="row">
    <div>
      <h1 id="forum-title">{s.title}</h1>
      <p class="muted">{s.lead}</p>
    </div>
    <Button busy={loading && entries.length === 0} busyLabel={s.searching} onclick={() => void search(true)}>
      {s.refresh}
    </Button>
  </div>

  {#if error}
    <div bind:this={errorRef} tabindex="-1">
      <Notice tone="error">{error}</Notice>
    </div>
  {/if}
  {#if exchangeNote}<Notice tone="info">{exchangeNote}</Notice>{/if}
  {#if waveNote}<Notice tone="info">{waveNote}</Notice>{/if}

  {#if schema}
    <form aria-label={s.filters} onsubmit={(e) => { e.preventDefault(); void search(true); }}>
      <div class="field-row">
        {#each schema.fields.filter((f) => f.filterable) as field (field.key)}
          {#if field.kind === 'choice'}
            <TextField
              id="filter-{field.key}"
              label={field.question}
              value={String(filterFor(field.key)?.equals?.[0] ?? '')}
              choices={field.choices}
              oninput={(v) => setChoice(field.key, v)}
            />
          {:else if field.kind === 'number'}
            <TextField
              id="filter-{field.key}-min"
              label={`${field.question} ${s.numberFrom}`}
              type="number"
              value={filterFor(field.key)?.min ?? ''}
              min={field.min}
              max={field.max}
              oninput={(v) => setNumberBound(field.key, 'min', v)}
            />
            <TextField
              id="filter-{field.key}-max"
              label={`${field.question} ${s.numberTo}`}
              type="number"
              value={filterFor(field.key)?.max ?? ''}
              min={field.min}
              max={field.max}
              oninput={(v) => setNumberBound(field.key, 'max', v)}
            />
          {:else if field.kind === 'yes-no'}
            <TextField
              id="filter-{field.key}"
              label={field.question}
              value={yesNoValue(field.key)}
              choices={[s.yes, s.no]}
              oninput={(v) => setYesNo(field.key, v)}
            />
          {:else if field.kind === 'location'}
            <TextField
              id="filter-{field.key}-distance"
              label={`${field.question} ${s.distanceWithinKm}`}
              type="number"
              value={distanceValue(field.key)}
              min={0}
              oninput={(v) => setDistance(field.key, v)}
            />
          {/if}
        {/each}
      </div>
    </form>
  {/if}

  {#if loading && entries.length === 0}
    <p aria-live="polite">{s.loading}</p>
  {:else if entries.length === 0 && !error}
    <EmptyState title={s.empty} hint={s.emptyHint} />
  {:else}
    <div class="grid">
      {#each entries as entry (entry.memberId)}
        <div>
          <Card
            card={entry}
            actionLabel={s.wantToKnowMore}
            disabled={!!keyBusy[entry.memberId]}
            onaction={(id) => void requestKey(id)}
          />
          {#if keyBusy[entry.memberId]}
            <p aria-live="polite">{s.checkingKey}</p>
          {/if}
          {#if keyResults[entry.memberId]}
            {@const result = keyResults[entry.memberId]!}
            {#if result.status === 'accepted' && result.profile}
              <p class="muted">{s.lookBackNote}</p>
              <ProfilePreview
                handle={entry.handle}
                schema={result.profile.schema}
                values={result.profile.values}
                frontLabel={s.previewFront}
                backLabel={s.previewBack}
              />
            {:else if result.status === 'rejected'}
              <p class="muted">{s.keyRejectedPrefix} {result.failingField ?? s.failingFieldLabel}. {s.keyRejectedSuffix}</p>
            {/if}
          {/if}
          <div class="row">
            <Button onclick={() => toggleComposer(entry.memberId)}>{s.writeWave}</Button>
          </div>
          {#if selectedPeer === entry.memberId}
            <TextField
              id="wave-{entry.memberId}"
              label={s.waveLabel}
              value={waveDrafts[entry.memberId] ?? ''}
              multiline
              oninput={(v) => (waveDrafts = { ...waveDrafts, [entry.memberId]: v })}
            />
            <div class="row">
              <Button
                variant="primary"
                busy={!!waveBusy[entry.memberId]}
                busyLabel={s.waveSending}
                onclick={() => void sendFirstWave(entry.memberId)}
              >
                {s.waveSend}
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if cursor}
      <div class="row">
        <Button
          busy={loadingMore}
          busyLabel={s.loadingMore}
          disabled={loading || loadingMore}
          onclick={() => void search(false)}
        >
          {s.loadMore}
        </Button>
      </div>
    {/if}
  {/if}

  {#if exchanges.length > 0}
    <h2>{s.exchangesTitle}</h2>
    <p class="muted">{s.exchangesHint}</p>
    <ul class="key-list">
      {#each exchanges as exchange (exchange.id)}
        <li>
          <div>
            <strong>{memberName(exchange.handle, exchange.displayName)}</strong>
            <span class="muted">
              {exchange.direction === 'incoming' ? s.incomingLabel : s.outgoingLabel}
              · {exchange.result.status === 'accepted' ? s.acceptedLabel : s.rejectedLabel}
            </span>
            {#if exchange.direction === 'incoming' && exchange.result.reason}
              <p>{s.reasonLabel}: {exchange.result.reason}</p>
              {#if exchange.result.status === 'accepted'}
                <p class="muted">{s.lookBackIncomingNote}</p>
              {/if}
            {:else if exchange.direction === 'incoming' && exchange.result.status === 'accepted'}
              <p class="muted">{s.lookBackIncomingNote}</p>
            {:else if exchange.result.status === 'rejected'}
              <p class="muted">{s.keyRejectedPrefix} {exchange.result.failingField ?? s.failingFieldLabel}.</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
