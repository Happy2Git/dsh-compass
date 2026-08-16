/**
 * Read-only commit-graph view (the panel's "提交" tab): a lane graph of the
 * topo-ordered commit DAG, ported from vibe-ide's GitGraph. Each active branch
 * is a lane with its own color; a new branch forks a new lane, a merge joins
 * them, and a root commit ends a lane. Clicking a commit lazily loads and
 * expands its changed-file list. No write actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { GitCommitDetail, GitCommitFile, GitGraphEntry, GitWorkspaceStatus } from '../git-seam.ts'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import css from './GitGraph.module.css'
import type { InjectedFace } from './types.ts'

/** Row/lane geometry and the lane-color palette (cycled; theme tokens only). */
const ROW_HEIGHT = 36
const LANE_WIDTH = 20
const CIRCLE_RADIUS = 5
const PADDING_LEFT = 8
const PAGE_SIZE = 50
const PALETTE = [
  'var(--dsw-alias-brand-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-alias-state-business-primary)',
] as const

/** Cycle the lane palette; PALETTE is a non-empty tuple, so the index is always in range. */
function paletteColor(idx: number): string {
  return PALETTE[idx % PALETTE.length] ?? PALETTE[0]
}

/** One parsed ref decoration (branch / remote / tag). */
interface RefItem {
  type: 'branch' | 'remote' | 'tag'
  display: string
}

/** Parse the raw `%D` ref string into typed badges. */
function parseRefs(refs: string): RefItem[] {
  if (refs === '') return []
  const items: RefItem[] = []
  for (const part of refs.split(', ')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const head = /^HEAD\s*->\s*(.+)$/.exec(trimmed)
    if (head !== null) {
      const name = (head[1] ?? '').trim()
      if (name !== '') items.push({ type: 'branch', display: name })
      continue
    }
    const tag = /^tag:\s*(.+)$/.exec(trimmed)
    if (tag !== null) {
      items.push({ type: 'tag', display: (tag[1] ?? '').trim() })
      continue
    }
    items.push({ type: trimmed.includes('/') ? 'remote' : 'branch', display: trimmed })
  }
  return items
}

/** One graph lane: a commit id with an assigned color. */
interface LaneNode {
  id: string
  color: string
}

/** One rendered graph row: the commit plus its input/output lane layout. */
interface GraphRow {
  entry: GitGraphEntry
  inputLanes: LaneNode[]
  outputLanes: LaneNode[]
  laneIndex: number
  mergeToLane: number | undefined
  foundLane: boolean
}

/** Assign lanes and colors across the commit list (vibe-ide's lane solver). */
function buildGraphRows(entries: GitGraphEntry[]): GraphRow[] {
  const rows: GraphRow[] = []
  let prevOutput: LaneNode[] = []
  let colorIdx = 0
  for (const entry of entries) {
    const inputLanes = prevOutput.map(lane => ({ ...lane }))
    const foundLane = inputLanes.findIndex(lane => lane.id === entry.hash)
    let laneIndex = foundLane
    if (laneIndex === -1) {
      laneIndex = inputLanes.length
      inputLanes.push({ id: entry.hash, color: paletteColor(colorIdx) })
      colorIdx++
    }

    const outputLanes = inputLanes.map(lane => ({ ...lane }))
    let mergeToLane: number | undefined
    if (entry.parents.length > 0) {
      const firstParent = entry.parents[0] ?? ''
      const existingIdx = outputLanes.findIndex((lane, idx) => lane.id === firstParent && idx !== laneIndex)
      if (existingIdx !== -1) {
        mergeToLane = existingIdx
        outputLanes.splice(laneIndex, 1)
        if (existingIdx > laneIndex) mergeToLane = existingIdx - 1
      } else {
        const lane = outputLanes[laneIndex]
        if (lane !== undefined) outputLanes[laneIndex] = { ...lane, id: firstParent }
      }
      for (let i = 1; i < entry.parents.length; i++) {
        const pid = entry.parents[i] ?? ''
        if (!outputLanes.some(lane => lane.id === pid)) {
          outputLanes.push({ id: pid, color: paletteColor(colorIdx) })
          colorIdx++
        }
      }
    } else {
      outputLanes.splice(laneIndex, 1)
    }

    rows.push({ entry, inputLanes, outputLanes, laneIndex, mergeToLane, foundLane: foundLane !== -1 })
    prevOutput = outputLanes
  }
  return rows
}

function laneX(lane: number): number {
  return PADDING_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`
}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** File-status → Chinese label, for the expanded commit file rows. */
function statusLabel(status: GitCommitFile['status']): string {
  if (status === 'added') return '新增'
  if (status === 'deleted') return '删除'
  if (status === 'untracked') return '未跟踪'
  return '修改'
}

/**
 * The expanded commit detail: the commit's changed files (bounded list).
 * Each row opens the file's diff in the centered pop-out.
 */
function CommitDetail({
  detail, loading, onOpenDiff,
}: {
  detail: GitCommitDetail | null
  loading: boolean
  onOpenDiff: (hash: string, path: string) => void
}): ReactNode {
  if (loading) return <div className={css.detailLoading}>加载中…</div>
  if (detail === null) return null
  return (
    <div className={css.detail}>
      {detail.files.length === 0
        ? <div className={css.detailEmpty}>该提交没有文件变更。</div>
        : (
          <ul className={css.detailList}>
            {detail.files.map(file => (
              <li key={file.path} className={css.detailRow}>
                <button type="button" className={css.detailFileButton} onClick={() => { onOpenDiff(detail.hash, file.path) }}>
                  <span className={clsx(css.detailBadge, css[`detailStatus_${file.status}`])}>{statusLabel(file.status)}</span>
                  <span className={css.detailPath}>{file.path}</span>
                  <span className={css.detailCount}>
                    {file.additions > 0 && <span className={css.detailAdd}>+{file.additions}</span>}
                    {file.deletions > 0 && <span className={css.detailDel}>−{file.deletions}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {detail.truncated && <div className={css.detailTruncated}>文件列表已截断。</div>}
    </div>
  )
}

/** The working-tree block: branch position and the uncommitted file list.
 * Each file row opens the working-tree diff in the centered pop-out. */
function WorkspaceBlock({ status, loading, error, onOpenDiff }: {
  status: GitWorkspaceStatus | null
  loading: boolean
  error: string | null
  onOpenDiff: (path: string) => void
}): ReactNode {
  if (loading) return <div className={css.workspaceBlock}><span className={css.workspaceNote}>读取工作区…</span></div>
  if (error !== null) return <div className={css.workspaceBlock}><span className={css.workspaceError}>工作区读取失败:{error}</span></div>
  if (status === null) return null
  const position = status.branch === null
    ? '游离 HEAD'
    : status.upstream === null
      ? `分支 ${status.branch}`
      : status.ahead === 0 && status.behind === 0
        ? `分支 ${status.branch} · 与 ${status.upstream} 同步`
        : `分支 ${status.branch} · 领先 ${status.ahead} · 落后 ${status.behind}`
  return (
    <div className={css.workspaceBlock}>
      <div className={css.workspaceHeader}>
        <span className={css.workspaceTitle}>工作区</span>
        <span className={css.workspacePosition}>{position}</span>
      </div>
      {status.files.length === 0
        ? <div className={css.workspaceNote}>工作区干净。</div>
        : (
          <ul className={css.workspaceList}>
            {status.files.map(file => (
              <li key={file.path} className={css.workspaceRow}>
                <button type="button" className={css.workspaceFileButton} onClick={() => { onOpenDiff(file.path) }}>
                  <span className={clsx(css.detailBadge, css[`detailStatus_${file.status}`])}>{statusLabel(file.status)}</span>
                  <span className={css.workspacePath} title={file.path}>{file.path}</span>
                  <span className={css.detailCount}>
                    {file.additions > 0 && <span className={css.detailAdd}>+{file.additions}</span>}
                    {file.deletions > 0 && <span className={css.detailDel}>−{file.deletions}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {status.truncated && <div className={css.detailTruncated}>文件列表已截断。</div>}
    </div>
  )
}

/** Component props: the injected git callbacks plus the repository directory. */
export interface GitGraphProps {
  /** The session's repository directory; absent shows the no-session placeholder. */
  cwd: string | undefined
  gitGraph: InjectedFace['gitGraph']
  gitShowCommit: InjectedFace['gitShowCommit']
  workspaceStatus: InjectedFace['workspaceStatus']
  /** Open one file's diff in the centered pop-out. */
  onOpenDiff: (hash: string, path: string) => void
  /** Open one workspace file's working-tree diff in the centered pop-out. */
  onOpenWorkspaceDiff: (path: string) => void
}

/** Render the commit-graph tab. */
export function GitGraph({ cwd, gitGraph, gitShowCommit, workspaceStatus, onOpenDiff, onOpenWorkspaceDiff }: GitGraphProps): ReactNode {
  const [entries, setEntries] = useState<GitGraphEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedHash, setExpandedHash] = useState<string | null>(null)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [workspace, setWorkspace] = useState<GitWorkspaceStatus | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  // Bumped by the header's refresh button; both initial reads re-run (the
  // effects reset their own state), so the view catches up after the agent
  // commits without leaving the tab.
  const [refreshSeq, setRefreshSeq] = useState(0)

  // The working-tree snapshot refreshes with the repository.
  useEffect(() => {
    let cancelled = false
    setWorkspace(null)
    setWorkspaceError(null)
    if (cwd === undefined) return
    setWorkspaceLoading(true)
    const ctl = new AbortController()
    void workspaceStatus(cwd, ctl.signal).then(
      (status) => {
        if (!cancelled) {
          setWorkspace(status)
          setWorkspaceLoading(false)
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setWorkspaceError(messageOf(reason))
          setWorkspaceLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
      ctl.abort()
    }
  }, [cwd, workspaceStatus, refreshSeq])

  // First page, reset whenever the repository changes.
  useEffect(() => {
    let cancelled = false
    setEntries([])
    setHasMore(false)
    setError(null)
    setExpandedHash(null)
    setDetail(null)
    if (cwd === undefined) return
    const ctl = new AbortController()
    void gitGraph(cwd, PAGE_SIZE, 0, ctl.signal).then(
      (page) => {
        if (!cancelled) {
          setEntries(page.entries)
          setHasMore(page.hasMore)
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(messageOf(reason))
      },
    )
    return () => {
      cancelled = true
      ctl.abort()
    }
  }, [cwd, gitGraph, refreshSeq])

  const loadMore = useCallback((): void => {
    if (cwd === undefined || loadingMore) return
    setLoadingMore(true)
    const ctl = new AbortController()
    void gitGraph(cwd, PAGE_SIZE, entries.length, ctl.signal).then(
      (page) => {
        setEntries(current => [...current, ...page.entries])
        setHasMore(page.hasMore)
        setLoadingMore(false)
      },
      (reason: unknown) => {
        setError(messageOf(reason))
        setLoadingMore(false)
      },
    )
  }, [cwd, entries.length, loadingMore, gitGraph])

  const toggleCommit = useCallback((hash: string): void => {
    if (expandedHash === hash) {
      setExpandedHash(null)
      setDetail(null)
      return
    }
    setExpandedHash(hash)
    setDetail(null)
    if (cwd === undefined) return
    setDetailLoading(true)
    const ctl = new AbortController()
    void gitShowCommit(cwd, hash, ctl.signal).then(
      (commit) => {
        setDetail(commit)
        setDetailLoading(false)
      },
      (reason: unknown) => {
        setError(messageOf(reason))
        setDetailLoading(false)
      },
    )
  }, [cwd, expandedHash, gitShowCommit])

  const rows = useMemo(() => buildGraphRows(entries), [entries])
  // The current branch's refs (the HEAD commit's decorations), shown in a bar
  // above the tree so they never crowd the first commit row.
  const headRefs = useMemo(() => {
    const head = entries.find(entry => entry.refs.includes('HEAD ->'))
    return head === undefined ? [] : parseRefs(head.refs)
  }, [entries])

  if (cwd === undefined) {
    return <p className={css.empty}>选择会话后显示其 git 提交历史。</p>
  }
  if (error !== null && entries.length === 0) {
    return <p className={css.error}>{error}</p>
  }
  if (entries.length === 0) {
    return <p className={css.empty}>该目录不是 git 仓库或尚无提交。</p>
  }

  return (
    <div className={css.gitLayout}>
      <WorkspaceBlock status={workspace} loading={workspaceLoading} error={workspaceError} onOpenDiff={onOpenWorkspaceDiff} />
      <div className={css.treeBlock}>
        <div className={css.treeHeader}>
          <span className={css.treeTitle}>Git 树</span>
          <button
            type="button"
            className={css.refreshButton}
            aria-label="刷新 Git 视图"
            title="刷新 Git 视图"
            onClick={() => { setRefreshSeq(seq => seq + 1) }}
          >
            <IconRefreshOutline14 />
          </button>
        </div>
        {headRefs.length > 0 && (
          <div className={css.refsBar}>
            {headRefs.map((item, idx) => (
              <span key={idx} className={clsx(css.ref, css[`ref_${item.type}`])}>{item.display}</span>
            ))}
          </div>
        )}
        <div className={css.graph}>
          {rows.map((row) => {
            const midY = ROW_HEIGHT / 2
            const botY = ROW_HEIGHT
            const xc = laneX(row.laneIndex)
            const color = row.inputLanes[row.laneIndex]?.color ?? PALETTE[0]
            const isHead = row.entry.refs.includes('HEAD ->')
            const isMerge = row.entry.parents.length > 1
            const isExpanded = row.entry.hash === expandedHash
            const refItems = parseRefs(row.entry.refs)
            const rowWidth = PADDING_LEFT + Math.max(row.inputLanes.length, row.outputLanes.length) * LANE_WIDTH

            const elements: ReactNode[] = []
            for (let j = 0; j < row.inputLanes.length; j++) {
              if (j === row.laneIndex) continue
              const xj = laneX(j)
              const node = row.inputLanes[j]
              if (node === undefined) continue
              const outIdx = row.outputLanes.findIndex(lane => lane.id === node.id)
              if (outIdx === j) {
                elements.push(<line key={`pass-${j}`} x1={xj} y1={0} x2={xj} y2={botY} className={css.lane} style={{ stroke: node.color }} />)
              } else if (outIdx >= 0) {
                elements.push(<path key={`shift-${j}`} d={curvePath(xj, 0, laneX(outIdx), botY)} className={css.lane} style={{ stroke: node.color }} />)
              } else {
                elements.push(<path key={`end-${j}`} d={curvePath(xj, 0, xc, midY)} className={css.lane} style={{ stroke: node.color }} />)
              }
            }
            if (row.foundLane) {
              elements.push(<line key="in" x1={xc} y1={0} x2={xc} y2={midY - CIRCLE_RADIUS} className={css.lane} style={{ stroke: color }} />)
            }
            if (row.mergeToLane !== undefined) {
              elements.push(<path key="merge-out" d={curvePath(xc, midY + CIRCLE_RADIUS, laneX(row.mergeToLane), botY)} className={css.lane} style={{ stroke: color }} />)
            } else if (row.entry.parents.length > 0) {
              const parentLane = row.outputLanes.findIndex(lane => lane.id === row.entry.parents[0])
              if (parentLane === row.laneIndex || parentLane === -1) {
                elements.push(<line key="out-straight" x1={xc} y1={midY + CIRCLE_RADIUS} x2={xc} y2={botY} className={css.lane} style={{ stroke: color }} />)
              } else {
                elements.push(<path key="out-curve" d={curvePath(xc, midY + CIRCLE_RADIUS, laneX(parentLane), botY)} className={css.lane} style={{ stroke: color }} />)
              }
              for (let pi = 1; pi < row.entry.parents.length; pi++) {
                const pl = row.outputLanes.findIndex(lane => lane.id === row.entry.parents[pi])
                if (pl >= 0 && pl !== row.laneIndex) {
                  elements.push(<path key={`merge-${pi}`} d={curvePath(xc, midY + CIRCLE_RADIUS, laneX(pl), botY)} className={css.lane} style={{ stroke: color }} />)
                }
              }
            }
            for (let j = row.inputLanes.length; j < row.outputLanes.length; j++) {
              const lane = row.outputLanes[j]
              if (lane === undefined) continue
              elements.push(<path key={`new-${j}`} d={curvePath(xc, midY + CIRCLE_RADIUS, laneX(j), botY)} className={css.lane} style={{ stroke: lane.color }} />)
            }

            const circleFill = isExpanded ? 'var(--dsw-alias-brand-primary)' : color

            return (
              <div key={row.entry.hash}>
                <button
                  type="button"
                  className={clsx(css.row, isExpanded && css.rowExpanded)}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => { toggleCommit(row.entry.hash) }}
                  aria-expanded={isExpanded}
                >
                  <svg width={rowWidth} height={ROW_HEIGHT} className={css.rowSvg} aria-hidden="true">
                    {elements}
                    {isHead && <circle key="head-outer" cx={xc} cy={midY} r={CIRCLE_RADIUS + 2.5} className={css.dotRing} style={{ stroke: circleFill }} />}
                    {isMerge && <circle key="merge-outer" cx={xc} cy={midY} r={CIRCLE_RADIUS + 1.5} className={css.dotRing} style={{ stroke: circleFill }} />}
                    <circle
                      key="dot"
                      cx={xc}
                      cy={midY}
                      r={isHead || isMerge ? CIRCLE_RADIUS - 1.5 : CIRCLE_RADIUS}
                      style={{ fill: circleFill }}
                    />
                  </svg>
                  <span className={css.rowText}>
                    <span className={css.rowMessage}>{row.entry.message}</span>
                    <span className={css.rowMeta}>
                      <span className={css.rowHash}>{row.entry.hash.slice(0, 7)}</span>
                      <span className={css.rowAuthor}>{row.entry.author}</span>
                      <span className={css.rowDate}>{new Date(row.entry.date).toLocaleDateString()}</span>
                    </span>
                  </span>
                  {!isHead && refItems.length > 0 && (
                    <span className={css.refs}>
                      {refItems.map((item, idx) => (
                        <span key={idx} className={clsx(css.ref, css[`ref_${item.type}`])}>{item.display}</span>
                      ))}
                    </span>
                  )}
                </button>
                {isExpanded && <CommitDetail detail={detail} loading={detailLoading} onOpenDiff={onOpenDiff} />}
              </div>
            )
          })}
          {hasMore && (
            <button type="button" className={css.loadMore} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '加载中…' : '加载更多提交'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
