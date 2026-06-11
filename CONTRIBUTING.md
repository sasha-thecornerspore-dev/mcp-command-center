# Contributing to MCP Command Center

Thanks for your interest! This project aims to be the friendliest way to manage MCP
connections across every AI client.

## Development setup

```bash
npm install
npm run dev
```

Before opening a PR, please run:

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. New behavior in the **Connection Engine** or a **client adapter**
must come with Vitest coverage — these write users' real config files, so correctness and
the backup/rollback guarantees are non‑negotiable.

## Good first issues

- **Add a client adapter** — implement a `FormatAdapter` in
  `src/main/services/clientAdapters.ts` and register its path in
  `src/main/services/paths.ts`. Add round‑trip tests in `test/clientAdapters.test.ts`.
- **Expand the bundled registry** — add vetted servers to
  `resources/registry/servers.json` (include `requiredSecrets` where relevant).
- **Improve the system scanner** — add probes in `src/main/services/systemScanner.ts`.

## Architecture rules

- **One writer.** Only `ConnectionEngine` may write client configs. Everything goes
  through backup → merge → validate → atomic write.
- **Pure where possible.** Config transforms in `clientAdapters.ts` must stay free of
  Node/Electron imports so they remain unit‑testable.
- **No plaintext secrets.** Credentials live in `SecretStore` (OS keychain), never in
  configs committed to disk in cleartext.
- **Preserve unknown keys.** Never clobber settings the app doesn't understand.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Keep PRs focused.
