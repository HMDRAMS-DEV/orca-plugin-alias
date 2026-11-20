// The plugin's worker. The panel asks it to read this machine's skills, publish the profile and
// start agents; see src/protocol.ts for the contract.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, cleanUpPrompt, fixPrompt, linkX, saveSetup, share } from './audit.ts'

const PLAN_NEEDS_CLAUDE = 'Clean up needs Claude Code. The plan runs in Claude Plan Mode, which cannot change files.'

export default function activate(orca: OrcaWorkerApi) {
  // Clean up starts Claude in Plan Mode. Plan Mode cannot edit files or run commands, and Claude
  // leaves it only when the person approves the plan. Orca's launch API takes no mode, so this hook
  // adds the flag to the next Claude launch this plugin asks for.
  let planLaunch: { workspaceId: string; until: number; applied: boolean; terminalId?: string } | null = null
  orca.hooks.on('agent.launch.before', (event, next) => {
    if (!planLaunch || planLaunch.applied || Date.now() > planLaunch.until) return
    if (event.workspaceId && event.workspaceId !== planLaunch.workspaceId) return
    if (event.agent !== 'claude') return { deny: PLAN_NEEDS_CLAUDE }
    const command = event.command
      .replace(/\s--dangerously-skip-permissions\b/g, '')
      .replace(/\s--permission-mode(?:=|\s+)\S+/g, '')
    planLaunch.applied = true
    planLaunch.terminalId = event.terminalId
    return next({ ...event, command: `${command} --permission-mode plan` })
  })

  orca.panels.handle('alias.audit', () => audit())
  orca.panels.handle('alias.share', (input) => share(input))
  orca.panels.handle('alias.linkX', (input) => linkX(input))
  orca.panels.handle('alias.agent', async ({ task }) => {
    const ctx = await orca.host.call('workspace.readContext', {})
    if (!ctx?.workspaceId) throw new Error('Open a workspace first. The agent starts in it.')
    if (task === 'fix') {
      const { settings } = await orca.host.call('settings.get', {})
      const agent = String(settings?.agent ?? 'claude')
      await orca.host.call('agent.launch', { workspaceId: ctx.workspaceId, agent: agent as 'claude', prompt: await fixPrompt() })
      return { workspace: ctx.displayName }
    }
    const plan: NonNullable<typeof planLaunch> = { workspaceId: ctx.workspaceId, until: Date.now() + 10_000, applied: false }
    planLaunch = plan
    try {
      const { terminalId } = await orca.host.call('agent.launch', {
        workspaceId: ctx.workspaceId,
        agent: 'claude',
        prompt: cleanUpPrompt(saveSetup()),
      })
      // If the hook did not run on this launch, Claude started without Plan Mode. Close it before the prompt lands.
      if (!plan.applied || (plan.terminalId && plan.terminalId !== terminalId)) {
        await orca.host.call('terminal.close', { terminalId })
        throw new Error('Could not start Claude in Plan Mode, so nothing was started.')
      }
    } finally {
      if (planLaunch === plan) planLaunch = null
    }
    return { workspace: ctx.displayName }
  })
}
