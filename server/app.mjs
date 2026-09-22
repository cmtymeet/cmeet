import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';
import { json } from './api.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json',
  '.bin': 'application/octet-stream', '.dat': 'application/octet-stream' };

/** HTTP mechanics only. Trusted origin is explicit; forwarded headers never
 * select an RP, community, upstream, or authorization policy. */
export async function createCmeetServer({ api, mcp, origin, distDir, limits, torGatewayOrigins,
  health = () => true, onUnhealthy = () => {} }) {
  // Standalone HTTP contract fixtures report listener health by default.
  // Production supplies live backend/store readiness and failure shutdown.
  if (typeof health !== 'function' || typeof onUnhealthy !== 'function') throw new TypeError('Health callbacks required');
  const configured = new URL(origin), root = await realpath(distDir);
  if (configured.origin !== origin || !['http:', 'https:'].includes(configured.protocol)) throw new TypeError('Exact website origin required');
  for (const name of ['maxConcurrentRequests', 'requestTimeoutMs', 'maxBodyBytes', 'maxAssetBytes']) {
    if (!Number.isSafeInteger(limits?.[name]) || limits[name] < 1) throw new TypeError('Explicit HTTP limits required');
  }
  if (!Array.isArray(torGatewayOrigins)) throw new TypeError('Explicit Tor gateway origins required');
  const connect = torGatewayOrigins.map(value => {
    const url = new URL(value);
    if (url.origin !== value || !['https:', 'wss:'].includes(url.protocol)) throw new TypeError('Invalid gateway origin');
    return value;
  });
  const headers = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
    'Content-Security-Policy': `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' blob: ${connect.join(' ')}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  };
  let active = 0;
  const server = createServer({ maxHeaderSize: 16_384 }, async (incoming, outgoing) => {
    for (const [name, value] of Object.entries(headers)) outgoing.setHeader(name, value);
    let acquired = false, timer;
    const abort = new AbortController();
    try {
      if (incoming.headers.host !== configured.host) throw new Error('Host rejected');
      const path = incoming.url;
      if (!path?.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Path rejected');
      const suppliedOrigin = incoming.headers.origin;
      if (suppliedOrigin !== undefined && suppliedOrigin !== origin) throw new Error('Origin rejected');
      if (active >= limits.maxConcurrentRequests) { outgoing.writeHead(429).end(); return; }
      active++; acquired = true;
      timer = setTimeout(() => { abort.abort(); incoming.destroy(); outgoing.destroy(); }, limits.requestTimeoutMs);
      incoming.once('aborted', () => abort.abort());
      const url = new URL(path, origin);
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, signal: abort.signal,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }) });
      let response;
      if (url.pathname === '/mcp') response = await mcp.handle(request);
      else if (url.pathname === '/health' && incoming.method === 'GET') {
        let healthy = false;
        try { healthy = (await health()) === true; } catch {}
        if (!healthy) outgoing.once('finish', () => { try { onUnhealthy(); } catch {} });
        response = json(healthy ? 200 : 503, { status: healthy ? 'running' : 'unavailable' });
      }
      else if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/credential/') || url.pathname.startsWith('/v1/')) response = await api.handle(request);
      else {
        if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405).end(); return; }
        const decoded = decodeURIComponent(url.pathname);
        const candidate = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
        if (!candidate.startsWith(root + sep) || decoded.includes('\0')) throw new Error('Path rejected');
        let file;
        try { file = await realpath(candidate); } catch { outgoing.writeHead(404).end(); return; }
        if (!file.startsWith(root + sep) || !MIME[extname(file)]) { outgoing.writeHead(404).end(); return; }
        const info = await stat(file);
        if (!info.isFile() || info.size > limits.maxAssetBytes) throw new Error('Asset rejected');
        response = new Response(incoming.method === 'HEAD' ? null : await readFile(file), { headers: {
          'Content-Type': MIME[extname(file)], 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
        } });
      }
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers) if (name !== 'set-cookie') outgoing.setHeader(name, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
      if (!response.body || incoming.method === 'HEAD') outgoing.end();
      else {
        for await (const chunk of response.body) {
          if (!outgoing.write(chunk)) await new Promise((accept, reject) => {
            const cleanup = () => { outgoing.off('drain', drained); outgoing.off('error', failed); outgoing.off('close', closed); };
            const drained = () => { cleanup(); accept(); };
            const failed = error => { cleanup(); reject(error); };
            const closed = () => failed(new Error('Connection closed'));
            outgoing.once('drain', drained); outgoing.once('error', failed); outgoing.once('close', closed);
          });
        }
        outgoing.end();
      }
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(400, { 'Cache-Control': 'no-store' });
      outgoing.end();
    } finally { clearTimeout(timer); if (acquired) active--; }
  });
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = Math.min(limits.requestTimeoutMs, 15_000);
  server.keepAliveTimeout = 5_000;
  return server;
}
