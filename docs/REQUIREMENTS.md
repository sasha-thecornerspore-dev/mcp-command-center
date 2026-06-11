# Requirements & prerequisites

There are **two layers** to "functional," and the app handles them differently.

## Layer 1 — the app itself (fully bundled)

The installer ships everything the Command Center needs to run:

- the **Electron runtime** (Chromium + Node) — no system Node required to run the app,
- the **compiled app** (main / preload / renderer),
- the **Anthropic SDK** (bundled into the main process — not loaded from `node_modules`),
- the **bundled server registry**.

Nothing else is required to install and open the app. ✅

## Layer 2 — the MCP servers it wires (need a host runtime)

This is the important nuance: **the Command Center does not run your MCP servers.** It writes
each AI client's config, and the *client* (Claude Desktop, Cursor, …) launches the server
process when it starts. Those server processes need a runtime on your machine:

| Server type | Launch | Needs | Examples |
|---|---|---|---|
| Node / npm | `npx -y …` | **Node.js** (provides `npx`) | filesystem, github, memory, brave-search, notion, playwright, … |
| Python | `uvx …` | **uv** (provides `uvx`, auto-manages Python) | git, fetch, time, sqlite |
| Container | `docker …` | **Docker** | (optional, "full" build) |

Plus the obvious: the **AI client** itself must be installed, and any server needing an API
key/token needs that secret (the app prompts and stores it encrypted).

## How the app handles Layer 2

Open the **Setup** tab. It:

1. **Examines your system** — detects Node, uv/uvx, Python, Git, Docker (with versions) and which
   package managers are available (winget/choco/scoop on Windows, Homebrew on macOS, apt/dnf/pacman on Linux).
2. Lets you pick a **base build**:
   - **Minimal** — Node only (the npx servers).
   - **Standard** *(default)* — Node + uv (adds the Python servers).
   - **Full** — adds Docker for container servers.
3. For each missing runtime, shows the **best install route** for your machine — the exact command,
   a **Copy** button, and a one-click **Install** button when it's safe to run unattended
   (e.g. `winget install -e --id astral-sh.uv`). Commands needing elevation (Linux `sudo`) or a
   heavy GUI installer (Docker Desktop) are shown to copy/run yourself, with a manual download link.

The **Connection Matrix** also flags any server whose runtime is missing with a small badge
(e.g. *needs uv*), so you know a wiring will be inert until you install that runtime.

> The app never installs system software silently — every install is an explicit click with the
> command shown, matching the same "review before apply" model used for config writes.

## What we deliberately do **not** bundle

We don't ship Node/Python/Docker inside the installer. They're large, they're shared system
tooling your AI clients use directly, and `npx`/`uvx` fetch server packages from the network on
first launch anyway. Detecting + guiding installation is lighter and keeps your runtimes
canonical. (Bundling a private Node is a possible future "fully self-originating" option.)
