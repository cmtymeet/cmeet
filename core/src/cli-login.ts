/**
 * Typed port for the browser page that `cmeet login` opens.
 *
 * The runtime (cpky/cmsg) owns the whole ceremony: it validates the launch
 * fragment, runs the passkey ceremony through the vault pop-up route and
 * delivers the result to the one-time loopback callback of the local CLI.
 * This port exposes presentation data and status only. It never carries a
 * secret, a PRF output, a capability or a callback address to UI code, and
 * nothing travels through our servers.
 */

export type CliLoginRefusal = 'malformed' | 'origin-mismatch' | 'expired' | 'replayed' | 'unavailable';

/** What the member confirms: the exact community origin and the local handoff. */
export interface CliLoginRequest {
  communityOrigin: string;
  /** Names the local application that receives the result. */
  handoffLabel: string;
  expiresLabel: string;
}

export type CliLoginInspection =
  | { ok: true; request: CliLoginRequest }
  | { ok: false; reason: CliLoginRefusal };

export interface CliLoginStatus {
  state: 'done' | 'cancelled' | 'failed';
  /** Runtime-supplied explanation; absent for a plain success. */
  message?: string;
  /** Only the runtime decides whether another attempt is possible. */
  retryable: boolean;
}

export interface CliLoginPort {
  /**
   * Hands the raw launch fragment to the runtime exactly once. The runtime
   * validates it against the page origin and returns display data only.
   */
  inspect(launch: string, pageOrigin: string): Promise<CliLoginInspection>;
  /** Starts the ceremony after an explicit user click. */
  begin(): Promise<CliLoginStatus>;
  /** Cancels a pending ceremony. */
  cancel(): Promise<CliLoginStatus>;
}

export const CLI_LOGIN_PREFIX = '#/cli-login/';

export function isCliLoginHash(hash: string): boolean {
  return hash.startsWith(CLI_LOGIN_PREFIX);
}
