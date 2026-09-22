# Storage configuration

The website and native backend require the same explicit durable driver and
endpoint. For managed deployments, set `storage.driver` to `turso` in both
private configuration files. Supply `url`, `networkTimeoutMs` (1–60000), and
exactly one of `authTokenPath` or `authToken`. The endpoint must use HTTPS or
libSQL with no embedded credential, query, fragment, or additional path.

Prefer an absolute `authTokenPath` pointing to a private regular file. Both
configuration files and credential files must deny group and other access.
Tokens are never part of public client configuration, API results, or logs.

All Node stores inherit the selected endpoint. Remove their SQLite `path` and
`busyTimeoutMs` fields when selecting Turso. Keep explicit capacity fields:

- `storage`: `maxReceipts`, `maxCredentials`, `maxVoucherSpends`.
- `apiKeys`: `maxKeys`, `maxKeysPerMember`, `maxLifetimeSeconds`,
  `allowedScopes`, `expirySeconds`.
- `enrollment`: `maxMembers`, `maxRetainedSlots`, `maxPublicationBytes`.

For the native configuration, remove `account.databasePath`,
`discovery.controlDatabasePath`, `discovery.controlBusyTimeoutMillis`,
`keyAccess.issuerDatabasePath`, and `keyAccess.redeemerDatabasePath`.
Per-service remote endpoint overrides and local fallback paths are rejected.
Valkey still has its separate explicit connection and limits configuration.

SQLite remains available for isolated contracts using explicit absolute file
paths and timeouts. It is never selected after a failed Turso connection.

Durable records include voucher spends, public passkey credentials, hashed API
keys, enrollment publications, accepted accounting commitments and receipts,
and replay/quota state. Private member keys, plaintext profiles, message
content, and contact lists are not database records on the service.

An uncertain transaction commit is not automatically retried. A retired store
makes readiness fail; native process failure also shuts down the website.
Configure process supervision to restart the application with the same durable
configuration and keys. Recovery reads retained state and idempotent receipts;
it must not create a new community or reset accounting.

Accounting amounts and durations are mandatory operator configuration.
Synthetic proof-fixture policies are not deployment defaults.
