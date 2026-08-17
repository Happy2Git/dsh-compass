/**
 * Projection of injected-context documents from one session's log window.
 * Context messages are durable `user/message` events whose source is not the
 * human — workspace instructions, skill invocations, cross-session recalls —
 * folded by the runtime into `context` chat nodes. This reader is a plain
 * projection over the public snapshot; it owns no state.
 */
import {
  contextForm, contextProvenance, type ClientContext,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ContextDoc, DocOrigin } from './types.ts'

/** Concatenate the text blocks of a message body. */
function contentText(content: readonly ContentBlock[]): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/** UTF-8 byte length of the projected text — the honest size measurement. */
const byteLength = (text: string): number => new TextEncoder().encode(text).length

/**
 * Classify one durable message source by its kind: the same discriminator the
 * runtime's provenance projection reads, so both folds agree. Unknown and
 * absent kinds degrade to `runtime`, never a guess.
 * @param source - the logged `user/message` source, exactly as recorded.
 * @returns the origin classification for presentation.
 */
export function classifyDocOrigin(source: unknown): DocOrigin {
  if (typeof source !== 'object' || source === null) return 'runtime'
  const kind = (source as { kind?: unknown }).kind
  switch (kind) {
    case 'agent-instructions': return 'instructions'
    case 'skill-invocation': return 'skill'
    case 'plugin': return 'plugin'
    case 'session-reference': return 'recall'
    default: return 'runtime'
  }
}

/** The logged-event slice the raw-history fold reads (wire events arrive with this envelope). */
export interface FoldedDocEvent {
  seq: number
  time: number
  surfaceOp?: { op: string } | undefined
  data?: {
    source?: unknown
    content?: readonly ContentBlock[]
  }
}

/**
 * Whether one logged event is a compaction checkpoint's replacement message:
 * a replace surface op whose source carries the compact plugin's marker. The
 * same durable-format check the runtime fold uses to place checkpoint nodes.
 */
function isCompactionCheckpoint(event: FoldedDocEvent): boolean {
  if (event.surfaceOp === undefined || event.surfaceOp.op !== 'replace') return false
  const source = event.data?.source as {
    kind?: unknown
    plugin?: unknown
    compactionId?: unknown
  } | undefined
  return source?.kind === 'plugin' && source.plugin === 'compact' && typeof source.compactionId === 'string'
}

/**
 * Fold one raw history page's events into injected-context documents plus the
 * page's latest compaction boundary. The same provenance/form readers the
 * live fold uses project every durable field, so both sources agree; `active`
 * here is page-local and re-derived at merge time against the global boundary.
 * @param events - the page's raw events (oldest first).
 * @returns the page's documents (non-user `user/message` events with text)
 * and its latest compaction checkpoint seq (-1 when none).
 */
export function foldDocEvents(events: readonly FoldedDocEvent[]): { docs: ContextDoc[]; boundary: number } {
  let boundary = -1
  for (const event of events) {
    if (isCompactionCheckpoint(event) && event.seq > boundary) boundary = event.seq
  }
  const docs: ContextDoc[] = []
  for (const event of events) {
    const source = event.data?.source
    if (source === undefined) continue
    if ((source as { kind?: unknown }).kind === 'user') continue
    const text = contentText(event.data?.content ?? []).trim()
    if (text === '') continue
    const provenance = contextProvenance(source)
    docs.push({
      seq: event.seq,
      time: event.time,
      role: provenance.role,
      origin: classifyDocOrigin(source),
      label: provenance.label,
      form: contextForm(source),
      text,
      bytes: byteLength(text),
      active: event.seq > boundary,
    })
  }
  return { docs, boundary }
}

/**
 * Merge the out-of-band older documents with the live-window fold: dedup by
 * seq (the live fold wins — it is the authoritative projection of the same
 * durable event), sort oldest first, and re-derive `active` against the
 * global compaction boundary (the latest checkpoint either source saw).
 * @param older - the privately pulled older documents.
 * @param live - the live-window fold's documents.
 * @param boundary - the global latest compaction checkpoint seq.
 * @returns the complete merged document list.
 */
export function mergeDocs(
  older: readonly ContextDoc[],
  live: readonly ContextDoc[],
  boundary: number,
): ContextDoc[] {
  const bySeq = new Map<number, ContextDoc>()
  for (const doc of older) bySeq.set(doc.seq, doc)
  for (const doc of live) bySeq.set(doc.seq, doc)
  return [...bySeq.values()]
    .sort((left, right) => left.seq - right.seq)
    .map(doc => ({ ...doc, active: doc.seq > boundary }))
}

/**
 * The latest in-window compaction checkpoint's seq, or null when the loaded
 * window holds no checkpoint. Documents at or before that seq are shadowed
 * (no longer in the model's live window) and belong to the history stream.
 * @param ctx - client root context (sessions binding lookup).
 * @param sessionId - target session.
 * @returns the shadowing boundary, or null when none is loaded.
 */
export function compactionBoundary(ctx: ClientContext, sessionId: SessionId): number | null {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return null
  let latest: number | null = null
  for (const node of binding.session.getSnapshot().chat.legacy.nodes) {
    if (node.kind === 'compaction' && (latest === null || node.seq > latest)) latest = node.seq
  }
  return latest
}

/**
 * Project the injected-context documents of one session, oldest first.
 * Unknown sessions and empty context messages produce no rows. Each document
 * carries an `active` flag: a compaction checkpoint (`kind: 'compaction'`)
 * shadows every document at or before its sequence, so only documents after
 * the latest checkpoint are still in the model's live window.
 * @param ctx - client root context (sessions binding lookup).
 * @param sessionId - target session.
 * @returns the session's injected-context documents.
 */
export function readInjectedDocs(ctx: ClientContext, sessionId: SessionId): ContextDoc[] {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return []
  // One pass over the nodes: collect the compaction boundary and the context
  // documents together (the active flag needs the final boundary, so it is a
  // second pass over the few documents, never over the whole node list).
  let lastCompactionSeq = -1
  const docs: ContextDoc[] = []
  for (const node of binding.session.getSnapshot().chat.legacy.nodes) {
    if (node.kind === 'compaction') {
      if (node.seq > lastCompactionSeq) lastCompactionSeq = node.seq
      continue
    }
    if (node.kind !== 'context') continue
    const text = contentText(node.content).trim()
    if (text === '') continue
    docs.push({
      seq: node.seq,
      time: node.time,
      role: node.provenance.role,
      origin: classifyDocOrigin(node.source),
      label: node.provenance.label,
      form: node.form,
      text,
      bytes: byteLength(text),
      active: true,
    })
  }
  for (const doc of docs) {
    doc.active = doc.seq > lastCompactionSeq
  }
  return docs
}

/**
 * Whether the session log has older pages beyond the loaded window: the
 * baseline workspace instructions land at session start, far outside the
 * tail window, so the panel offers paging to reach them.
 * @param ctx - client root context.
 * @param sessionId - target session.
 * @returns true while more history exists.
 */
export function hasMoreDocs(ctx: ClientContext, sessionId: SessionId): boolean {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return false
  return binding.session.getSnapshot().hasMore
}

/**
 * Page one earlier history batch into the session's loaded window; a later
 * projection read then sees the older injected documents too.
 * @param ctx - client root context.
 * @param sessionId - target session.
 */
export async function loadOlderDocs(ctx: ClientContext, sessionId: SessionId): Promise<void> {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return
  await binding.session.loadOlder()
}
