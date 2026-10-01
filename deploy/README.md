# Deployment status

No current product runtime image is ready. The previous Node/native server
bundle and its build workflows were retired with the obsolete authority graph;
[the retirement record](../docs/retired-prototype.md) preserves its evidence.
Historical archive readers live in `tools/evidence/legacy`.

Deployment requires the real cmsg member runtime, generated browser adapter,
all conjunctive toy stages, required backend reviews and verified artifacts on
one resolved dependency graph. Preserve exact source/dependency identity,
archive hashes, native startup checks, bounded process isolation and actual
browser evidence when the new bundle is assembled. Build outputs are files or
OCI archives, never registry publication. Credentials are external to source,
CI artifacts and logs.
