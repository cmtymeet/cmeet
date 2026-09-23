# Deployment domains

Set `baseDomain` in the private server configuration to derive the community,
administration, API and MCP hostnames. The domain is runtime configuration and
is not compiled into the frontend. This example uses a documentation-only domain:

```json
{
  "baseDomain": "test.example",
  "communityLabel": null
}
```

`communityLabel: null` serves the initial community at the base domain itself.
For a named community, set a DNS label such as `"garden"`:

| Purpose | Base community | Named community |
|---|---|---|
| Community website | `test.example` | `garden.test.example` |
| Community API | `api.test.example` | `api.garden.test.example` |
| Community MCP | `mcp.test.example` | `mcp.garden.test.example` |
| Internal administration | `admin.test.example` | `admin.test.example` |
| Scoped administrative API | `api.admin.test.example` | `api.admin.test.example` |
| Global root administration | `root.test.example` | `root.test.example` |
| Global root API | `api.root.test.example` | `api.root.test.example` |

Startup derives `origin` and passkey `rpID` from the community website. Omit
those duplicate fields when using `baseDomain`; explicitly supplied values must
match. Startup rejects a mismatch before opening stores or starting services.
It publishes only the generated `domains` descriptor in the public config.
The `root`, `admin`, `api` and `mcp` labels are reserved against community-host
collisions. This validation does not replace the shared name-registration policy.

Explicit `origin` and `rpID` without `baseDomain` configure a custom domain.
HTTP remains restricted to an explicitly enabled localhost test origin.
Community identifiers, persisted keys and storage namespaces stay explicit and
independent of the domain; changing a hostname does not mint a new identity.

The hostname descriptor is deployment configuration. It does not grant admin
rights, create administrative screens, widen the server's accepted Host/Origin,
or provision DNS and certificates. The current community server still serves
its API and `/mcp` on the exact website origin. Dedicated API/MCP hosts require
explicit routing and authentication integration before they are live. TLS must
cover every configured nested hostname; a base-domain wildcard alone does not
cover names such as `api.admin.test.example`.

Changing `baseDomain` updates the generated names for a new deployment. Existing
passkeys remain bound to the old RP ID. A domain move therefore needs the planned
credential-continuity flow; changing this parameter alone cannot migrate them.
