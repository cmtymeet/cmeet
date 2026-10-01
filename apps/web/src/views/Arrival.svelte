<script lang="ts">
  import { tick } from 'svelte';
  import type { CmsgClient } from '../../../../core/src/cmsg.js';
  import { Button, TextField, Notice } from '../../../../ui/src/index.js';
  import { community } from '../community.js';
  import { arrivalStrings as t } from '../strings/arrival.js';

  interface Props {
    session: CmsgClient;
    onjoined?: () => void;
  }
  let { session, onjoined }: Props = $props();

  // The landing shows one combined action first; the two paths
  // (returning passkey sign-in, voucher registration) appear after it.
  let started = $state(false);
  let voucher = $state('');
  let handle = $state('');
  let busy = $state(false);
  let error = $state('');
  let voucherError = $state('');
  let handleError = $state('');
  let errorRef: HTMLElement | null = $state(null);

  function focusError() {
    // Let Svelte render the alert first, then move focus for screen readers.
    void tick().then(() => errorRef?.focus());
  }

  function start() {
    started = true;
    error = '';
  }

  async function join() {
    if (busy) return;
    error = '';
    voucherError = '';
    handleError = '';
    if (voucher.trim() === '') voucherError = t.emptyVoucher;
    if (handle.trim() === '') handleError = t.emptyHandle;
    if (voucherError || handleError) {
      error = [voucherError, handleError].filter(Boolean).join(' ');
      focusError();
      return;
    }
    busy = true;
    try {
      await session.joinWithVoucher({ voucher: voucher.trim(), handle: handle.trim() });
      onjoined?.();
    } catch (e) {
      error = e instanceof Error && e.message ? e.message : t.joinFailed;
      focusError();
    } finally {
      busy = false;
    }
  }

  async function signIn() {
    if (busy) return;
    error = '';
    busy = true;
    try {
      // Kept directly behind the user gesture so the passkey prompt can open.
      await session.signIn();
      onjoined?.();
    } catch (e) {
      error = e instanceof Error && e.message ? e.message : t.signInFailed;
      focusError();
    } finally {
      busy = false;
    }
  }
</script>

<section class="page arrival" aria-labelledby="arrival-title">
  <p class="muted">{community.displayName}</p>
  <h1 id="arrival-title">{t.tagline}</h1>

  {#if !started}
    <h2>{t.startTitle}</h2>
    <p>{t.startLead}</p>
    <Button variant="primary" onclick={start}>{t.startAction}</Button>
  {:else}
    <h2>{t.optionsTitle}</h2>

    <div class="arrival-options">
      <section aria-labelledby="arrival-returning">
        <h3 id="arrival-returning">{t.returningTitle}</h3>
        <p>{t.returningLead}</p>
        <Button variant="primary" {busy} busyLabel={t.signInBusy} onclick={() => void signIn()}>
          {t.signInButton}
        </Button>
      </section>

      <section aria-labelledby="arrival-register">
        <h3 id="arrival-register">{t.registerTitle}</h3>
        <p>{t.registerLead}</p>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <TextField
            id="voucher"
            label={t.voucherLabel}
            value={voucher}
            placeholder="VOUCHER-…"
            error={voucherError}
            oninput={(v) => {
              voucher = v;
              if (v.trim() !== '') voucherError = '';
            }}
          />
          <TextField
            id="handle"
            label={t.handleLabel}
            value={handle}
            maxlength={32}
            error={handleError}
            oninput={(v) => {
              handle = v;
              if (v.trim() !== '') handleError = '';
            }}
          />
          <Button type="submit" variant="primary" {busy} busyLabel={t.continueBusy}>
            {t.continueAction}
          </Button>
        </form>
      </section>
    </div>
  {/if}

  {#if error}
    <div bind:this={errorRef} tabindex="-1" class="arrival-error">
      <Notice tone="error">{error}</Notice>
    </div>
  {/if}
</section>

<style>
  .arrival {
    min-width: 0;
  }
  .arrival-options {
    display: grid;
    gap: 1.25rem;
    margin-top: 0.75rem;
  }
  .arrival-options section {
    min-width: 0;
  }
  .arrival-error {
    outline: none;
  }
  .arrival-error:focus {
    outline: 3px solid var(--cmeet-focus);
    outline-offset: 2px;
    border-radius: var(--cmeet-radius);
  }
  @media (min-width: 40rem) {
    .arrival-options {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
