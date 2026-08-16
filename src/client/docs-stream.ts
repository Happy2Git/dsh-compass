/**
 * One bare observable over the panel's document stream: the current session's
 * injected-document signature plus the session id. The value moves EXACTLY
 * when the projected documents change — new injections, a compaction boundary
 * move, or a session switch — and stays put across ordinary stream batches,
 * so the panel re-projects only on real changes instead of re-rendering per
 * batch during a streaming turn. Owned by the plugin's inject `hooks`
 * compartment; components never see this module.
 */
import type {
  ClientContext, ObservableSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { readInjectedDocs } from './read-context.ts'

/** One docs-stream value: which session, and its live document signature. */
export interface DocsStream {
  sessionId: SessionId | undefined
  /** Fold signature over the session's projected documents; null without a binding. */
  signature: string | null
}

/** The empty stream value before the first follow. */
const EMPTY: DocsStream = { sessionId: undefined, signature: null }

/**
 * Follow the sessions feed: the value moves when the current session changes
 * or its document fold moves (the runtime republishes the conversation
 * snapshot per event batch, but only fold changes pass the signature check).
 * Subscriptions start lazily with the first listener and tear down with the
 * last, so an unbound source follows nothing.
 * @param ctx - client root context (sessions binding lookup).
 * @returns the identity-stable observable source.
 */
export function docsStreamFor(ctx: ClientContext): ObservableSnapshot<DocsStream> {
  let value: DocsStream = EMPTY
  let followed: SessionId | undefined
  let sessionUnsub: (() => void) | null = null
  let listUnsub: (() => void) | null = null
  const listeners = new Set<() => void>()

  // The signature is a pure function of the conversation's chat nodes, and
  // the assembler rebuilds that node list only when events fold, so an
  // identity check absorbs every ordinary stream frame: the per-frame cost
  // drops from two full node scans to one reference comparison.
  let memo: { sessionId: SessionId; nodes: unknown; signature: string } | undefined

  /** The live fold signature for one session, or null without a binding. */
  const signatureOf = (sessionId: SessionId | undefined): string | null => {
    if (sessionId === undefined) return null
    const nodes = ctx.sessions.binding(sessionId)?.session.getSnapshot().chat.legacy.nodes
    if (nodes === undefined) return null
    if (memo !== undefined && memo.sessionId === sessionId && memo.nodes === nodes) return memo.signature
    const signature = readInjectedDocs(ctx, sessionId)
      .map(doc => `${doc.seq}:${doc.active ? '1' : '0'}`)
      .join(',')
    memo = { sessionId, nodes, signature }
    return signature
  }
  const publish = (next: DocsStream): void => {
    if (next.sessionId === value.sessionId && next.signature === value.signature) return
    value = next
    for (const listener of listeners) listener()
  }
  const follow = (sessionId: SessionId | undefined): void => {
    const face = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)?.session
    // The list also notifies on non-selection facts (summaries, phases):
    // recompute the same session's signature — a no-op publish unless the
    // fold actually moved.
    if (followed === sessionId) {
      publish({ sessionId, signature: signatureOf(sessionId) })
      return
    }
    followed = sessionId
    sessionUnsub?.()
    sessionUnsub = null
    if (face === undefined) {
      publish({ sessionId, signature: null })
      return
    }
    sessionUnsub = face.subscribe(() => {
      publish({ sessionId, signature: signatureOf(sessionId) })
    })
    publish({ sessionId, signature: signatureOf(sessionId) })
  }
  const sync = (): void => {
    follow(ctx.sessions.list.getSnapshot().current)
  }

  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      if (listeners.size === 0) {
        sync()
        listUnsub = ctx.sessions.list.subscribe(sync)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          listUnsub?.()
          listUnsub = null
          sessionUnsub?.()
          sessionUnsub = null
          followed = undefined
          value = EMPTY
        }
      }
    },
  }
}
