import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { TextField } from '../../../../ui/src/index.js';
import TextFieldHarness from '../fixtures/TextFieldHarness.svelte';

describe('TextField native semantics', () => {
  it('marks a plain input as natively required and keeps label association', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(TextField, {
      target,
      props: { id: 'tf-name', label: 'Name', value: '', required: true },
    });
    try {
      await tick();
      const input = target.querySelector('input');
      expect(input).not.toBeNull();
      expect(input?.required).toBe(true);
      expect(input?.hasAttribute('required')).toBe(true);
      expect(input?.validity.valueMissing).toBe(true);
      expect(input?.getAttribute('id')).toBe('tf-name');
      expect(target.querySelector('label')?.getAttribute('for')).toBe('tf-name');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('marks a select as natively required and reports the chosen string', async () => {
    const oninput = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(TextField, {
      target,
      props: { id: 'tf-color', label: 'Color', value: '', choices: ['red', 'blue'], required: true, oninput },
    });
    try {
      await tick();
      const select = target.querySelector('select');
      expect(select).not.toBeNull();
      expect(select?.required).toBe(true);
      expect(select?.hasAttribute('required')).toBe(true);
      expect(select?.validity.valueMissing).toBe(true);
      select!.value = 'blue';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('blue');
      expect(typeof oninput.mock.calls[0][0]).toBe('string');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('marks a textarea as natively required', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(TextField, {
      target,
      props: { id: 'tf-bio', label: 'Bio', value: '', multiline: true, required: true },
    });
    try {
      await tick();
      const area = target.querySelector('textarea');
      expect(area).not.toBeNull();
      expect(area?.required).toBe(true);
      expect(area?.hasAttribute('required')).toBe(true);
      expect(area?.validity.valueMissing).toBe(true);
      expect(target.querySelector('label')?.getAttribute('for')).toBe('tf-bio');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('combines help and error in aria-describedby with stable ids', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(TextField, {
      target,
      props: { id: 'tf-handle', label: 'Handle', value: '', help: 'Use 3+ characters.', error: 'Handle is required.' },
    });
    try {
      await tick();
      const control = target.querySelector('input');
      expect(control?.getAttribute('aria-describedby')).toBe('tf-handle-help tf-handle-error');
      expect(control?.getAttribute('aria-invalid')).toBe('true');
      expect(target.querySelector('#tf-handle-help')?.textContent).toBe('Use 3+ characters.');
      const err = target.querySelector('#tf-handle-error');
      expect(err?.textContent).toBe('Handle is required.');
      expect(err?.getAttribute('role')).toBe('alert');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('renders the value and reports string input', async () => {
    const oninput = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(TextField, {
      target,
      props: { id: 'tf-nick', label: 'Nickname', value: 'Ada', oninput },
    });
    try {
      await tick();
      const input = target.querySelector('input');
      expect(input?.value).toBe('Ada');
      input!.value = 'Grace';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('Grace');
      expect(typeof oninput.mock.calls[0][0]).toBe('string');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('clears error reactively on the same control when harness state changes', async () => {
    const cases = [
      { id: 'tf-r-input', selector: 'input', props: {} },
      { id: 'tf-r-select', selector: 'select', props: { choices: ['red', 'blue'] } },
      { id: 'tf-r-area', selector: 'textarea', props: { multiline: true } },
    ];
    for (const c of cases) {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const component = mount(TextFieldHarness, {
        target,
        props: { id: c.id, label: 'Login', ...c.props },
      });
      try {
        await tick();
        const before = target.querySelector(c.selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
        expect(before).not.toBeNull();
        expect(before!.required).toBe(true);
        expect(before!.validity.valueMissing).toBe(true);
        expect(before!.getAttribute('aria-describedby')).toBe(`${c.id}-help ${c.id}-error`);
        expect(before!.getAttribute('aria-invalid')).toBe('true');
        expect(target.querySelector(`#${c.id}-error`)).not.toBeNull();
        (target.querySelector('[data-testid="clear-error"]') as HTMLElement).click();
        await tick();
        const after = target.querySelector(c.selector);
        expect(after).toBe(before);
        expect(after?.getAttribute('aria-describedby')).toBe(`${c.id}-help`);
        expect(after?.getAttribute('aria-invalid')).toBeNull();
        expect(target.querySelector(`#${c.id}-error`)).toBeNull();
        expect(target.querySelector('[role="alert"]')).toBeNull();
        expect(target.querySelector(`#${c.id}-help`)).not.toBeNull();
      } finally {
        unmount(component);
        target.remove();
      }
    }
  });
});
