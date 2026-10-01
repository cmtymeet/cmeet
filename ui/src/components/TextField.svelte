<script lang="ts">
  interface Props {
    id: string;
    label: string;
    value: string | number;
    type?: 'text' | 'number';
    help?: string;
    error?: string;
    choices?: string[];
    multiline?: boolean;
    required?: boolean;
    min?: number;
    max?: number;
    maxlength?: number;
    placeholder?: string;
    oninput?: (value: string) => void;
  }
  let {
    id, label, value, type = 'text', help = '', error = '', choices,
    multiline = false, required = false, min, max, maxlength, placeholder = '', oninput,
  }: Props = $props();

  function handle(event: Event) {
    oninput?.((event.currentTarget as HTMLInputElement).value);
  }
</script>

<div class="field">
  <label for={id}>{label}{#if required} <span aria-hidden="true">*</span>{/if}</label>
  {#if choices}
    <select {id} value={String(value ?? '')} onchange={handle} aria-describedby={help ? `${id}-help` : undefined} aria-invalid={error ? 'true' : undefined}>
      <option value="">Choose…</option>
      {#each choices as choice}<option value={choice}>{choice}</option>{/each}
    </select>
  {:else if multiline}
    <textarea {id} value={String(value ?? '')} oninput={handle} rows="3" {maxlength} {placeholder}
      aria-describedby={help ? `${id}-help` : undefined} aria-invalid={error ? 'true' : undefined}></textarea>
  {:else}
    <input {id} {type} value={value ?? ''} oninput={handle} {min} {max} {maxlength} {placeholder}
      aria-describedby={help ? `${id}-help` : undefined} aria-invalid={error ? 'true' : undefined} />
  {/if}
  {#if help}<p id="{id}-help" class="help">{help}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .field { display: grid; gap: 0.35rem; margin-block: 0.6rem; }
  label { font-weight: 600; }
  input, select, textarea {
    font: inherit; color: var(--cmeet-ink); background: var(--cmeet-surface);
    border: 1px solid var(--cmeet-line); border-radius: var(--cmeet-radius);
    padding: 0.55rem 0.7rem; max-width: 28rem; width: 100%;
  }
  input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 3px solid var(--cmeet-focus); outline-offset: 2px;
  }
  .help { color: var(--cmeet-muted); font-size: 0.9rem; margin: 0; }
  .error { color: var(--cmeet-danger); font-size: 0.9rem; margin: 0; }
</style>
