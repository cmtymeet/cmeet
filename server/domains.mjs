import { isIP } from 'node:net';

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const validLabel = value => typeof value === 'string' && value === value.trim() && label.test(value);
const reserved = new Set(['admin', 'root', 'api', 'mcp']);

function hostname(value) {
  if (typeof value !== 'string' || value.length > 253 || isIP(value)
      || value.split('.').length < 2 || !value.split('.').every(validLabel)) {
    throw new TypeError('A canonical DNS base domain is required');
  }
  try {
    if (new URL(`https://${value}`).hostname !== value) throw new Error();
  } catch { throw new TypeError('A canonical DNS base domain is required'); }
  return value;
}
const originFor = host => `https://${hostname(host)}`;
const administrative = (name, base) => Object.freeze({
  origin: originFor(`${name}.${base}`), apiOrigin: originFor(`api.${name}.${base}`),
});

/** Deployment naming only. These names neither authorize a principal nor
 * provision DNS, TLS, an administrative service or a cross-origin API.
 * communityLabel is trusted operator configuration, not a name-registration
 * interface; content/name moderation belongs to the shared registration policy.
 */
export function deploymentDomains({ baseDomain, communityLabel = null }) {
  const base = hostname(baseDomain);
  if (communityLabel !== null && (!validLabel(communityLabel) || reserved.has(communityLabel))) {
    throw new TypeError('Community label is invalid or collides with a reserved host');
  }
  const communityHost = communityLabel === null ? base : `${communityLabel}.${base}`;
  return Object.freeze({
    baseDomain: base,
    community: Object.freeze({ origin: originFor(communityHost),
      apiOrigin: originFor(`api.${communityHost}`), mcpOrigin: originFor(`mcp.${communityHost}`) }),
    admin: administrative('admin', base), root: administrative('root', base),
  });
}

/** Resolve trusted deployment configuration before starting any services.
 * Explicit origins also support custom domains and isolated localhost tests.
 * A base-domain deployment rejects stale origin/RP overrides instead of
 * silently changing the authentication boundary.
 */
export function resolveWebsiteAddress(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Website configuration required');
  let domains, websiteOrigin = config.origin, rpID = config.rpID;
  if (config.baseDomain !== undefined) {
    if (config.allowInsecureLocalhost === true) throw new TypeError('Base-domain deployments require HTTPS');
    domains = deploymentDomains({ baseDomain: config.baseDomain, communityLabel: config.communityLabel });
    const derived = domains.community.origin;
    const derivedRP = new URL(derived).hostname;
    if ((websiteOrigin !== undefined && websiteOrigin !== derived) || (rpID !== undefined && rpID !== derivedRP)) {
      throw new TypeError('Website origin or RP ID conflicts with the configured base domain');
    }
    websiteOrigin = derived; rpID = derivedRP;
  } else if (config.communityLabel !== undefined) {
    throw new TypeError('A community label requires a base domain');
  }
  const origin = new URL(websiteOrigin);
  if (origin.origin !== websiteOrigin || origin.hostname !== rpID
      || (origin.protocol !== 'https:' && !(config.allowInsecureLocalhost === true
        && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new TypeError('Configured website origin rejected');
  }
  return Object.freeze({ origin: websiteOrigin, rpID, domains });
}
