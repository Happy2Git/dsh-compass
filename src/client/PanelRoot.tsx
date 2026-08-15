/**
 * The overlay entry component: a right-edge docked rail/column (symmetric with
 * the left sidebar) plus, when a file is "popped into the center", a centered
 * preview dialog over the conversation area. Data arrives through the
 * framework hook (useSessions) and the injected callbacks; viewing state rides
 * the declared store. Fetched data is component-local state refreshed on
 * session change, stream advance, and explicit controls — event/effect
 * reads, never a subscription mirror.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { InjectFace, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryRead } from '../directory-types.ts'
import { IconPanelLeftOutline16, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import { ContextDocs } from './ContextDocs.tsx'
import { FileContent } from './render-file.tsx'
import { FileTree } from './FileTree.tsx'
import { GitGraph } from './GitGraph.tsx'
import css from './Panel.module.css'
import type { createPanelStore } from './store.ts'
import type { ContextDoc, InjectedFace } from './types.ts'

/** The four-share component props: framework runtime, render slots, store, and the injected face (its hooks compartment bound). */
export type PanelRootProps =
  & PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'panel.header.utilities'>
  & PropsStore<ReturnType<typeof createPanelStore>>
  & InjectFace<InjectedFace>

/** Resize bounds for the panel's left-edge drag (mirrors the sidebar's range). */
const PANEL_MIN_WIDTH = 240
const PANEL_MAX_WIDTH = 480

/** Clamp a width into the panel's resize bounds. */
function clampWidth(width: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width))
}

/** Centered pop-out: the selected file's full preview over the conversation. */
function CenterPreview({ path, readText, onClose }: {
  path: string
  readText: InjectedFace['readText']
  onClose: () => void
}): ReactNode {
  const [read, setRead] = useState<DirectoryRead | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRead(null)
    setError(null)
    void readText(path, new AbortController().signal).then(
      (value) => { if (!cancelled) setRead(value) },
      (reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => { cancelled = true }
  }, [path, readText])

  const name = path.split('/').pop() ?? path
  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      closeLabel="关闭中部预览"
      className={css.centerModal ?? ''}
    >
      <div className={css.centerBody}>
        {error !== null
          ? <p className={css.empty}>无法预览:{error}</p>
          : read === null
            ? <p className={css.empty}>加载中…</p>
            : <FileContent name={name} text={read.text} />}
      </div>
    </Modal>
  )
}

/** Centered pop-out: one file's diff within one commit, over the conversation. */
function CenterDiffPreview({ cwd, hash, path, showFileDiff, onClose }: {
  cwd: string
  hash: string
  path: string
  showFileDiff: InjectedFace['showFileDiff']
  onClose: () => void
}): ReactNode {
  const [diff, setDiff] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDiff(null)
    setTruncated(false)
    setError(null)
    void showFileDiff(cwd, hash, path, new AbortController().signal).then(
      (value) => {
        if (cancelled) return
        setDiff(value.diff)
        setTruncated(value.truncated)
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => { cancelled = true }
  }, [cwd, hash, path, showFileDiff])

  return (
    <Modal
      open
      onClose={onClose}
      title={path}
      closeLabel="关闭中部预览"
      className={css.centerModal ?? ''}
    >
      <div className={css.centerBody}>
        {error !== null
          ? <p className={css.empty}>无法预览:{error}</p>
          : diff === null
            ? <p className={css.empty}>加载中…</p>
            : (
              <>
                {truncated && <p className={css.diffTruncated}>diff 过长,仅显示部分。</p>}
                <pre className={css.diffText}>{diff}</pre>
              </>
            )}
      </div>
    </Modal>
  )
}

/** Centered pop-out: one injected context document's markdown over the conversation. */
function CenterDocPreview({ doc, onClose }: { doc: ContextDoc; onClose: () => void }): ReactNode {
  const name = doc.label ?? doc.form ?? '上下文'
  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      closeLabel="关闭中部预览"
      className={css.centerModal ?? ''}
    >
      <div className={css.centerBody}>
        <MarkdownText text={doc.text} />
      </div>
    </Modal>
  )
}

/**
 * Render the docked rail/column or the open panel, keyed off the declared store,
 * plus the centered preview dialog when a file is popped out.
 * @param props - the four shares (runtime hooks, store, injected callbacks).
 * @returns the entry's rendered surface.
 */
export function PanelRoot(props: PanelRootProps): ReactNode {
  // Injected callbacks as locals: passing a property function reference
  // onward would trip the unbound-method lint and hide the ownership.
  const {
    actions, renderSlot, listDirectory, gitStatusFor, openPath, readText, gitGraph, gitShowCommit,
    workspaceStatus, showFileDiff, readInjectedDocs, hasMoreDocs, loadOlderDocs, useDocsStream,
  } = props
  const sessions = props.useSessions(s => s)
  const state = props.useStore(s => s)
  const current = sessions.current
  const cwd = current === undefined ? undefined : props.sessionCwd(current)
  // The current session's stream position (reference-stable between batches):
  // a move re-projects the context documents below.
  const docsStream = useDocsStream(s => s)

  const [docs, setDocs] = useState<ContextDoc[]>([])
  const [docsRev, setDocsRev] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [resizing, setResizing] = useState(false)
  const resizeOrigin = useRef(0)
  const resizeLatest = useRef(0)
  const resizeBase = useRef(280)
  const resizeFrame = useRef<number | null>(null)

  // Narrow viewports auto-collapse the panel to its rail: the expanded column
  // would crowd out the conversation, and the overlay must not block pointer
  // input, so only the rail stays. The user's expanded preference is preserved
  // in the store and restored when the viewport widens again.
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 720px)').matches)
  useEffect(() => {
    const query = matchMedia('(max-width: 720px)')
    const onChange = (event: MediaQueryListEvent): void => { setNarrow(event.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])
  const collapsed = narrow || state.collapsed

  // Publish the panel's occupied width onto the document root so the
  // conversation column (a sibling subtree) can inset itself and stay clear of
  // this overlay instead of sliding beneath it.
  useEffect(() => {
    document.documentElement.style.setProperty('--dsh-context-panel-width', collapsed ? '0px' : `${state.width}px`)
    return () => {
      document.documentElement.style.removeProperty('--dsh-context-panel-width')
    }
  }, [collapsed, state.width])

  // Left-edge resize: dragging left widens the panel (its left edge follows the
  // pointer), dragging right narrows it, clamped to the bounds above.
  const onResizeStart = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeOrigin.current = event.clientX
    resizeLatest.current = event.clientX
    resizeBase.current = state.width
    setResizing(true)
  }, [state.width])
  const onResizeMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    resizeLatest.current = event.clientX
    resizeFrame.current ??= requestAnimationFrame(() => {
      resizeFrame.current = null
      actions.setWidth(clampWidth(resizeBase.current - (resizeLatest.current - resizeOrigin.current)))
    })
  }, [actions])
  const onResizeEnd = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (resizeFrame.current !== null) {
      cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = null
    }
    actions.setWidth(clampWidth(resizeBase.current - (resizeLatest.current - resizeOrigin.current)))
    setResizing(false)
  }, [actions])

  // Projected injected documents: re-read when the session changes, the
  // manual refresh bumps, or the session stream advances (docsStream). A
  // signature guard keeps stream bumps from re-rendering when the projected
  // rows did not change (the docs are durable log events; only their set and
  // active flags move).
  const docsSignature = useRef('')
  useEffect(() => {
    if (current === undefined) {
      docsSignature.current = ''
      setDocs([])
      return
    }
    const next = readInjectedDocs(current)
    const signature = `${current}:${next.map(doc => `${doc.seq}:${doc.active ? '1' : '0'}`).join(',')}`
    if (signature === docsSignature.current) return
    docsSignature.current = signature
    setDocs(next)
  }, [current, docsRev, docsStream, readInjectedDocs])

  const handleLoadOlder = (): void => {
    if (current === undefined || loadingOlder) return
    setLoadingOlder(true)
    void loadOlderDocs(current).then(
      () => {
        setDocs(readInjectedDocs(current))
      },
      () => {
        // Swallow the load failure: the older-document window simply stays as
        // it is — there is no error surface to update, only the button below
        // must re-enable.
      },
    ).then(() => { setLoadingOlder(false) })
  }

  return (
    <>
      {state.centerFile !== null && (
        <CenterPreview
          path={state.centerFile}
          readText={readText}
          onClose={actions.closeCenter}
        />
      )}
      {state.centerDocSeq !== null && (() => {
        const doc = docs.find(candidate => candidate.seq === state.centerDocSeq) ?? null
        return doc !== null ? <CenterDocPreview doc={doc} onClose={actions.closeCenter} /> : null
      })()}
      {state.centerDiff !== null && cwd !== undefined && (
        <CenterDiffPreview
          cwd={cwd}
          hash={state.centerDiff.hash}
          path={state.centerDiff.path}
          showFileDiff={showFileDiff}
          onClose={actions.closeCenter}
        />
      )}
      <section
        className={clsx(css.panel, collapsed && css.collapsed)}
        style={collapsed ? undefined : { width: state.width }}
        data-resizing={resizing || undefined}
        aria-label="上下文与文件面板"
      >
        {!collapsed && (
          <div
            className={css.resizeHandle}
            aria-hidden="true"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
          />
        )}
        {collapsed ? (
          narrow ? null : (
            <button
              type="button"
              className={css.railToggle}
              aria-label="展开面板"
              aria-expanded="false"
              onClick={actions.toggleCollapsed}
            >
              <IconPanelLeftOutline16 className={css.railToggleGlyph} />
            </button>
          )
        ) : (
          <>
            <header className={css.headerRow}>
              <button
                type="button"
                className={css.headerToggle}
                aria-label="收起面板"
                aria-expanded="true"
                onClick={actions.toggleCollapsed}
              >
                <IconPanelLeftOutline16 className={css.headerToggleGlyph} />
              </button>
              <div className={css.headerUtilities}>
                {renderSlot('panel.header.utilities', {})}
              </div>
            </header>
            <nav className={css.tabs}>
              <div className={css.tabGroup} role="tablist" aria-label="面板视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={state.tab === 'context'}
                  className={clsx(css.tab, state.tab === 'context' && css.tabActive)}
                  onClick={() => { actions.setTab('context') }}
                >
                  上下文
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={state.tab === 'files'}
                  className={clsx(css.tab, state.tab === 'files' && css.tabActive)}
                  onClick={() => { actions.setTab('files') }}
                >
                  文件夹
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={state.tab === 'git'}
                  className={clsx(css.tab, state.tab === 'git' && css.tabActive)}
                  onClick={() => { actions.setTab('git') }}
                >
                  Git
                </button>
              </div>
            </nav>
            <div className={css.body}>
              {state.tab === 'context' && (
                <ContextDocs
                  docs={docs}
                  filter={state.contextFilter}
                  onFilter={actions.setContextFilter}
                  onOpenDoc={actions.openDocCenter}
                  onRefresh={() => { setDocsRev(rev => rev + 1) }}
                  hasSession={current !== undefined}
                  hasMore={current !== undefined && hasMoreDocs(current)}
                  loadingOlder={loadingOlder}
                  onLoadOlder={handleLoadOlder}
                />
              )}
              {state.tab === 'files' && (
                <FileTree
                  root={cwd}
                  filter={state.filter}
                  expandedDirs={state.expandedDirs}
                  onToggleDir={actions.toggleDir}
                  onFilter={actions.setFilter}
                  listDirectory={listDirectory}
                  gitStatusFor={gitStatusFor}
                  openPath={openPath}
                  onOpenFile={actions.openCenter}
                  hasSession={current !== undefined}
                />
              )}
              {state.tab === 'git' && (
                <GitGraph
                  cwd={cwd}
                  gitGraph={gitGraph}
                  gitShowCommit={gitShowCommit}
                  workspaceStatus={workspaceStatus}
                  onOpenDiff={actions.openDiffCenter}
                />
              )}
            </div>
          </>
        )}
      </section>
    </>
  )
}
