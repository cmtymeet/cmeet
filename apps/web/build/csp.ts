// Content-Security-Policy for the shell. The member page may frame exactly one
// origin: its own vault frame. Production takes that origin from the build
// environment (CMEET_VAULT_ORIGIN, an exact https origin); without it no frame
// is allowed at all. Development additionally allows vault.*.localhost for the
// opt-in multi-origin harness. No other third party is ever permitted.

import type { Plugin } from 'vite';

const BASE = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'";

export function frameSource(vaultOrigin: string | undefined, development: boolean): string {
  if (development) return "frame-src 'self' http://*.localhost:*";
  if (vaultOrigin === undefined || vaultOrigin === '') return "frame-src 'none'";
  const url = new URL(vaultOrigin);
  if (url.protocol !== 'https:' || url.origin !== vaultOrigin) {
    throw new Error('CMEET_VAULT_ORIGIN must be an exact https origin.');
  }
  return `frame-src ${url.origin}`;
}

export function cspPlugin(vaultOrigin: string | undefined): Plugin {
  let development = false;
  return {
    name: 'cmeet-csp',
    configResolved(config) {
      development = config.command === 'serve';
    },
    transformIndexHtml(html) {
      const policy = `${BASE}; ${frameSource(vaultOrigin, development)}`;
      const pattern = /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/;
      if (!pattern.test(html)) throw new Error('The CSP meta tag is missing from index.html.');
      return html.replace(pattern, `$1${policy}$2`);
    },
  };
}
