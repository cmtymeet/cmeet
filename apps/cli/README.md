# cmeet command line

The `cmeet` Rust program currently inspects the cmsg registry and provides bounded
JSON input/output plumbing. It cannot yet join a community or run member actions.

`cmeet api [cli|mcp|openapi|bundle] [--pretty]` exports the corresponding cmsg-owned
description unchanged. `api mcp` exports tool descriptions; it is not an MCP
server. TUI, MCP serving and action dispatch await the authorized runtime.
cmsg owns the domain exit mapping; these surfaces must use its `exit_code`
method when dispatch becomes available. No local client capability is minted
by this program.

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

`cmeet invoke --endpoint http://127.0.0.1:PORT --origin ORIGIN --capability-fd N`
reads one complete owner `Invocation` from stdin and emits its complete `Output`,
including events. Input is forwarded without JSON reserialization. Domain exits
come directly from `ErrorCode::exit_code`; output failure is exit 1 and never
retries an action. Input, output and capability reads have ten-second deadlines.

The trusted runtime passes an existing local client capability through an
inherited private Unix pipe (descriptor 3 or higher), then closes its write end.
Only the descriptor number appears in arguments. Regular files, stdin, environment
variables and capability values in arguments are unsupported. The native client
uses cmsg's loopback HTTP transport; it cannot mint authority. Real custody and
pairing bootstrap remain owner integration work. The integration suite uses
`Door::pair_client` only inside its trusted test host, not in the product binary.
