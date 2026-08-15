/**
 * Projection of injected-context documents from one session's log window.
 * Context messages are durable `user/message` events whose source is not the
 * human — workspace instructions, skill invocations, cross-session recalls —
 * folded by the runtime into `context` chat nodes. This reader is a plain
 * projection over the public snapshot; it owns no state.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ContextDoc } from './types.ts'

/** Concatenate the text blocks of a message body. */
function contentText(content: readonly ContentBlock[]): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/**
 * Project the injected-context documents of one session, oldest first.
 * Unknown sessions and empty context messages produce no rows.
 * @param ctx - client root context (sessions binding lookup).
 * @param sessionId - target session.
 * @returns the session's injected-context documents.
 */
export function readInjectedDocs(ctx: ClientContext, sessionId: SessionId): ContextDoc[] {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return []
  const snapshot = binding.session.getSnapshot()
  const docs: ContextDoc[] = []
  for (const node of snapshot.chat.legacy.nodes) {
    if (node.kind !== 'context') continue
    const text = contentText(node.content).trim()
    if (text === '') continue
    docs.push({
      seq: node.seq,
      time: node.time,
      role: node.provenance.role,
      label: node.provenance.label,
      form: node.form,
      text,
    })
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
