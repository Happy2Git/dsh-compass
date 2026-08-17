/**
 * Context tab: the session's injected-context documents split into the live
 * window (still in the model's context) and the shadowed history (compacted
 * away), with a search box over both. An occupancy strip heads the view —
 * measured bytes per section with a per-origin composition bar — every row
 * carries its origin class and size, and the history section names the
 * compaction that shadowed it. A click opens a document in the centered
 * pop-out (same interaction as a file row); the "load earlier" control pages
 * the runtime window back so the session-start baseline instructions
 * (AGENTS.md and friends) join the history stream.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './Panel.module.css'
import { formatBytes, ORIGIN_LABEL, sectionStats, type SectionStats } from './doc-stats.ts'
import type { ContextDoc, DocOrigin } from './types.ts'

/** Component props: fetched documents, search state, window paging, and the center-open callback. */
export interface ContextDocsProps {
  docs: ContextDoc[]
  /** Search query over the documents' label, form, origin, and text. */
  filter: string
  onFilter: (filter: string) => void
  /** Open one document in the centered pop-out. */
  onOpenDoc: (seq: number) => void
  onRefresh: () => void
  hasSession: boolean
  /** Whether older history pages exist beyond the loaded window. */
  hasMore: boolean
  /** Loading flag of the in-flight older-page request. */
  loadingOlder: boolean
  onLoadOlder: () => void
}

/** Short local time for a document row. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** Badge class for one origin class. */
const originClass: Record<DocOrigin, string> = {
  instructions: css.originInstructions,
  skill: css.originSkill,
  plugin: css.originPlugin,
  recall: css.originRecall,
  runtime: css.originRuntime,
}

/** Segment class for the occupancy bar's one origin slice. */
const segmentClass: Record<DocOrigin, string> = {
  instructions: css.segInstructions,
  skill: css.segSkill,
  plugin: css.segPlugin,
  recall: css.segRecall,
  runtime: css.segRuntime,
}

/** Whether a document matches the search query over its label, form, origin, and text. */
function matches(doc: ContextDoc, needle: string): boolean {
  if (needle === '') return true
  const haystack = `${doc.label ?? ''} ${doc.form ?? ''} ${ORIGIN_LABEL[doc.origin]} ${doc.text}`.toLowerCase()
  return haystack.includes(needle)
}

/** One document row (shared by every section). */
function DocRow({ doc, onOpenDoc }: { doc: ContextDoc; onOpenDoc: (seq: number) => void }): ReactNode {
  return (
    <li key={doc.seq} className={css.docLi}>
      <button
        type="button"
        className={css.docItem}
        onClick={() => { onOpenDoc(doc.seq) }}
      >
        <span className={css.docLabel}>{doc.label ?? doc.form ?? '上下文'}</span>
        <span className={clsx(css.docBadge, originClass[doc.origin])}>{ORIGIN_LABEL[doc.origin]}</span>
        <span className={css.docSize}>{formatBytes(doc.bytes)}</span>
        <span className={css.docTime}>{formatTime(doc.time)}</span>
      </button>
    </li>
  )
}

/** One occupancy row: section label, measured totals, and the per-origin composition bar. */
function OccupancyRow({ title, stats, dim }: { title: string; stats: SectionStats; dim?: boolean }): ReactNode {
  return (
    <div className={clsx(css.statsRow, dim && css.statsRowDim)} title={stats.slices
      .map(slice => `${ORIGIN_LABEL[slice.origin]} ${slice.count} 篇 · ${formatBytes(slice.bytes)}`)
      .join('\n')}>
      <span className={css.statsTitle}>{title}</span>
      <span className={css.statsMeta}>{stats.count} 篇 · {formatBytes(stats.bytes)}</span>
      <div className={css.statsBar} aria-hidden="true">
        {stats.slices.map(slice => (
          <span
            key={slice.origin}
            className={segmentClass[slice.origin]}
            style={{ width: stats.bytes === 0 ? 0 : `${(slice.bytes / stats.bytes) * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** A section heading plus its document list; empty sections render a note instead. */
function DocSection({
  title, docs, emptyNote, onOpenDoc, fill = false, note,
}: {
  title: string
  docs: ContextDoc[]
  emptyNote: string
  onOpenDoc: (seq: number) => void
  /** Take the remaining column height (the history stream scrolls). */
  fill?: boolean
  /** Optional provenance note rendered under the heading (the compaction fact). */
  note?: string
}): ReactNode {
  return (
    <section className={fill ? `${css.docSection} ${css.docSectionFill}` : css.docSection}>
      <header className={css.docSectionHeader}>
        <span className={css.docSectionTitle}>{title}</span>
        <span className={css.docSectionCount}>{docs.length} 篇</span>
      </header>
      {note !== undefined && <p className={css.sectionNote}>{note}</p>}
      {docs.length === 0
        ? <p className={css.docEmpty}>{emptyNote}</p>
        : <ul className={css.docList}>{docs.map(doc => <DocRow key={doc.seq} doc={doc} onOpenDoc={onOpenDoc} />)}</ul>}
    </section>
  )
}

/**
 * Render the injected-documents view.
 * @param props - component props.
 * @returns the search box, occupancy strip, and the live-window/history sections.
 */
export function ContextDocs(props: ContextDocsProps): ReactNode {
  if (!props.hasSession) {
    return <p className={css.empty}>选择会话后显示其已注入的上下文文档。</p>
  }
  const needle = props.filter.trim().toLowerCase()
  const searching = needle !== ''
  // The filter and the section splits re-run only when the documents or the
  // query move: the per-document haystack builds (label + form + origin +
  // full text, lowercased) are the expensive part, not the splits. The
  // occupancy strip always aggregates the FULL projection — it answers how
  // the model's window is occupied, not what the filter happens to match.
  const { matchedNewest, matchedCount, activeNewest, historyNewest, activeStats, historyStats } = useMemo(() => {
    const matched = props.docs.filter(doc => matches(doc, needle))
    // Both sections read newest first: the live window answers "what does
    // the model see now", and the history stream is the same timeline read
    // backwards.
    const active = matched.filter(doc => doc.active)
    const history = matched.filter(doc => !doc.active)
    return {
      matchedNewest: [...matched].reverse(),
      matchedCount: matched.length,
      activeNewest: [...active].reverse(),
      historyNewest: [...history].reverse(),
      activeStats: sectionStats(props.docs.filter(doc => doc.active)),
      historyStats: sectionStats(props.docs.filter(doc => !doc.active)),
    }
  }, [props.docs, needle])

  return (
    <div className={css.contextLayout}>
      <div className={css.contextControls}>
        <input
          className={css.contextSearch}
          type="text"
          value={props.filter}
          onChange={(event) => { props.onFilter(event.target.value) }}
          placeholder="搜索注入文档…"
          aria-label="搜索注入文档"
        />
        <button type="button" className={css.refresh} onClick={props.onRefresh}>刷新</button>
      </div>
      {props.docs.length > 0 && (
        <div className={css.statsStrip} aria-label="上下文占用">
          <OccupancyRow title="当前有效" stats={activeStats} />
          {historyStats.count > 0 && <OccupancyRow title="已压缩" stats={historyStats} dim />}
        </div>
      )}
      {props.docs.length === 0 && (
        <div className={css.emptyBox}>
          <p className={css.empty}>当前日志窗口内尚未注入任何上下文文档。</p>
          {props.hasMore
            ? <button type="button" className={css.refresh} onClick={props.onLoadOlder}>加载更早</button>
            : null}
        </div>
      )}
      {props.docs.length > 0 && searching && (
        <section className={css.docSection}>
          <header className={css.docSectionHeader}>
            <span className={css.docSectionTitle}>匹配结果</span>
            <span className={css.docSectionCount}>{matchedCount} 篇</span>
          </header>
          {matchedCount === 0
            ? <p className={css.docEmpty}>没有匹配的注入文档。</p>
            : <ul className={css.docList}>{matchedNewest.map(doc => <DocRow key={doc.seq} doc={doc} onOpenDoc={props.onOpenDoc} />)}</ul>}
        </section>
      )}
      {props.docs.length > 0 && !searching && (
        <>
          <DocSection title="当前有效" docs={activeNewest} emptyNote="当前没有仍在窗口内的注入文档。" onOpenDoc={props.onOpenDoc} />
          <div className={css.docSectionDivider} />
          <DocSection
            title="历史流水"
            docs={historyNewest}
            emptyNote="还没有被压缩的历史注入文档。"
            onOpenDoc={props.onOpenDoc}
            fill
            note={historyStats.count > 0
              ? `最近一次压缩将 ${historyStats.count} 篇（${formatBytes(historyStats.bytes)}）移出了模型有效窗口，仍保留在持久日志中。`
              : undefined}
          />
          {props.hasMore && (
            <button
              type="button"
              className={css.loadMore}
              onClick={props.onLoadOlder}
              disabled={props.loadingOlder}
            >
              {props.loadingOlder ? '加载中…' : '加载更早的注入文档'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
