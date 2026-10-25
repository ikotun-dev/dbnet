# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's **Security** tab to submit a private GitHub Security Advisory.

Include the affected version, reproduction steps, expected impact, and any suggested mitigation. Do not include credentials or data from a real database. You should receive an acknowledgement within seven days.

## Security model

DBNet is a local tool, not a multi-user hosted service. Its HTTP server binds to `127.0.0.1`, has no authentication layer, and must not be exposed through a public proxy or network tunnel.

Connection profile files exclude passwords and use owner-only permissions. Remembered passwords currently live in browser local storage and are not protected by an OS keychain. Database credentials are sent only to the database selected by the user. SQL entered in the editor executes immediately with the connected account's permissions.

Supported releases and the current `main` branch receive security fixes. Older binaries may be asked to upgrade before a fix is backported.
