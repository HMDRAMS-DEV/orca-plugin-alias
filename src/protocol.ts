// The panel and worker contract, declared once: src/panel.tsx and worker/main.ts both read it.
export {}

type X = { handle: string; name: string; avatar: string; verified: boolean } | null
type Broken = { name: string; path: string; used: number; fixes: { command: string; why: string }[] }
export type Audit = {
  profile: { agent: string; agents: Record<string, number>; used: { name: string; count: number }[]; neverUsed: string[] }
  broken: Broken[]
  sharedUrl: string | null
  x: X
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    'alias.audit': { input: Record<string, never>; output: Audit }
    'alias.share': { input: { public: boolean }; output: { sharedUrl: string | null } }
    'alias.linkX': { input: { handle: string | null }; output: { x: X } }
    'alias.agent': { input: { task: 'clean-up' | 'fix' }; output: { workspace: string } }
  }
}
