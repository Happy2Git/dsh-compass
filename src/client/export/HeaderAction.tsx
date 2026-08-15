import type { ReactNode } from 'react'
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadFrameworkProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the panel-header export capsule and its shared result dialog. The
 * panel is root-scoped, so the current session id comes from the global
 * `useSessions` seat; without one the action renders nothing.
 * @param props - framework shares, download controller, and localized dialog copy.
 * @returns the persistent header action and session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadFrameworkProps): ReactNode {
  const sessionId = props.useSessions(s => s.current)
  const { useSessionLogDownload, request } = props
  // Both hooks run unconditionally (Rules of Hooks): the selector answers
  // `undefined` while no session is current, and the null render follows.
  const entry = useSessionLogDownload(state => sessionId === undefined ? undefined : state.bySession[String(sessionId)])
  if (sessionId === undefined) return null
  const busy = entry?.status === 'downloading'

  return (
    <>
      <button
        type="button"
        className={css.sessionLogButton}
        disabled={busy}
        aria-busy={busy}
        onClick={() => { void request(sessionId) }}
      >
        <span>Session log</span>
        <IconDownloadOutline16 size={12} />
      </button>
      <SessionLogDownloadDialog {...props} sessionId={sessionId} />
    </>
  )
}
