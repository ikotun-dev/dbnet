# Contributing to DBNet

Thanks for helping improve DBNet. The project is intentionally local-first and small enough to understand without a large framework around it. Contributions should preserve that property.

## Before writing code

- Search existing issues before opening a new one.
- Open an issue before large UI changes, new database drivers, storage changes, or new network-facing behavior.
- Never include real connection strings, passwords, certificates, query history, or database exports in an issue or fixture.

## Development setup

```sh
git clone https://github.com/ikotun-dev/dbnet.git
cd dbnet
npm ci
npm run build
npm run assets:sync
go run ./cmd/dbnet run
```

Use `npm run dev` for frontend-only iteration. That server intentionally lacks the Go database API.

## Making a change

1. Fork the repository and create a short, descriptive branch from `main`.
2. Keep the change focused. Avoid unrelated formatting or dependency updates.
3. Add or update tests for behavior changes.
4. Update documentation when commands, storage, security, or user-visible behavior changes.
5. Run the full checks before submitting the pull request.

```sh
npm run typecheck
npm test
npm run build:cli
go vet ./...
```

Go code must be formatted with `gofmt`. TypeScript should follow the surrounding style and retain accessible names, keyboard behavior, and visible focus states. Prefer standard-library Go and small browser-native APIs over new dependencies unless the dependency removes meaningful maintenance work.

## Pull requests

A useful pull request explains:

- The problem being solved.
- Why the chosen approach fits DBNet's local-first model.
- How the change was tested.
- Any security, compatibility, migration, or performance implications.

Screenshots are helpful for visible changes. Reviewers may ask for a smaller patch when several unrelated concerns are combined.

By contributing, you agree that your contribution is licensed under the repository's MIT License and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
