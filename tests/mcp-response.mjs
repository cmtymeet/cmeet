import assert from 'node:assert/strict';

// Streamable HTTP may return JSON or SSE for a legacy protocol client. Read
// the actual JSON-RPC result from either valid transport representation.
export async function mcpResponse(response, id) {
  const type = response.headers.get('content-type')?.split(';')[0];
  if (type === 'application/json') return response.json();
  assert.equal(type, 'text/event-stream');
  const body = await response.text();
  assert(body.length <= 1_048_576);
  const results = body.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return [];
    const message = JSON.parse(data);
    return message.id === id ? [message] : [];
  });
  assert.equal(results.length, 1, 'Exactly one response must match this JSON-RPC request');
  return results[0];
}
