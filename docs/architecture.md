# Architecture

DBNet is one local process with two layers:

1. A statically exported Next.js interface.
2. A Go HTTP server that owns database sessions and serves that interface from an embedded filesystem.

The browser and API share the same loopback origin. This avoids cross-origin credential handling and lets the binary run without an external web server.

## Request path

```text
Browser on 127.0.0.1
        |
        | JSON over loopback HTTP
        v
Go server
   |-- profile store on local disk
   |-- dedicated PostgreSQL session
   `-- dedicated MySQL session
```

The browser never opens a raw PostgreSQL or MySQL socket. The Go process validates requests, owns each live connection, caps results, and serializes database values into lossless text where possible.

## Build path

`next build` creates the static export in `out/`. `scripts/sync-assets.mjs` copies the export into the ignored `internal/webassets/out/` build directory. Go's `embed` package then places those files inside the executable. Generated assets do not belong in source control.

## Persistence

- Connection metadata and CA certificates: `connections.json` in the OS user configuration directory.
- Remembered passwords: browser local storage, keyed by profile ID.
- Query history and appearance: browser local storage.
- Live database sessions: process memory only.

Passwords are intentionally excluded from `connections.json`. Native keychain storage is the preferred future replacement for browser-local password storage.

## Trust boundaries

The loopback listener is not authenticated. It must remain bound to `127.0.0.1`. Cross-origin writes are rejected, but that check is not a substitute for authentication on a network-exposed service.

Database results and errors are untrusted data. UI changes should continue rendering them as text rather than HTML. SQL identifiers used by the table browser are checked against database metadata and quoted; filter values are bound parameters.
