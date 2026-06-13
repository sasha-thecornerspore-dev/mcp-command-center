# Server credential identities — design

Date: 2026-06-12
Status: approved for planning

## Problem

Some MCP servers accept multiple credentials with different privilege levels — e.g. an
OPNsense firewall with a day-to-day user key and a root key. Today a server in MCP
Command Center has exactly one set of secret values, so switching privilege means
manually editing client configs or running an external script. We want a first-class,
generic way to define multiple named credential sets per server and switch between
them with one click.

Motivating case: an `opnsense` stdio server (`npx @richard-stovall/opnsense-mcp-server`)
with `sasha` and `root` API keys, applied to Claude Code (`~/.claude.json`) and Claude
Desktop. The existing external PowerShell switcher verifies the key against the
firewall before touching any config; this feature preserves that behavior generically.

## Concept

A server may own a list of **identities**. Each identity is a named set of values for
the server's `requiredSecrets`, with an optional **health check**. Exactly one identity
is active. Switching identities:

1. runs the health check, if defined (failure blocks the switch);
2. flips the active pointer;
3. re-applies the server to every client that currently has it, through the existing
   ConnectionEngine (same merge, backup, and restart-hint machinery).

Servers without identities behave exactly as today.

## Data model (`src/shared/types.ts`)

```ts
/** A named credential set for a server (e.g. "sasha", "root"). */
export interface ServerIdentity {
  id: string        // slug, unique within the server
  label: string
  healthCheck?: IdentityHealthCheck
}

/** Optional pre-switch verification request. */
export interface IdentityHealthCheck {
  url: string                    // e.g. https://fw.example/api/core/firmware/status
  method?: 'GET' | 'POST'        // default GET
  auth: 'basic' | 'bearer' | 'none'
  /** Secret keys (of this server) used to build the auth header. */
  usernameSecretKey?: string     // basic: username side (e.g. OPNSENSE_API_KEY)
  passwordSecretKey?: string     // basic: password side; bearer: the token
  skipTlsVerify?: boolean        // self-signed firewall certs
}

/** Per-server identity state, persisted in the store (no secret values here). */
export interface ServerIdentityConfig {
  serverId: string
  identities: ServerIdentity[]
  activeIdentityId: string
}
```

Secret **values** never appear in these types or in `store.json`. They live in the
existing `SecretStore` (Electron safeStorage → DPAPI/Keychain) under namespaced keys:

```
identity:<serverId>:<identityId>:<secretKey>
e.g. identity:opnsense:root:OPNSENSE_API_KEY
```

`AppState` gains `identityConfigs: ServerIdentityConfig[]` plus
`identitySecretsPresent: Record<string, string[]>` mapping
`"<serverId>:<identityId>"` to the secret keys that have a stored value. That map
contains key *names* only, never values — secrets are write-only and never read back
to the UI.

## Persistence (`store.ts`)

`Persisted` gains `identityConfigs: ServerIdentityConfig[]` (default `[]`). Store
methods: `getIdentityConfigs()`, `saveIdentityConfig(cfg)`, `deleteIdentityConfig(serverId)`.
Same JSON-file pattern as profiles.

## Identity service (`src/main/services/identities.ts`, new)

The one place that understands identities:

- `resolveForServer(serverId, keys): Record<string, string> | undefined` — if the
  server has an identity config, return the active identity's secret values for
  `keys` (from the namespaced SecretStore entries); otherwise `undefined`.
- `runHealthCheck(serverId, identityId): Promise<{ ok: boolean; status?: number; error?: string }>`
  — builds the request from `IdentityHealthCheck` + that identity's secrets, executes
  with a 10s timeout, honoring `skipTlsVerify`. Pure data-in/data-out so it unit-tests
  with a mocked fetch.
- `switchIdentity(serverId, identityId): Promise<SwitchResult>` — health check (if
  defined) → update `activeIdentityId` → build a `ConnectionPlan` of `connect` items
  for every detected client that currently has the server → `engine.apply(plan)`.
  Returns `{ healthCheck, applyResults, restartHints }`.

## ConnectionEngine integration

`SecretResolver` changes signature from `(keys) => values` to
`(serverId: string, keys: string[]) => Record<string, string>` (one call site in
`computeNext`). The composition in `services/index.ts` becomes: try
`identities.resolveForServer(serverId, keys)` first, fall back to the current
`secretStore.resolve(keys)`. No other engine changes — backups, atomic writes, and
restore are untouched.

## IPC (`shared/types.ts` IPC map, `main/ipc.ts`, `preload`, `renderer/api.ts`)

- `identities:save` — upsert a `ServerIdentityConfig` plus optional
  `{ [identityId]: { [secretKey]: value } }` secret payload (write-only).
- `identities:switch` — `{ serverId, identityId }` → `SwitchResult`.
- `identities:test` — `{ serverId, identityId }` → health check result (the modal's
  Test button; does not switch or write).
- `identities:delete` — remove a server's identity config and its namespaced secrets.

## UI (renderer)

**Server card identity row** (Dashboard and Matrix wherever a connected server with an
identity config renders): `Identity: <active label>` with a verified badge after a
successful switch/test (ephemeral, session-only — not persisted), a dropdown listing identities (`verify & switch` action), and
`Manage identities…`. Servers without identity configs show an `Add identities…`
affordance in the server's overflow/detail menu only — no extra chrome on the common
case.

**Identity editor modal** (new component, follows `PlanReviewModal` conventions):
list identities, add/remove/rename; per identity, one password-type input per
`requiredSecret` of the server (placeholder shows "set" / "not set"; saving a
non-empty value overwrites, blank leaves unchanged); optional health check section
(url, method, auth style, secret-key pickers, skipTlsVerify checkbox); Test button.

**Switch feedback**: toast/inline result — health check status, per-client apply
results, and restart hints (reusing `ApplyResult` rendering from profile apply).

## Error handling

- Health check fails → switch blocked; dropdown row shows the failure (HTTP status or
  error string); nothing is written.
- Apply fails for a client → existing per-client `ApplyResult.error` + backup/restore
  path; other clients proceed; the active pointer stays flipped (config and reality
  may diverge per-client — surfaced in the results UI, consistent with profile apply).
- Active identity deleted → config falls back to the first remaining identity; if
  none remain, the config is deleted and the server reverts to plain secret resolution.
- Missing secret values at switch time → treated like `missingSecrets` in plans: the
  switch is blocked with a list of unset keys.

## Testing (vitest)

- `identities.test.ts`: resolveForServer precedence (identity values win, fallback
  works, unset keys omitted); switchIdentity flow with mocked engine + health check
  (blocked on failure, plan targets exactly the clients that have the server).
- `healthCheck.test.ts`: request construction for basic/bearer/none, timeout, and
  skipTlsVerify handling with a mocked fetch/agent.
- Adapter-level: applying a switched identity produces correct env in both
  `claude-code` and `claude-desktop` config output.

## Out of scope

- Importing identities from external stores (the user pastes values once).
- Per-client identity overrides (one active identity per server, globally).
- Scheduled/auto-revert switching (e.g. "drop back to low-priv after 1h").
- Migrating the motivating OPNsense setup is a post-ship configuration step, not code.
