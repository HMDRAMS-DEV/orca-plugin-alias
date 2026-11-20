import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { publicProfile } from './vendor/core/setup.mjs'
import { scanSetup } from './vendor/lib/setup.mjs'

type Setup = {
  conflicts: {
    items: { kind: string; name: string; paths: string[]; used?: number; fixes?: { command: string; why: string }[] }[]
  }
}
export type X = { handle: string; name: string; avatar: string; verified: boolean }
type Config = { id?: string; token?: string; visibility?: string; x?: X | null }

// The same file the alias CLI and the Paseo plugin use, so all of them publish to one profile.
const CONFIG = path.join(os.homedir(), '.alias', 'config.json')
const HOST = process.env.ALIAS_API || 'https://alias.computer'

function loadConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(cfg: Config): void {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true })
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

const scan = (): Setup => scanSetup({ home: os.homedir(), cwd: os.homedir(), env: process.env })
const sharedUrl = (cfg: Config) => (cfg.id && cfg.visibility === 'public' ? `${HOST}/s/${cfg.id}` : null)

export async function audit() {
  const setup = scan()
  const cfg = loadConfig()
  return {
    profile: publicProfile(setup),
    broken: setup.conflicts.items
      .filter((c) => c.kind === 'broken')
      .map((c) => ({ name: c.name, path: c.paths[0] ?? '', used: c.used ?? 0, fixes: c.fixes ?? [] })),
    sharedUrl: sharedUrl(cfg),
    x: cfg.x ?? null
  }
}

async function call(method: string, route: string, body: unknown, token?: string) {
  const res = await fetch(HOST + route, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-alias-client': 'orca-plugin/0.1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as { id?: string; token?: string; error?: string; x?: X | null }
  if (!res.ok) throw Object.assign(new Error(data.error || `alias.computer answered ${res.status}`), { status: res.status })
  return data
}

export async function share({ public: makePublic }: { public: boolean }) {
  let cfg = loadConfig()
  if (!makePublic) {
    if (cfg.id) await call('PATCH', `/api/setups/${cfg.id}`, { visibility: 'private' }, cfg.token)
    saveConfig({ ...cfg, visibility: 'private' })
    return { sharedUrl: null }
  }
  const body = { visibility: 'public', profile: publicProfile(scan()) }
  let res
  try {
    res = await call('POST', cfg.id ? `/api/setups/${cfg.id}` : '/api/setups', body, cfg.token)
  } catch (e) {
    // The saved profile was deleted on alias: start a new one.
    if (!cfg.id || (e as { status?: number }).status !== 404) throw e
    cfg = {}
    res = await call('POST', '/api/setups', body)
  }
  cfg = { ...cfg, id: res.id, token: res.token ?? cfg.token, visibility: 'public' }
  saveConfig(cfg)
  return { sharedUrl: sharedUrl(cfg) }
}

// alias.computer looks the account up and checks whether its bio links to the profile.
export async function linkX({ handle }: { handle: string | null }) {
  const cfg = loadConfig()
  if (!cfg.id) throw new Error('Share your profile first.')
  const { x = null } = await call('PATCH', `/api/setups/${cfg.id}`, { x: handle }, cfg.token)
  saveConfig({ ...cfg, x })
  return { x }
}

// Writes the full scan next to the config, so the cleanup agent reads it and installs nothing.
export function saveSetup(): string {
  const file = path.join(os.homedir(), '.alias', 'setup.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(scan(), null, 2), { mode: 0o600 })
  return file
}

export const cleanUpPrompt = (file: string) => `Clean up the skills installed on this machine. Work in five steps and stop after the plan.

1. Read the audit. The alias plugin just wrote it to ${file}. It lists every installed skill, how many times each was used, duplicates and broken links. Do not download or install anything to redo it.
2. Check for updates. For each skill, find where it came from (a git remote, a plugin marketplace, or a skills lock file) and check whether a newer version exists. Say so when you cannot tell.
3. Consolidate. Claude Code reads ~/.claude/skills. Codex, Gemini CLI and Cursor read ~/.agents/skills (Gemini also ~/.gemini/skills, Codex also ~/.codex/skills). For each skill that exists as separate copies in these folders, or that one agent has and another agent that should have it lacks, propose one real copy in ~/.agents/skills with symlinks from the other agent folders. When copies differ, say which is newer and keep that one. Leave plugin, bundled and project skills where they are.
4. Check agent instructions. Read the global instruction files (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md) and the AGENTS.md or CLAUDE.md in each project the usage log shows. For each one, work out what the project is about and which installed skills fit it. Draft a short edit that names those skills and when to use them. Skip a file when it already covers this.
5. Plan. Show me one table: duplicates to remove and which copy to keep, copies to consolidate into one with links, skills that were never used or not used in 90 days, and skills with an update. Give the exact command for each row. Then show each instruction file edit as a diff.

You are in Plan Mode, so you cannot change anything yet. When the plan is ready, submit it for my approval. I may approve only some rows or some edits. After I approve, make only those changes. Then give me a short summary: how many skills were removed, how many were updated, which instruction files changed, and anything that failed or that you skipped, with the reason.`

export async function fixPrompt(): Promise<string> {
  const { broken } = await audit()
  return `These skill links point to a folder that is gone, so the skill cannot load. Check each link, then fix it with one of the commands listed under it. Do not change anything else. When you finish, tell me what you ran.\n\n${broken
    .map((b) => `- ${b.name}: ${b.path}\n${b.fixes.map((f) => `  ${f.why}: ${f.command}`).join('\n')}`)
    .join('\n')}`
}
