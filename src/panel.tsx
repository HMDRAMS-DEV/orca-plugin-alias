// The Skill usage panel. Every read and write of this machine goes through the worker.
import {
  atom, Badge, Box, Button, Callout, Card, Code, Collapsible, Heading, Input, Link, Progress, read, Row, set, Spinner, Stack, Text, update,
  plugin, type PanelContext
} from 'orca'
import type { Audit } from './protocol'

const SHORT = 10
const COMMUNITY = 'https://alias.computer/skills'

const data = atom<Audit | null>(null)
const error = atom<string | null>(null)
const busy = atom<string | null>(null)
const notice = atom<string | null>(null)
const confirmShare = atom(false)
const handle = atom('')
const allUsed = atom(false)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function load() {
  set(error, null)
  try {
    set(data, await plugin.request('alias.audit', {}, { timeoutMs: 60000 }))
  } catch (e) {
    set(error, message(e))
  }
}

async function run(label: string, job: () => Promise<void>) {
  set(busy, label)
  set(notice, null)
  try {
    await job()
  } catch (e) {
    set(notice, message(e))
  } finally {
    set(busy, null)
  }
}

const startAgent = (task: 'clean-up' | 'fix') =>
  run(task, async () => {
    const { workspace } = await plugin.request('alias.agent', { task })
    set(notice, `Agent started in ${workspace}.`)
  })

const share = (on: boolean) =>
  run('share', async () => {
    const { sharedUrl } = await plugin.request('alias.share', { public: on })
    set(confirmShare, false)
    update(data, (d) => (d ? { ...d, sharedUrl } : d))
  })

const linkX = (h: string | null) =>
  run('x', async () => {
    const { x } = await plugin.request('alias.linkX', { handle: h })
    update(data, (d) => (d ? { ...d, x } : d))
  })

export function setup(_ctx: PanelContext) {
  void load()
}

function UsageRow({ name, count, top }: { name: string; count: number; top: number }) {
  return (
    <Box direction="row" gap="sm" align="center">
      <Box width="40%"><Text size="sm" truncate>{name}</Text></Box>
      <Box grow={1}><Progress label={name} labelHidden value={Math.round((count / top) * 100)} /></Box>
      <Box width={32}><Text size="sm" muted>{count}</Text></Box>
    </Box>
  )
}

function ShareCard({ d }: { d: Audit }) {
  const working = read(busy)
  if (!d.sharedUrl) {
    return (
      <Card title="Share your profile" description="Put the skill names and use counts above on a public page, so other people can see what you use.">
        {read(confirmShare) ? (
          <Callout tone="warning" title="Make your profile public?">
            <Stack gap="sm">
              <Text size="sm">Anyone with the link sees your skill names and use counts. Your skill contents and file paths stay on this machine. You can stop sharing at any time.</Text>
              <Row gap="xs">
                <Button tone="accent" onPress={() => void share(true)} disabled={!!working}>{working === 'share' ? 'Sharing…' : 'Share'}</Button>
                <Button variant="ghost" onPress={() => set(confirmShare, false)}>Cancel</Button>
              </Row>
            </Stack>
          </Callout>
        ) : (
          <Row><Button tone="accent" onPress={() => set(confirmShare, true)}>Share</Button></Row>
        )}
      </Card>
    )
  }
  const x = d.x
  return (
    <Card title="Your profile is public">
      <Stack gap="sm">
        <Code block>{d.sharedUrl}</Code>
        <Row gap="xs" wrap>
          <Link href={d.sharedUrl}>Open</Link>
          <Button variant="outline" size="sm" onPress={() => void share(true)} disabled={!!working}>{working === 'share' ? 'Updating…' : 'Update'}</Button>
          <Button variant="ghost" size="sm" onPress={() => void share(false)} disabled={!!working}>Stop sharing</Button>
        </Row>
        {x ? (
          <Stack gap="xs">
            <Row gap="xs">
              <Text size="sm">{x.name} @{x.handle}</Text>
              <Badge tone={x.verified ? 'success' : 'warning'}>{x.verified ? 'verified' : 'not verified'}</Badge>
            </Row>
            {x.verified ? null : <Text size="sm" muted>To prove this account is yours, add the link above to your X bio or website, then check again.</Text>}
            <Row gap="xs">
              <Button variant="outline" size="sm" onPress={() => void linkX(x.handle)} disabled={!!working}>{working === 'x' ? 'Checking…' : 'Check again'}</Button>
              <Button variant="ghost" size="sm" onPress={() => void linkX(null)} disabled={!!working}>Remove</Button>
            </Row>
          </Stack>
        ) : (
          <Stack gap="xs">
            <Text size="sm" muted>Add your X account so people can see whose profile this is. It shows your name and picture.</Text>
            <Row gap="xs">
              <Input label="Your X handle" labelHidden placeholder="@handle" value={read(handle)} onChange={(v) => set(handle, v)} onSubmit={(v) => v.trim() && void linkX(v.trim())} />
              <Button variant="outline" onPress={() => read(handle).trim() && void linkX(read(handle).trim())} disabled={!!working}>{working === 'x' ? 'Linking…' : 'Link X'}</Button>
            </Row>
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

export default function Panel() {
  const err = read(error)
  const d = read(data)
  if (err) {
    return (
      <Callout tone="danger" title="Could not read your skills">
        <Stack gap="sm"><Text size="sm">{err}</Text><Row><Button onPress={() => void load()}>Try again</Button></Row></Stack>
      </Callout>
    )
  }
  if (!d) return <Spinner label="Reading your skills…" />

  const { used, neverUsed, agent } = d.profile
  const installed = used.length + neverUsed.length
  const top = used[0]?.count ?? 1
  const shown = read(allUsed) ? used : used.slice(0, SHORT)
  const working = read(busy)
  const note = read(notice)

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading>You use {used.length} of your {installed} skills</Heading>
        <Text size="sm" muted>Counted from the logs these agents keep on this machine: {agent}.</Text>
      </Stack>
      {note ? <Text size="sm" tone="accent">{note}</Text> : null}

      {used.length > 0 ? (
        <Stack gap="xs">
          <Heading level={2}>Most used</Heading>
          {shown.map((u) => <UsageRow key={u.name} name={u.name} count={u.count} top={top} />)}
          {used.length > SHORT && !read(allUsed) ? <Row><Button variant="ghost" size="sm" onPress={() => set(allUsed, true)}>Show all {used.length}</Button></Row> : null}
        </Stack>
      ) : null}

      {neverUsed.length > 0 ? (
        <Collapsible title={`Never used (${neverUsed.length})`}>
          <Text size="sm" muted>{neverUsed.join(', ')}</Text>
        </Collapsible>
      ) : null}

      {d.broken.length > 0 ? (
        <Collapsible title={`Broken (${d.broken.length})`} description="These links point to a folder that is gone, so your agent cannot load the skill." defaultOpen>
          <Stack gap="sm">
            <Row><Button tone="accent" onPress={() => void startAgent('fix')} disabled={!!working}>{working === 'fix' ? 'Starting…' : 'Fix with an agent'}</Button></Row>
            <Text size="sm" muted>Or run a command yourself.</Text>
            {d.broken.map((b) => (
              <Card key={b.path} title={b.name} description={b.used ? `used ${b.used} times` : 'never used'}>
                <Stack gap="xs">
                  <Text size="xs" muted>{b.path}</Text>
                  {b.fixes.map((f) => (
                    <Stack key={f.command} gap="xs">
                      <Text size="sm" muted>{f.why[0].toUpperCase() + f.why.slice(1)}.</Text>
                      <Code block>{f.command}</Code>
                    </Stack>
                  ))}
                </Stack>
              </Card>
            ))}
          </Stack>
        </Collapsible>
      ) : null}

      <Card title="Clean up" description="Starts an agent with this audit. It looks for duplicate, unused and outdated skills, and drafts AGENTS.md edits that point each project at the skills it needs. It plans in Claude Plan Mode, which cannot change files. Nothing changes until you approve the plan.">
        <Row><Button tone="accent" onPress={() => void startAgent('clean-up')} disabled={!!working}>{working === 'clean-up' ? 'Starting…' : 'Audit your skills'}</Button></Row>
      </Card>

      <ShareCard d={d} />

      <Row justify="between">
        <Link href={COMMUNITY}>See what other people use</Link>
        <Button variant="ghost" size="sm" icon="refresh" onPress={() => void load()}>Refresh</Button>
      </Row>
    </Stack>
  )
}
