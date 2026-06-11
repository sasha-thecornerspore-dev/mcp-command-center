import { execSync, exec } from 'child_process'
import { platform } from 'os'
import type {
  InstallResult,
  InstallRoute,
  RuntimeStatus,
  SystemReadiness,
  Runtime
} from '../../shared/types'

type OS = 'win32' | 'darwin' | 'linux'

function probe(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .toString()
      .trim()
      .split('\n')[0]
  } catch {
    return null
  }
}

function firstWorking(cmds: string[]): string | null {
  for (const c of cmds) {
    const v = probe(c)
    if (v) return v
  }
  return null
}

interface RuntimeDef {
  id: string
  name: string
  binary: string
  versionCmds: string[]
  purpose: string
  satisfies?: Runtime
}

const RUNTIMES: RuntimeDef[] = [
  {
    id: 'node',
    name: 'Node.js (npx)',
    binary: 'node',
    versionCmds: ['node --version'],
    purpose: 'Runs the many npx-based MCP servers (filesystem, github, search, …).',
    satisfies: 'node'
  },
  {
    id: 'uv',
    name: 'uv (uvx)',
    binary: 'uvx',
    versionCmds: ['uvx --version', 'uv --version'],
    purpose: 'Runs Python MCP servers (git, fetch, time, sqlite) and auto-manages Python.',
    satisfies: 'python'
  },
  {
    id: 'python',
    name: 'Python',
    binary: 'python',
    versionCmds: ['python --version', 'python3 --version'],
    purpose: 'Fallback runtime for Python servers if you prefer pip over uv.'
  },
  {
    id: 'git',
    name: 'Git',
    binary: 'git',
    versionCmds: ['git --version'],
    purpose: 'Required by the Git MCP server and useful for many dev workflows.'
  },
  {
    id: 'docker',
    name: 'Docker',
    binary: 'docker',
    versionCmds: ['docker --version'],
    purpose: 'Runs container-based MCP servers (optional, "full" build only).',
    satisfies: 'docker'
  }
]

function detectPackageManagers(os: OS): string[] {
  const candidates: Record<OS, [string, string][]> = {
    win32: [
      ['winget', 'winget --version'],
      ['choco', 'choco --version'],
      ['scoop', 'scoop --version']
    ],
    darwin: [['brew', 'brew --version']],
    linux: [
      ['apt', 'apt-get --version'],
      ['dnf', 'dnf --version'],
      ['pacman', 'pacman --version'],
      ['brew', 'brew --version']
    ]
  }
  return candidates[os].filter(([, cmd]) => probe(cmd) !== null).map(([id]) => id)
}

// command, manualUrl, canAutoRun per (runtime, manager)
const INSTALL: Record<string, Record<string, [string, boolean]>> = {
  node: {
    winget: ['winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements', true],
    choco: ['choco install nodejs-lts -y', true],
    scoop: ['scoop install nodejs-lts', true],
    brew: ['brew install node', true],
    apt: ['sudo apt-get install -y nodejs npm', false],
    dnf: ['sudo dnf install -y nodejs', false],
    pacman: ['sudo pacman -S --noconfirm nodejs npm', false]
  },
  uv: {
    winget: ['winget install -e --id astral-sh.uv --accept-package-agreements --accept-source-agreements', true],
    choco: ['choco install uv -y', true],
    scoop: ['scoop install uv', true],
    brew: ['brew install uv', true],
    apt: ['curl -LsSf https://astral.sh/uv/install.sh | sh', false],
    dnf: ['curl -LsSf https://astral.sh/uv/install.sh | sh', false],
    pacman: ['curl -LsSf https://astral.sh/uv/install.sh | sh', false]
  },
  python: {
    winget: ['winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements', true],
    choco: ['choco install python -y', true],
    scoop: ['scoop install python', true],
    brew: ['brew install python', true],
    apt: ['sudo apt-get install -y python3 python3-pip', false],
    dnf: ['sudo dnf install -y python3 python3-pip', false],
    pacman: ['sudo pacman -S --noconfirm python python-pip', false]
  },
  git: {
    winget: ['winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements', true],
    choco: ['choco install git -y', true],
    scoop: ['scoop install git', true],
    brew: ['brew install git', true],
    apt: ['sudo apt-get install -y git', false],
    dnf: ['sudo dnf install -y git', false],
    pacman: ['sudo pacman -S --noconfirm git', false]
  },
  docker: {
    winget: ['winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements', false],
    brew: ['brew install --cask docker', false]
  }
}

const MANUAL_URL: Record<string, string> = {
  node: 'https://nodejs.org/',
  uv: 'https://docs.astral.sh/uv/getting-started/installation/',
  python: 'https://www.python.org/downloads/',
  git: 'https://git-scm.com/downloads',
  docker: 'https://www.docker.com/products/docker-desktop/'
}

function routesFor(runtimeId: string, managers: string[]): InstallRoute[] {
  const table = INSTALL[runtimeId] ?? {}
  const routes: InstallRoute[] = []
  for (const mgr of managers) {
    const entry = table[mgr]
    if (entry) {
      routes.push({
        runtimeId,
        manager: mgr,
        command: entry[0],
        manualUrl: MANUAL_URL[runtimeId] ?? '',
        canAutoRun: entry[1]
      })
    }
  }
  routes.push({
    runtimeId,
    manager: 'manual',
    command: '',
    manualUrl: MANUAL_URL[runtimeId] ?? '',
    canAutoRun: false
  })
  return routes
}

export function getReadiness(): SystemReadiness {
  const os = platform() as OS
  const managers = detectPackageManagers(os)

  const runtimes: RuntimeStatus[] = RUNTIMES.map((r) => {
    const version = firstWorking(r.versionCmds)
    return {
      id: r.id,
      name: r.name,
      binary: r.binary,
      present: version !== null,
      version: version ?? undefined,
      purpose: r.purpose,
      satisfies: r.satisfies
    }
  })

  const present = (id: string): boolean => runtimes.find((r) => r.id === id)?.present ?? false

  const routes: InstallRoute[] = []
  for (const r of runtimes) {
    if (!r.present) routes.push(...routesFor(r.id, managers))
  }

  return {
    os,
    packageManagers: managers,
    runtimes,
    routes,
    ready: {
      node: present('node'),
      python: present('uv') || present('python'),
      docker: present('docker')
    }
  }
}

/** Run an install command (the user explicitly consented via the UI). */
export function runInstall(runtimeId: string, command: string): Promise<InstallResult> {
  return new Promise((resolve) => {
    if (!command) {
      resolve({ runtimeId, ok: false, output: 'No command to run.' })
      return
    }
    exec(command, { timeout: 8 * 60 * 1000, windowsHide: true }, (err, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim()
      resolve({ runtimeId, ok: !err, output: output || (err ? String(err) : 'Done.') })
    })
  })
}
