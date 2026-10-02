import type { CliLoginPort } from '../../../../core/src/cli-login.js';
import { isCliLoginHash } from '../../../../core/src/cli-login.js';

export { isCliLoginHash };

/**
 * Takes the launch fragment out of the address bar. The fragment goes only to
 * the runtime-owned port; the page keeps no copy and the URL is cleaned at once.
 */
export function takeLaunch(win: Pick<Window, 'location' | 'history'>): string {
  const launch = win.location.hash;
  win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
  return launch;
}

/**
 * Sole construction seam for the CLI login port. Production stays unavailable
 * until the generated runtime module is wired here; only the development
 * server loads the fixture.
 */
export async function createCliLoginPort(search: string): Promise<CliLoginPort | null> {
  if (!import.meta.env.DEV) return null;
  const { createDevCliLogin } = await import('../../../../core/src/dev-cli-login.js');
  const handoff = new URLSearchParams(search).get('dev-cli-handoff');
  return createDevCliLogin({
    handoff: handoff === 'cancelled' || handoff === 'failed' ? handoff : undefined,
  });
}
