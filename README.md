# DBNet

I built DBNet because I got a new Mac and discovered that I had lost my TablePlus license key. I still needed a clean way to inspect PostgreSQL and MySQL databases, but I did not want another account, subscription, hosted control plane, or service sitting between my computer and my data.

DBNet is the small local database workspace I wanted in that moment. It runs as one executable on your machine, opens in your browser, and connects directly from your computer to your database. There is no DBNet cloud service and nothing to deploy.

> DBNet is young software. Use a read-only database account or a disposable database while evaluating it. SQL entered in the editor is executed immediately.

## What it does

- Connects to PostgreSQL and MySQL over direct local sessions.
- Imports `postgres://`, `postgresql://`, and `mysql://` connection URLs.
- Browses tables with pagination, sorting, text filters, structure details, and row inspection.
- Runs selected SQL or the full editor with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd>.
- Keeps separate workspaces and query tabs for concurrent connections.
- Exports fetched rows as CSV.
- Supports verified TLS, encryption-only TLS, provider CA certificates, and disabled TLS for local development.
- Saves connection profiles, color tags, and query history locally.
- Ships as a standalone binary with the web interface embedded.

## Install a release

Download the archive for your operating system and CPU from [GitHub Releases](https://github.com/ikotun-dev/dbnet/releases), extract it, and put the `dbnet` executable in a directory on your `PATH`.

On macOS or Linux, a typical user-local installation is:

```sh
mkdir -p "$HOME/.local/bin"
install -m 0755 dbnet "$HOME/.local/bin/dbnet"
```

Make sure `$HOME/.local/bin` is on your `PATH`, then run:

```sh
dbnet run
```

Open [http://127.0.0.1:47831](http://127.0.0.1:47831). DBNet stays in the foreground and prints lifecycle and API request logs. Press `Ctrl+C` to close active database sessions and stop it cleanly.

Release binaries are currently unsigned. If macOS refuses to open a downloaded build, either approve it in macOS Privacy & Security after verifying where it came from, or build DBNet from source.

## Clone and build from source

### Requirements

- Node.js 20.9 or newer
- npm
- Go 1.25 or newer
- Git

### Setup

```sh
git clone https://github.com/ikotun-dev/dbnet.git
cd dbnet
npm ci
npm run build:cli
./bin/dbnet run
```

The `build:cli` script exports the Next.js interface, copies it into the Go asset package, and compiles a standalone executable at `bin/dbnet`.

To install that build for your user account:

```sh
./scripts/install.sh
```

The installer writes to `$HOME/.local/bin` by default. Set `DBNET_INSTALL_DIR` to choose another destination.

## Development

Install dependencies once:

```sh
npm ci
```

For frontend-only work with fast refresh:

```sh
npm run dev
```

The development server does not provide the Go API, so real database connections require a full build:

```sh
npm run build
npm run assets:sync
go run ./cmd/dbnet run
```

Before opening a pull request, run:

```sh
npm run typecheck
npm test
npm run build:cli
go vet ./...
```

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `DBNET_PORT` | Local HTTP port | `47831` |
| `DBNET_DATA_DIR` | Directory containing `connections.json` | OS user configuration directory under `dbnet` |
| `DBNET_INSTALL_DIR` | Destination used by `scripts/install.sh` | `$HOME/.local/bin` |

The HTTP listener is bound to `127.0.0.1`; DBNet is intentionally not reachable from other machines. Do not place it behind a public proxy. To run an isolated copy:

```sh
DBNET_PORT=47832 DBNET_DATA_DIR=/tmp/dbnet-sandbox dbnet run
```

## Local data and security

Saved profiles are written to `connections.json` with `0600` permissions. The file contains connection metadata and optional CA certificates, but never database passwords.

If **Remember password on this device** is enabled, the password is stored by the browser in local storage and matched to that saved profile. Browser local storage is convenient, not equivalent to an operating-system keychain; do not enable it on a shared computer. A future release should move remembered credentials into the native keychain.

Query history is also browser-local. Avoid putting secrets in SQL comments or literals. Results are capped at 1,000 rows or 4 MiB, and requests have a 30-second deadline.

TLS verification failures never trigger an automatic downgrade. `verify-full` checks the certificate chain and hostname, `verify-ca` checks the chain, and `require` encrypts without authenticating the server. Prefer `verify-full` whenever your provider supports it.

## Repository layout

```text
app/                    Next.js interface
cmd/dbnet/              Local HTTP server, database sessions, and CLI
internal/webassets/     Embedded frontend package populated during builds
lib/                    Browser-side connection URL parser and tests
scripts/                Reproducible asset sync and local installation
.github/workflows/      CI and tagged binary releases
docs/                   Architecture notes
```

Generated frontend exports, dependencies, binaries, and local connection data are ignored by Git. Do not commit `out/`, `node_modules/`, `bin/`, or `data/`.

## Releases

Pushing a tag such as `v0.1.0` starts the release workflow. It runs the test suite, builds the frontend once per target, embeds it, and publishes archives for macOS, Linux, and Windows on amd64 and arm64 where supported.

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Contributing

Bug reports, focused improvements, documentation fixes, and database compatibility work are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting. For substantial behavior changes, open an issue first so the direction can be discussed before anyone spends time implementing it.

Please report security issues privately using the repository's GitHub Security Advisory page; see [SECURITY.md](SECURITY.md).

## Current limitations

- Table browsing is read-only, but SQL entered in the editor may modify data.
- Pagination uses `LIMIT`/`OFFSET`; concurrent writes can move rows between pages.
- Tables without a primary key cannot guarantee stable ordering.
- PostgreSQL uses simple-query mode for ad hoc SQL.
- MySQL multi-statement mode is disabled.
- There is no SSH tunnel support, native keychain integration, streaming result protocol, or transaction UI yet.

## License

DBNet is available under the [MIT License](LICENSE).
