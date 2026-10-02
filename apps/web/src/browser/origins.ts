// Origin resolution for the browser separation: the UI runs top-level at
// <community>.<base>, the vault frame at vault.<community>.<base>. Origins are
// parsed and compared exactly; there are no suffix checks and no guessing.

export interface VaultOrigins {
  member_origin: string;
  vault_origin: string;
  vault_url: string;
  popup_url: string;
}

export interface OriginOptions {
  /** Development only: allow http for localhost and *.localhost. */
  allowInsecureLocal?: boolean;
}

export const VAULT_LABEL = 'vault';

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

/** Parses an exact origin: no path, query, fragment, userinfo or trailing slash. */
export function parseOrigin(raw: string, options: OriginOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The origin is malformed.');
  }
  const secure = url.protocol === 'https:';
  const localHttp = options.allowInsecureLocal === true && url.protocol === 'http:' && isLocalHost(url.hostname);
  if (!secure && !localHttp) throw new Error('The origin must use https.');
  if (url.origin !== raw || url.username !== '' || url.password !== '') throw new Error('The origin must be exact.');
  return url;
}

/** True only for the vault host of a community (first label exactly "vault"). */
export function isVaultHost(hostname: string): boolean {
  const labels = hostname.split('.');
  return labels.length >= 3 && labels[0] === VAULT_LABEL;
}

/** Derives the vault origin and pages from the member origin. */
export function resolveVaultOrigins(memberOrigin: string, options: OriginOptions = {}): VaultOrigins {
  const member = parseOrigin(memberOrigin, options);
  const labels = member.hostname.split('.');
  if (labels.length < 2 || labels[0] === VAULT_LABEL || /^[0-9.]+$/.test(member.hostname) || member.hostname.startsWith('[')) {
    throw new Error('The member origin must be a community host name.');
  }
  const vaultOrigin = `${member.protocol}//${VAULT_LABEL}.${member.host}`;
  return {
    member_origin: member.origin,
    vault_origin: vaultOrigin,
    vault_url: `${vaultOrigin}/`,
    popup_url: `${vaultOrigin}/#/ceremony/`,
  };
}

/** The member origin a vault page serves, or null when this is not a vault origin. */
export function memberOriginOf(vaultOrigin: string, options: OriginOptions = {}): string | null {
  const vault = parseOrigin(vaultOrigin, options);
  if (!isVaultHost(vault.hostname)) return null;
  return `${vault.protocol}//${vault.host.slice(VAULT_LABEL.length + 1)}`;
}
