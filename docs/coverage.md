# CLI coverage evidence

The required CLI coverage job uses current nightly Rust and maintained
[cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov). It executes the actual
native/HTTP/MCP/terminal suite once, then exports JSON, LCOV and annotated text
from that same execution. Failed tests remain fatal even when diagnostic exports
succeed. Stable formatting, Clippy and tests remain separate checks.

The source gate requires every emitted production line and branch to have a
positive counter. It has no production source exclusions. Test-only transport
fixtures live under `tests/support`; they are exercised but do not inflate
production counts. Dependencies have their own owner gates.

The gate validates the complete file inventory against raw LLVM JSON, all
emitted branch locations against that export, and every emitted line location
and hit/miss against the companion annotated report. It rejects incomplete,
duplicate, inconsistent, uncovered or empty reports. Summary counts alone cannot
establish completeness: LLVM summaries can count generic copies differently from
merged source counters. Tests exercise missing line/branch/file records, forged
positive counters, duplicate sources, negative counters and truncated reports.

Raw JSON totals and annotated instantiation details remain artifacts. The source
metric does not claim every generic instantiation, every possible OS failure or
full product readiness. Repeated I/O errors share a value-free conversion,
exercised by actual closed-pipe/terminal failures and bounded I/O fault fixtures;
it preserves the same owner error without copying upstream diagnostic contents.

The initial complete adapter suite at commit
`08814efd9526ecd8dd096e2faa1eedc0bf880d0f` passed 42 tests but remained correctly
red: raw LLVM reported 494/505 lines and 62/62 branches; source counters reported
483/485 lines and 62/62 branches. Both genuinely uncovered source lines were
reported, despite the different summary totals. The same real report remains
rejected by the source gate. No smaller threshold is used.

The full `toy` gate remains red until every real scenario in
[its acceptance contract](../tests/toy/README.md) executes. Adapter coverage,
trusted test-host pairing and production browser refusal cannot replace member
admission, accounting, Tor delivery, groups or active-member device-loss restore.
