// jsdom platform boundary (see header): minimal modal emulation so the
// native-dialog effect under test can run. Browser truth stays in the
// Playwright dialog-accessibility suite.
if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (!proto.showModal) Object.defineProperty(proto, 'showModal', {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      // Browsers move focus into the modal on showModal; jsdom needs the
      // nudge (and a tabindex to make a bare dialog focusable there).
      if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1');
      this.setAttribute('open', '');
      (this as unknown as { open: boolean }).open = true;
      this.focus();
    },
  });
  if (!proto.close) Object.defineProperty(proto, 'close', {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      (this as unknown as { open: boolean }).open = false;
      this.removeAttribute('open');
    },
  });
}

