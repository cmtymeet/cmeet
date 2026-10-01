<script lang="ts">
  import { onMount } from 'svelte';
  import type { CmsgClient, Wave, WaveSlots } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, EmptyState, WaveCard } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';

  interface Props {
    client: CmsgClient;
  }
  let { client }: Props = $props();

  let waves: Wave[] = $state([]);
  let slots: WaveSlots | null = $state(null);
  let answers: Record<string, string> = $state({});
  let busy = $state(false);
  let error = $state('');

  async function load() {
    try {
      waves = await client.incomingWaves();
      slots = await client.waveSlots();
    } catch (e) {
      error = e instanceof Error ? e.message : 'First contact is unavailable right now.';
    }
  }

  onMount(() => {
    void load();
    return client.subscribe((event) => {
      if (event.type === 'wave-incoming' || event.type === 'wave-updated') void load();
    });
  });

  async function act(id: string, kind: 'answer' | 'close' | 'punish') {
    error = '';
    busy = true;
    try {
      if (kind === 'answer') {
        const message = (answers[id] ?? '').trim();
        if (!message) {
          error = 'Write a reply before answering.';
          return;
        }
        await client.answerWave(id, message);
      } else if (kind === 'close') {
        await client.closeWave(id);
      } else {
        await client.punishWave(id);
      }
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not work. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="page" aria-labelledby="waves-title">
  <h1 id="waves-title">{en.waves.title}</h1>
  <p class="muted">Introductions are live: both members are online. Answering returns both slots at once.</p>
  {#if slots}<p class="muted">Introductions available: {slots.introductionsAvailable}. Incoming slots: {slots.incomingAvailable}.</p>{/if}
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if waves.filter((w) => w.state === 'pending').length === 0}
    <EmptyState title="No waves waiting" hint="New introductions appear here while you are online." />
  {/if}
  <div class="grid">
    {#each waves as wave (wave.id)}
      <div>
        <WaveCard
          {wave}
          answerLabel={en.waves.answer}
          closeLabel={en.waves.close}
          punishLabel={en.waves.punish}
          punishNote={en.waves.punishNote}
          disabled={busy}
          onanswer={(id) => void act(id, 'answer')}
          onclose={(id) => void act(id, 'close')}
          onpunish={(id) => void act(id, 'punish')}
        />
        {#if wave.state === 'pending'}
          <TextField
            id="answer-{wave.id}"
            label="Your reply"
            value={answers[wave.id] ?? ''}
            multiline
            oninput={(v) => (answers = { ...answers, [wave.id]: v })}
          />
        {/if}
      </div>
    {/each}
  </div>
  <div class="row"><Button onclick={() => void load()}>Check again</Button></div>
</section>
