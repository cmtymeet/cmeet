# cmeet release image staging

This directory defines the input contract for the generic cmeet production
image. It contains no community configuration, credentials, or live service
values. The image build consumes a release assembled from an already verified
CI result; it does not compile Rust, build Vite, resolve npm dependencies, or
download packages.

The staging directory is `deploy/stage/` in the Docker build context. It is
created outside the image build from the retained source-preparation artifact
and the retained browser/accounting release artifacts. Produce and validate the
stage before building the image:

```text
CI=true node deploy/stage-release.mjs \
  --prepared /absolute/path/to/source-preparation-artifact \
  --proof /absolute/path/to/reviewed-public-proof \
  --repo /absolute/path/to/clean/cmeet-checkout \
  --output /absolute/path/to/new/deploy/stage
node deploy/validate-release.mjs /absolute/path/to/deploy/stage
docker build --file Dockerfile .
```

Its output path must not already exist. It performs the exact package
extraction, production `npm ci`, pinned cvld native installation, complete
runtime-manifest emission, and validator invocation in CI. The command above
validates an already assembled stage separately.

The required layout is:

```text
deploy/stage/
  release-manifest.json
  source-preparation.json
  packages/*.tgz                         # retained CI package archives
  package.json
  package-lock.json
  node_modules/                          # production-only, lock-resolved
  vendor/{cmsg,cvld,cfrm,cfrm-browser,tor-js}/
  server/*.mjs
  dist/
    index.html
    accounting/                          # public proof artifacts
      manifest.json
      circuit.json
      vk.bin
      setup/g1.dat
      setup/g2.dat
      barretenberg-threads.wasm
      peer-reservation/circuit.json
      peer-reservation/vk.bin
  bin/cmeet-cfrm-backend
  bin/cvld-voucher-bridge
  node_modules/@hyperledger/anoncreds-nodejs/native/libanoncreds.so
```

`source-preparation.json` is the retained output of the existing remote source
preparation lane. `release-manifest.json` must contain this shape:

```json
{
  "format": "cmeet.release.v1",
  "source": "<40 lowercase hex cmeet commit>",
  "sourcePreparation": "source-preparation.json",
  "nativeInstaller": {
    "source": "<pinned anoncreds archive URL>",
    "archiveSha256": "<64 lowercase hex>",
    "scriptPath": "vendor/cvld/scripts/install-native.js",
    "resultPath": "node_modules/@hyperledger/anoncreds-nodejs/native/libanoncreds.so",
    "resultSha256": "<64 lowercase hex>"
  },
  "files": [
    { "path": "package.json", "sha256": "<64 lowercase hex>" }
  ]
}
```

The CI-only `deploy/stage-release.mjs` command is the producer for this
layout. It requires `CI=true`, a clean current checkout, the prepared artifact
directory, and a separate reviewed public-proof directory. It verifies the
prepared package/native hashes and source closure, extracts the exact package
archives into `vendor/`, copies the current server/package/lock/dist files,
runs `npm ci --omit=dev --ignore-scripts`, and then explicitly runs the cvld
native installer. The installer is pinned to anoncreds-rs v0.2.3 with archive
SHA-256
`f54f262dd63422830ce15f3240b82ffb729c3159a225d42ddd9e948d6f5582c9`; the
resulting `libanoncreds.so` digest is recorded in `release-manifest.json` and
the file is required by the validator. The image never runs this installer.

The `files` array must include every file beneath the runtime trees (`server/`,
`dist/`, `vendor/`, `node_modules/`, and `bin/`), every required root file, and
`source-preparation.json`. Ordinary records have `{ "path", "sha256" }`;
production `node_modules` may retain a relative symlink to a staged vendor
directory using `{ "path", "type": "symlink", "target": "../vendor/..." }`.
The validator checks every declared runtime byte and symlink target, rejects
unlisted runtime files, checks the accounting artifact hashes against the
accounting `manifest.json`, verifies every retained package archive against its
recorded SHA-256 and npm integrity value, and binds native binary digests to the
retained CI evidence. It rejects paths that escape the staging directory.

When the retained source-preparation artifact was produced for an earlier cmeet
commit, the stage must also include the `source-reuse.json` proof emitted by the
existing reuse lane. That proof binds the current cmeet source to the original
source-preparation source and requires unchanged native source and package/lock
inputs; matching source hashes are accepted directly.

Archive hashes and staged runtime hashes are checked independently. This
validator does not itself prove that a particular archive was extracted into a
particular vendor tree or that npm produced `node_modules`; the CI staging
step must perform that deterministic extraction/production-only install and
emit the complete `release-manifest.json` for the resulting bytes.

The image contains only the public application and verified runtime artifacts.
The Dockerfile uses the Node 24 Trixie glibc base for both validation and
runtime stages because the current Ubuntu 24.04 CI native artifacts must not be
assumed compatible with Debian Bookworm's older glibc. The selected base and
native binaries still require a remote `ldd`/startup smoke check before release;
no compatibility claim is made here.
Private state is mounted separately as a config bundle at
`/run/secrets/cmeet` (or an explicitly absolute `CMEET_CONFIG_BUNDLE` path).
The bundle must contain `cmeet.json` and `native.json`, with all referenced
private files beneath the bundle. `CMEET_CONFIG_BUNDLE`, when set, must name a
single mounted directory directly beneath `/run/secrets`; this prevents a
runtime variable from selecting an arbitrary filesystem tree. The entrypoint
copies that bundle into an exclusive, mode-0700 `/run/cmeet` tree, sets files
to mode 0600, validates the fixed runtime executable and asset paths, drops
supplemental groups and then the image's `node` user,
and imports the fixed server command:

```text
node /app/server/start.mjs --config /run/cmeet/cmeet.json
```

The bundle is trusted operator configuration. It must set the website origin,
RP ID, Turso and Valkey endpoints, bounded capacities, native paths, and
community trust values explicitly. No `cmtytest.corbet.ch` value or secret is
included here.

The image does not provide a Tor daemon or a TorJS gateway. Those remain
separate runtime infrastructure dependencies; the cmeet process only contains
the loopback ticket listener and browser client composition.
