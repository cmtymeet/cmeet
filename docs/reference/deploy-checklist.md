# deploy/ — deployment evidence and operation

**Status: proposed, unbuilt; reviewed 8 September 2026.** Current service shape:
[architecture](../docs/architecture.md). Data contract:
[lifecycle](../docs/data-lifecycle.md). No provider selection, paid provisioning
or deployment was performed in the relay review.

## What belongs here

- **Static public site.** Operator-authored pages and versioned client assets;
  no hosted member ads, profiles or directory in the relay candidate.
- **Provider comparison.** Inventory control over logs, proxy records, tracing,
  dumps, swap, backups and provider analytics before choosing a runtime. Separate
  process-level controls from records held by its host. Self-hosting is not proof
  of absence of provider metadata.
- **Effective configuration evidence.** If Cloudflare is chosen, use standard
  WebSockets, no Hibernation attachments or application storage, and explicitly
  disabled observability/logging/tracing. No Tail Worker or Logpush. A checked-in
  configuration is intent; inspect what is actually deployed.
- **Synthetic retention probe.** Existing Cloudflare candidate requires before/
  after observations of all four documented DO analytics datasets, closure and
  eviction, plus later time windows. Historical per-object metrics are documented;
  empty queries do not prove no internal provider records. Sources and procedure:
  [security review](../docs/security-review.md).
- **Client release evidence.** Reproducible artifacts, published source revision,
  integrity/distribution checks and a served-build verification procedure. A
  maliciously delivered PWA can violate the reviewed source's promises; server
  non-logging also cannot be proved by publishing source alone.
- **Minimal operational state.** Only coarse service-health counters without
  member/room dimensions in routine telemetry. Security-ledger backups have
  explicit retention/deletion rules; relay state is never backed up.
- **Lawful request and transparency policy.** Describe actual available data and
  access. Publish redacted request summaries only where lawful, with identifying
  details removed. Avoid creating a permanent public dossier from requests.
- **Service-specific legal review.** Establish operator/entity, target markets and
  classification for transport, admission and any eventual discovery storage.
  Do not apply hosting-only duties to every relay by default, or infer immunity
  from E2EE. D10 requires no operator content-moderation labour; feasibility is
  unresolved. See the [relay study](../studies/relay-architecture-2026-09-08.md).
- **Budget and continuity.** Cost the actual selected runtime, concurrency, SMS,
  custody and operational requirements against D2. Earlier monthly-cost and
  workload estimates are not validated for this architecture. Document key
  custody, patches, incident handling and succession without content inspection.

## Release constraints

This repository stays private and solo until a fresh public repository is made;
no collaborators and no temporary public visibility. Never place member data,
seed contacts or relationships in git. Durable reasoning belongs in documents,
not only commit messages. The intended release identity must exist before the
new repository's first commit; keep current history disposable as specified in
[`.agent/AGENT.md`](../.agent/AGENT.md).

No paid tier, merchant account, token or money movement is part of the design.
No deployments, vendor commitments or public release are authorized by this
specification. Acceptance evidence lives beside the eventual configurations,
not as unsupported promises in product copy.
