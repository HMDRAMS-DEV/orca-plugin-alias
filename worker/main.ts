// The plugin's worker. The panel asks it to read this machine's skills, publish the profile and
// start agents; see src/protocol.ts for the contract.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, cleanUpPrompt, fixPrompt, linkX, saveSetup, share } from './audit.ts'

export default function activate(orca: OrcaWorkerApi) {
  orca.panels.handle('alias.audit', () => audit())
  orca.panels.handle('alias.share', (input) => share(input))
  orca.panels.handle('alias.linkX', (input) => linkX(input))
  orca.panels.handle('alias.agent', async ({ task }) => {
    const ctx = await orca.host.call('workspace.readContext', {})
    if (!ctx?.workspaceId) throw new Error('Open a workspace first. The agent starts in it.')
    const { settings } = await orca.host.call('settings.get', {})
    const agent = String(settings?.agent ?? 'claude')
    const prompt = task === 'clean-up' ? cleanUpPrompt(saveSetup()) : await fixPrompt()
    await orca.host.call('agent.launch', { workspaceId: ctx.workspaceId, agent: agent as 'claude', prompt })
    return { workspace: ctx.displayName }
  })
}
