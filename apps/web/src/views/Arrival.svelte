<script lang="ts">
  import type { CmsgClient } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice, SegmentedControl } from '../../../../ui/src/index.js';
  import { en } from '../../../../ui/src/i18n/en.js';
  import { community } from '../community.js';

  interface Props {
    session: CmsgClient;
    onjoined?: () => void;
  }
  let { session, onjoined }: Props = $props();

  let mode: 'join' | 'signin' = $state('join');
  let voucher = $state('');
  let handle = $state('');
  let busy = $state(false);
  let error = $state('');

  async function join() {
    error = '';
    busy = true;
    try {
      await session.joinWithVoucher({ voucher, handle });
      onjoined?.();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Joining did not work. Try again.';
    } finally {
      busy = false;
    }
  }

  async function signIn() {
    error = '';
    busy = true;
    try {
      // Kept directly behind the user gesture so the passkey prompt can open.
      await session.signIn();
      onjoined?.();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Sign in did not work. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="page" aria-labelledby="arrival-title">
  <p class="muted">{community.displayName}</p>
  <h1 id="arrival-title">{en.app.tagline}</h1>

  <SegmentedControl
    label="Sign in or join"
    current={mode}
    options={[
      { value: 'join', label: en.arrival.join },
      { value: 'signin', label: en.arrival.signIn },
    ]}
    onselect={(value) => (mode = value)}
  />

  {#if mode === 'join'}
    <h2>{en.arrival.joinTitle}</h2>
    <p>{en.arrival.joinLead}</p>
    <form onsubmit={(e) => { e.preventDefault(); void join(); }}>
      <TextField id="voucher" label={en.arrival.voucherLabel} value={voucher} placeholder="VOUCHER-…" oninput={(v) => (voucher = v)} />
      <TextField id="handle" label={en.arrival.handleLabel} value={handle} maxlength={32} oninput={(v) => (handle = v)} />
      <Button type="submit" variant="primary" {busy} busyLabel="Checking voucher…">{en.arrival.continue}</Button>
    </form>
  {:else}
    <h2>{en.arrival.signInTitle}</h2>
    <p>{en.arrival.signInLead}</p>
    <Button variant="primary" {busy} busyLabel="Waiting for passkey…" onclick={() => void signIn()}>{en.arrival.signInButton}</Button>
  {/if}

  {#if error}<Notice tone="error">{error}</Notice>{/if}
</section>
