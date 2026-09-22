import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { OPERATIONS, json } from './api.mjs';

/** Remote MCP carries the same public signed requests as HTTP. Private message
 * plaintext, profile keys and holder witnesses belong in member-side clients. */
export function createCommunityMcp({ api, maxBodyBytes }) {
  const handler = createMcpHandler(({ requestInfo }) => {
    const server = new McpServer({ name: 'cmeet', version: '0.1.0-alpha.0' });
    for (const [name, operation] of Object.entries(OPERATIONS)) {
      server.registerTool(name, {
        description: `Submit the existing signed cfrm ${operation.kind} request. Requires ${operation.scope}; all cryptographic checks remain mandatory.`,
        inputSchema: z.object({ request: z.record(z.string(), z.unknown()) }).strict(),
        annotations: { readOnlyHint: operation.readOnly, destructiveHint: !operation.readOnly, openWorldHint: false },
      }, async ({ request }) => {
        try {
          const result = await api.invoke(name, request, requestInfo);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch { return { isError: true, content: [{ type: 'text', text: 'Request rejected' }] }; }
      });
    }
    return server;
  }, { legacy: 'stateless', responseMode: 'json', maxRequestBodySize: maxBodyBytes });
  return Object.freeze({
    async handle(request) {
      // Authenticate metadata/discovery too. Individual tool calls recheck the
      // exact operation scope and live key revocation through api.invoke.
      if (!(await api.authenticate(request))) return json(401, { error: 'Authentication required' });
      const response = await handler.fetch(request);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
    close: () => handler.close(),
  });
}
