/**
 * One bare observable over the panel's document stream: the current session's
 * conversation snapshot (reference-stable between changes) plus the session
 * id. The context tab re-projects its injected documents whenever the value
 * moves, so agent activity shows up without a manual refresh. Owned by the
 * plugin's inject `hooks` compartment; components never see this module.
 */
import type {
  ClientContext, ConversationSnapshot, ObservableSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One docs-stream value: which session, and its live conversation snapshot. */
export interface DocsStream {
  sessionId: SessionId | undefined
  snapshot: ConversationSnapshot | undefined
}

/** The empty stream value before the first follow. */
const EMPTY: DocsStream = { sessionId: undefined, snapshot: undefined }

/**
 * Follow the sessions feed: the value moves when the current session changes
 * or its conversation snapshot moves (the runtime republishes the snapshot
 * reference per event batch). Subscriptions start lazily with the first
 * listener and tear down with the last, so an unbound source follows nothing.
 * @param ctx - client root context (sessions binding lookup).
 * @returns the identity-stable observable source.
 */
export function docsStreamFor(ctx: ClientContext): ObservableSnapshot<DocsStream> {
  let value: DocsStream = EMPTY
  let followed: SessionId | undefined
  let sessionUnsub: (() => void) | null = null
  let listUnsub: (() => void) | null = null
  const listeners = new Set<() => void>()

  const publish = (next: DocsStream): void => {
    if (next.sessionId === value.sessionId && next.snapshot === value.snapshot) return
    value = next
    for (const listener of listeners) listener()
  }
  const follow = (sessionId: SessionId | undefined): void => {
    const face = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)?.session
    // The list also notifies on non-selection facts (summaries, phases):
    // re-publish the same session's snapshot reference — a no-op unless the
    // session stream itself moved it.
    if (followed === sessionId) {
      publish({ sessionId, snapshot: face?.getSnapshot() })
      return
    }
    followed = sessionId
    sessionUnsub?.()
    sessionUnsub = null
    if (face === undefined) {
      publish({ sessionId, snapshot: undefined })
      return
    }
    sessionUnsub = face.subscribe(() => {
      publish({ sessionId, snapshot: face.getSnapshot() })
    })
    publish({ sessionId, snapshot: face.getSnapshot() })
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
