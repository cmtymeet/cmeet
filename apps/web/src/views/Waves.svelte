<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, Wave, WaveSlots } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, EmptyState, WaveCard, Dialog } from '../../../../ui/src/index.js';
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
  let punishId = $state('');
  let generation = 0;
  let alive = true;

  async function load() {
    const request = ++generation;
    try {
      const [nextWaves, nextSlots] = await Promise.all([client.incomingWaves(), client.waveSlots()]);
      if (!alive || request !== generation) return;
      waves = nextWaves; slots = nextSlots; loaded = true;
    } catch (e) { if (alive && request === generation) error = e instanceof Error ? e.message : s.failed; }
  }

  onMount(() => {
    void load();
    const stop = client.subscribe((event) => {
      if (event.type === 'wave-incoming' || event.type === 'wave-updated') void load();
    });
    return () => { alive = false; ++generation; stop(); };
  });

  async function act(id: string, kind: 'answer' | 'close' | 'punish') {
    if (busy) return;
    error = '';
    busy = true;
    try {
      if (kind === 'answer') {
        const message = (answers[id] ?? '').trim();
        if (!message) {
          error = s.replyRequired;
          return;
        }
        await client.answerWave(id, message);
      } else if (kind === 'close') {
        await client.closeWave(id);
      } else {
        await client.punishWave(id);
      }
      if (alive) { punishId = ''; answers = { ...answers, [id]: '' }; }
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : s.failed;
    } finally {
      busy = false;
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
          punishLabel={s.punish}
          punishNote={s.punishNote}
          disabled={busy}
          onanswer={(id) => void act(id, 'answer')}
          onclose={(id) => void act(id, 'close')}
          onpunish={(id) => punishId = id}
        />
        {#if wave.state === 'pending' && wave.releaseState === 'released'}
          <TextField
            id="answer-{wave.id}"
            label={s.reply}
            value={answers[wave.id] ?? ''}
            multiline
            oninput={(v) => (answers = { ...answers, [wave.id]: v })}
          />
        {/if}
      </div>
    {/each}
  </div>
  <div class="row"><Button onclick={() => void load()} disabled={busy}>{s.check}</Button></div>
  {#if punishId}
    <Dialog open labelledBy="punish-title" onclose={() => { if (!busy) punishId = ''; }}>
      <h2 id="punish-title">{s.punishTitle}</h2><p>{s.punishNote}</p>
      {#if error}<Notice tone="error">{error}</Notice>{/if}
      <div class="row"><Button disabled={busy} onclick={() => punishId = ''}>{s.cancel}</Button>
      <Button variant="danger" {busy} onclick={() => void act(punishId, 'punish')}>{s.confirm}</Button></div>
    </Dialog>
  {/if}
</section>
