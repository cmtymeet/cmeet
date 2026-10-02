<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, Wave, WaveSlots } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, EmptyState, WaveCard } from '../../../../ui/src/index.js';
  import { wavesStrings as s } from '../strings/waves.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let waves: Wave[] = $state([]);
  let slots: WaveSlots | null = $state(null);
  let answers: Record<string, string> = $state({});
  let busy = $state(false);
  let error = $state('');
  let loaded = $state(false);
  let generation = 0;
  let alive = true;

  async function load() {
    const request = ++generation;
    try {
      const [nextWaves, nextSlots] = await Promise.all([client.incomingWaves(), client.waveSlots()]);
      if (!alive || request !== generation) return;
      waves = nextWaves; slots = nextSlots; loaded = true; error = '';
    } catch (e) { if (alive && request === generation) error = e instanceof Error ? e.message : s.failed; }
  }

  onMount(() => {
    void load();
    const stop = client.subscribe((event) => {
      if (!alive) return;
      if (event.type === 'wave-incoming' || event.type === 'wave-updated') void load();
    });
    return () => { alive = false; ++generation; stop(); };
  });

  async function act(id: string, kind: 'answer' | 'close') {
    if (busy) return;
    if (!alive) return;
    error = '';
    busy = true;
    try {
      if (kind === 'answer') {
        const message = (answers[id] ?? '').trim();
        if (!message) {
          if (alive) error = s.replyRequired;
          return;
        }
        await client.answerWave(id, message);
      } else {
        await client.closeWave(id);
      }
      if (!alive) return;
      answers = { ...answers, [id]: '' };
      await load();
    } catch (e) {
      if (alive) error = e instanceof Error ? e.message : s.failed;
    } finally {
      if (alive) busy = false;
    }
  }
</script>

<section class="page" aria-labelledby="waves-title">
  <h1 id="waves-title">{s.title}</h1>
  <p class="muted">{s.lead}</p>
  {#if slots}<p class="muted">{s.slots(slots.introductionsAvailable, slots.incomingAvailable)}</p>{/if}
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if !loaded && !error}<p role="status">{s.loading}</p>{/if}
  {#if loaded && waves.filter((w) => w.state === 'pending').length === 0}
    <EmptyState title={s.empty} hint={s.emptyHint} />
  {/if}
  <div class="grid">
    {#each waves as wave (wave.id)}
      <div>
        <WaveCard
          {wave}
          answerLabel={s.answer}
          closeLabel={s.close}
          disabled={busy}
          onanswer={(id) => void act(id, 'answer')}
          onclose={(id) => void act(id, 'close')}
        />
        {#if wave.state === 'pending' && wave.releaseState === 'released'}
          <fieldset class="reply-field" disabled={busy}>
            <TextField
              id="answer-{wave.id}"
              label={s.reply}
              value={answers[wave.id] ?? ''}
              multiline
              oninput={(v) => (answers = { ...answers, [wave.id]: v })}
            />
          </fieldset>
        {/if}
      </div>
    {/each}
  </div>
  <div class="row"><Button {busy} onclick={() => void load()} disabled={busy}>{s.check}</Button></div>
</section>

<style>
  .reply-field { border: 0; padding: 0; margin: 0; min-width: 0; }
</style>
