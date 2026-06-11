# MCP Command Center — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorming complete; "fire at will")
**Author:** Jeff Schatz + Claude

---

## 1. Summary

A standalone, cross-platform **Electron desktop app** that is the single control plane
for every MCP-capable AI client and every MCP server on a machine. It:

- **Detects** MCP-capable AI clients and locates their config files.
- **Connects** clients to servers by safely writing those configs (the "activate" action).
- **Recommends** connections with AI, based on natural-language goals and a system scan.
- **Discovers** new/trending MCP servers from four sources and keeps the catalog current.
- **Tracks** user preferences and pre-stages high-value connections as they emerge.

Final deliverable: a **well-documented public GitHub repo**, installable on Windows and macOS.

### Decisions locked during brainstorming
| Decision | Choice |
|---|---|
| Core engine | **Write client configs directly** (native, local, no required runtime) |
| App host | **New standalone Electron app** (reuse `openclaw-desktop` build/tray patterns) |
| Discovery sources | **All four:** curated registry + auto-refresh, official MCP registry API, live web search, local system scan |
| AI engine | **Anthropic API key** |

---

## 2. Stack

- **Electron** (main process = Node services).
- **React + Vite + TypeScript + Tailwind** (renderer) via `electron-vite`.
- **electron-builder** targets: Windows `nsis` + `portable`; macOS `dmg` + `zip` (x64 + arm64).
- **Vitest** for unit/integration tests.
- **keytar** (or Electron `safeStorage`) for secrets in the OS keychain.

Rationale: this is the de-facto standard, well-documented, cross-platform Electron stack —
easy for others to install, build, and contribute to.

---

## 3. Core Modules (isolated, single-purpose)

### 3.1 Client Detector
Cross-platform path map locating MCP-capable clients and their config files, returning each
client plus its current server entries.

v1 targets: Claude Desktop, Claude Code, Cursor, VS Code (+ Cline), Windsurf, Continue, Zed.
OpenClaw gateway is included as a manageable target where applicable.

- **Input:** none (scans known locations per OS).
- **Output:** `DetectedClient[]` `{ id, name, configPath, format, installed, servers: ServerEntry[] }`.
- **Depends on:** OS path conventions, per-client config schema adapters.

### 3.2 Connection Engine — *the heart*
The only module that writes configs. **Safe writes always:**
1. Timestamped backup of the target file.
2. JSON merge that preserves unknown/unrelated keys.
3. Schema-validate the result.
4. Atomic write (temp file + rename).
5. Rollback from backup on any failure.

Provides `connect(clientId, serverSpec)`, `disconnect(clientId, serverId)`,
`preview(plan) -> diff`, `restore(clientId, backupId)`.

- **Depends on:** per-client config adapters, Secrets Manager, fs.

### 3.3 Server Catalog
Normalizes available servers from four sources into one `ServerSpec`:
`{ id, name, description, command, args, env, requiredSecrets, transport, tags, source, homepage }`.

Sources: bundled curated registry (JSON, ships with app), remote auto-refresh (fetch newer
catalog), official MCP registry API, live web search. Source precedence + dedupe by id/name.

### 3.4 System Scanner
Inspects installed apps, running processes, and known config dirs to detect tools that *have*
an MCP server (Docker, Postgres, GitHub CLI, Notion, Spotify, etc.) and proposes wiring them.
Feeds "suggested defaults."

### 3.5 AI Advisor (Anthropic API)
Turns a natural-language request into a concrete **connection plan** (servers × clients),
generates suggested defaults from the scan, and **prepares but never auto-applies** — the user
reviews a diff before anything is written. Context passed: detected clients, catalog, prefs.

### 3.6 Trend Watcher
Background job: periodically refresh catalog, query official registry + web for new/trending
servers, diff against installed + prefs, surface "New & Relevant" cards, and pre-stage
ready-to-apply bundles. Respects dismissed suggestions.

### 3.7 Preferences & Profiles
Stores prefs, learned choices, dismissed suggestions, and reusable **presets**
("Dev stack," "Productivity stack") appliable across clients.

### 3.8 Secrets Manager
API keys/credentials in the OS keychain; never plaintext in configs. Client configs reference
env/secret handles where the format allows.

---

## 4. UI Surfaces

- **Dashboard** — detected clients, active-connection count, health, suggested defaults,
  "New & Relevant" trend cards.
- **Connection Matrix** *(centerpiece)* — grid of clients (columns) × servers (rows);
  click a cell to connect/disconnect; bulk + per-cell status.
- **Catalog** — searchable browse of all known servers; "Add to…".
- **AI Assistant** — describe a goal → recommended bundle → preview diff → apply.
- **Profiles** — save/apply bundles.
- **Settings** — Anthropic API key, refresh cadence, source toggles, backup location.

---

## 5. Data Flow

- **Launch:** Client Detector + System Scanner run → populate state. Catalog loads bundled
  registry, kicks async refresh (remote/official/web). AI Advisor computes suggested defaults.
  Trend Watcher schedules periodic refresh.
- **Toggle / apply:** Connection Engine backs up → merges → validates → atomic write →
  updates state + health.
- **AI request:** Advisor → Anthropic with system context → proposed plan → user reviews diff
  → apply.

---

## 6. Safety & Error Handling

- Never write a config without a timestamped backup; keep last N; one-click restore.
- All writes: merge (preserve unknown keys) + JSON-validate + atomic temp/rename.
- Mandatory preview-diff before any AI-driven apply.
- Secrets in keychain.
- Detect running clients; flag "restart needed."

---

## 7. Testing

- Vitest unit tests per client config format using real-file fixtures in a temp sandbox
  (read/merge/write round-trips).
- Catalog normalization + dedupe tests.
- Plan generation tests (advisor output → valid plan).
- Integration: connect → disconnect on a fixture leaves it byte-clean except the intended entry.

---

## 8. Shipping (hard requirement)

Public repo `mcp-command-center`:
- README with screenshots + Windows/macOS install instructions + dev setup.
- LICENSE (MIT), `docs/`, CONTRIBUTING.
- GitHub Actions CI builds/releases installers for both platforms on tag.

---

## 9. Build Order (decomposed — proto first, then ship)

Every requested pillar is represented in the proto; depth grows in later phases.

- **Phase 1 — Foundation:** Client Detector + Connection Engine (safe writes/backups) +
  Connection Matrix + Catalog (bundled registry) + Settings/API key + Dashboard shell +
  Secrets Manager. *Already a usable command center.*
- **Phase 2 — Intelligence:** AI Advisor (NL→plan + diff/apply) + System Scanner +
  suggested defaults.
- **Phase 3 — Currency:** Trend Watcher (official registry API + web search + auto-refresh) +
  Profiles/presets + notifications + preferences tracking.
- **Phase 4 — Ship:** cross-platform packaging, CI, README/screenshots/docs, public release.

**"Fully functional prototype"** to review = end of Phase 3 (every pillar working).
Phase 4 is the GitHub publish.

---

## 10. Out of Scope (YAGNI for v1)

- Running an MCP aggregator/proxy hub (schema stays compatible for a future phase).
- Non-Anthropic AI providers (abstraction can be added later).
- Mobile / web-hosted versions.
- Remote/multi-machine fleet management.
