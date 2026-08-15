/**
 * Directory browser tab: lazily loaded one-level listings composed into a
 * tree rooted at the session's workspace directory. The Host browse
 * capability enumerates child directories and files (kind-tagged); directory
 * rows expand lazily, clicking a file opens it in the centered preview
 * directly (no lower pane — the center dialog owns the content). Per-directory
 * listings are component-local state; expansion and the centered pop-out ride
 * the declared store.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DirectoryListing } from '../directory-types.ts'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconCopyOutline16,
  IconFolderClose16, IconFolderOpen16, IconRefreshOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import { FileGlyph } from './file-icon.tsx'
import css from './Panel.module.css'
import type { InjectedFace } from './types.ts'

/** One directory row of a listing (derived — api-remotes exports the listing, not the row). */
type DirectoryEntry = DirectoryListing['entries'][number]

/** One directory level's fetched state. */
interface DirState {
  entries: DirectoryEntry[]
  truncated: boolean
  loading: boolean
  error: string | null
}

/** Component props: store-derived state plus the injected callbacks. */
export interface FileTreeProps {
  /** Root directory (the current session's workspace); undefined without a session. */
  root: string | undefined
  /** Basename filter text from the store. */
  filter: string
  /** Expanded directory paths from the store. */
  expandedDirs: string[]
  onToggleDir: (path: string) => void
  onFilter: (filter: string) => void
  listDirectory: InjectedFace['listDirectory']
  openPath: InjectedFace['openPath']
  /** Open a file in the centered preview. */
  onOpenFile: (path: string) => void
  hasSession: boolean
}

/** One row's per-level indentation. */
const INDENT_PX = 16

/** How long the copy glyph stays as a check after a successful write, in ms. */
const COPIED_FEEDBACK_MS = 1000

/**
 * Compact hover-revealed copy control for one row's absolute path: copies it
 * to the host clipboard and flips to a check for a beat. Clicks stop
 * propagation so a file row's open-preview handler never fires.
 * @param path - the absolute path to copy.
 * @returns the copy button.
 */
function CopyPathButton({ path }: { path: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={css.copyButton}
      title="复制路径"
      aria-label={`复制路径 ${path}`}
      onClick={(event) => {
        event.stopPropagation()
        void writeClipboard(path).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
        })
      }}
    >
      {copied
        ? <IconCheckOutline16 className={css.copyGlyph} />
        : <IconCopyOutline16 className={css.copyGlyph} />}
    </button>
  )
}

/**
 * Render the tree browser.
 * @param props - component props.
 * @returns the tree surface.
 */
export function FileTree(props: FileTreeProps): ReactNode {
  const [dirs, setDirs] = useState<ReadonlyMap<string, DirState>>(new Map())
  const [rootLabel, setRootLabel] = useState<string | null>(null)
  /** In-flight listing controllers, aborted on root change and unmount. */
  const loadersRef = useRef<AbortController[]>([])

  const load = useCallback((path: string): void => {
    const controller = new AbortController()
    loadersRef.current.push(controller)
    const settled = (): void => {
      loadersRef.current = loadersRef.current.filter(candidate => candidate !== controller)
    }
    setDirs(prev => new Map(prev).set(path, { entries: [], truncated: false, loading: true, error: null }))
    void props.listDirectory(path, controller.signal).then(
      (listing) => {
        settled()
        // Aborted on unmount or root change: never set state afterwards.
        if (controller.signal.aborted) return
        setDirs(prev => new Map(prev).set(path, {
          entries: listing.entries.filter(entry => !entry.hidden),
          truncated: listing.truncated,
          loading: false,
          error: null,
        }))
        const tail = listing.crumbs[listing.crumbs.length - 1]
        setRootLabel(tail?.name ?? listing.path)
      },
      (error: unknown) => {
        settled()
        if (controller.signal.aborted) return
        setDirs(prev => new Map(prev).set(path, {
          entries: [],
          truncated: false,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  }, [props.listDirectory])

  useEffect(() => {
    setDirs(new Map())
    setRootLabel(null)
    if (props.root !== undefined) load(props.root)
    return () => {
      // Stop every in-flight listing before the next root's load or unmount.
      for (const controller of loadersRef.current) controller.abort()
      loadersRef.current = []
    }
  }, [props.root, load])

  if (!props.hasSession) {
    return <p className={css.empty}>选择会话后显示其工作目录。</p>
  }

  const needle = props.filter.trim().toLowerCase()
  const matches = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle)

  const handleToggle = (path: string): void => {
    const wasExpanded = props.expandedDirs.includes(path)
    props.onToggleDir(path)
    if (!wasExpanded && !dirs.has(path)) load(path)
  }

  const renderRows = (path: string, name: string, depth: number, keyPrefix: string, ancestors: ReadonlySet<string>): ReactNode[] => {
    const rows: ReactNode[] = []
    const rowKey = `${keyPrefix}|${path}`
    const expanded = props.expandedDirs.includes(path)
    const state = dirs.get(path)
    rows.push(
      <div key={rowKey} className={css.row} style={{ paddingLeft: `${8 + depth * INDENT_PX}px` }}>
        <button
          type="button"
          className={css.chevron}
          onClick={() => { handleToggle(path) }}
          aria-label={expanded ? `折叠 ${name}` : `展开 ${name}`}
        >
          {expanded
            ? <IconChevronDownOutline14 className={css.chevronGlyph} />
            : <IconChevronRightOutline14 className={css.chevronGlyph} />}
        </button>
        <span className={css.rowGlyph} aria-hidden="true">
          {expanded
            ? <IconFolderOpen16 className={css.rowGlyphIcon} />
            : <IconFolderClose16 className={css.rowGlyphIcon} />}
        </span>
        <span className={css.rowName} title={path}>{name}</span>
        <CopyPathButton path={path} />
        <button
          type="button"
          className={css.openButton}
          onClick={() => { void props.openPath(path) }}
          title="在系统文件管理器中打开"
        >
          打开
        </button>
      </div>,
    )
    if (!expanded) return rows
    const childKey = rowKey
    if (state === undefined || state.loading) {
      rows.push(<div key={`${childKey}|loading`} className={css.rowNote} style={{ paddingLeft: `${8 + (depth + 1) * INDENT_PX}px` }}>加载中…</div>)
      return rows
    }
    if (state.error !== null) {
      rows.push(<div key={`${childKey}|error`} className={clsx(css.rowNote, css.rowError)} style={{ paddingLeft: `${8 + (depth + 1) * INDENT_PX}px` }}>读取失败:{state.error}</div>)
      return rows
    }
    const visible = state.entries.filter(entry => matches(entry.name))
    if (visible.length === 0) {
      rows.push(<div key={`${childKey}|empty`} className={css.rowNote} style={{ paddingLeft: `${8 + (depth + 1) * INDENT_PX}px` }}>无匹配条目</div>)
      return rows
    }
    const childAncestors = new Set(ancestors)
    childAncestors.add(path)
    for (const entry of visible) {
      // File rows open the centered preview directly.
      if (entry.kind === 'file') {
        rows.push(
          <div
            key={`${childKey}|file:${entry.path}`}
            className={clsx(css.row, css.fileRowOpenable)}
            style={{ paddingLeft: `${8 + (depth + 1) * INDENT_PX}px` }}
            role="button"
            tabIndex={0}
            onClick={() => { props.onOpenFile(entry.path) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') props.onOpenFile(entry.path)
            }}
            aria-label={`打开 ${entry.name}`}
          >
            <span className={css.rowGlyph} aria-hidden="true">
              <FileGlyph name={entry.name} />
            </span>
            <span className={clsx(css.rowName, css.fileName)} title={entry.path}>{entry.name}</span>
            <CopyPathButton path={entry.path} />
          </div>,
        )
        continue
      }
      // Cycle guard: the browse capability includes directory symlinks, so a
      // listing may name an ancestor (a link loop). Render those as leaves —
      // recursion into a path already on the chain could never terminate.
      if (childAncestors.has(entry.path)) {
        rows.push(
          <div key={`${childKey}|leaf:${entry.path}`} className={css.row} style={{ paddingLeft: `${8 + (depth + 1) * INDENT_PX}px` }}>
            <span className={css.rowGlyph} aria-hidden="true">
              <IconRefreshOutline14 className={css.rowGlyphIcon} />
            </span>
            <span className={clsx(css.rowName, css.fileName)} title={entry.path}>{entry.name}</span>
            <span className={css.rowNote}>循环链接</span>
          </div>,
        )
        continue
      }
      rows.push(...renderRows(entry.path, entry.name, depth + 1, childKey, childAncestors))
    }
    if (state.truncated) {
      rows.push(<div key={`${childKey}|truncated`} className={css.rowNote} style={{ paddingLeft: `${8 + (depth + 1) * INDENT_PX}px` }}>结果过多,仅显示部分</div>)
    }
    return rows
  }

  return (
    <div className={css.treeLayout}>
      <div className={css.filterRow}>
        <input
          className={css.filterInput}
          type="text"
          value={props.filter}
          onChange={(event) => { props.onFilter(event.target.value) }}
          placeholder="按名称过滤…"
          aria-label="按名称过滤目录"
        />
      </div>
      <div className={css.treeBody}>
        {props.root === undefined
          ? <p className={css.empty}>该会话没有工作目录。</p>
          : renderRows(props.root, rootLabel ?? props.root, 0, 'tree', new Set([props.root]))}
      </div>
    </div>
  )
}
