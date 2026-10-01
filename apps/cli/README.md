# cmeet command line

The product will provide one Rust program with command, TUI and MCP projections
of the cmsg registry. This directory currently contains only bounded JSON input
and output plumbing. It does not yet contain a runnable member client.

Action names, schemas, role/scope checks, errors, events and exits must come from
cmsg. Member actions wait for real Mesh readiness. Admin and root actions use
cmsg → Foyer → cvld. No frontend implements admission or calls a server door
directly.

The I/O helpers accept owner-defined serde types and byte limits. They preserve
JSON values, escape terminal control characters and report process errors without
input contents. They neither retry actions after a broken output stream nor
interpret delivery acknowledgements. serde and serde_json provide the formats;
no serialization protocol is implemented here.

Production native passkey custody remains undecided. No authenticator is
included in this shell. A future software authenticator with PRF must be confined
to an explicit test/demo feature, and cannot satisfy production acceptance.

CI runs stable Rust tests and requires exact 100% line and branch counts with
cargo-llvm-cov. There are no production-code coverage exclusions. These tests
establish shell I/O behavior only; the full product gate is [the toy](../../tests/toy/README.md).
