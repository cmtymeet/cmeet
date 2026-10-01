# cmeet command line

The `cmeet` Rust program currently inspects the cmsg registry and provides bounded
JSON input/output plumbing. It cannot yet join a community or run member actions.

`cmeet api [cli|mcp|openapi|bundle] [--pretty]` exports the corresponding cmsg-owned
description unchanged. `api mcp` exports tool descriptions; it is not an MCP
server. TUI, MCP serving and action dispatch await the authorized runtime and
owner-defined exits. No local client capability is minted by this program.

Action names, schemas, role/scope checks, errors, events and exits come from
cmsg. Member actions will wait for real Mesh readiness. Admin and root actions use
cmsg → Foyer → cvld. No frontend implements admission or calls a server door
directly.

The I/O helpers accept owner-defined serde types and byte limits. They preserve
JSON values, escape terminal control characters and report process errors without
input contents. Raw request forwarding preserves duplicate fields for the owner
to reject. The helpers neither retry actions after a broken output stream nor
interpret delivery acknowledgements. serde and serde_json provide the formats;
no serialization protocol is implemented here. Clap supplies argument parsing
and help. Help/export succeeds with exit 0, invalid shell arguments use Clap's
exit 2, and output failure uses exit 1; these are not cmsg domain error codes.

Production native passkey custody remains undecided. No authenticator is
included in this shell. A future software authenticator with PRF must be confined
to an explicit test/demo feature, and cannot satisfy production acceptance.

CI runs stable Rust tests and requires exact 100% line and branch counts with
cargo-llvm-cov. There are no production-code coverage exclusions. These tests
establish shell I/O behavior only; the full product gate is [the toy](../../tests/toy/README.md).
