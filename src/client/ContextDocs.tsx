/**
 * Context tab: the session's injected-context documents split into the live
 * window (still in the model's context) and the shadowed history (compacted
 * away), with a search box over both. A click opens a document in the centered
 * pop-out (same interaction as a file row); the "load earlier" control pages
 * the runtime window back so the session-start baseline instructions
 * (AGENTS.md and friends) join the history stream.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import css from './Panel.module.css'
import type { ContextDoc } from './types.ts'

/** Component props: fetched documents, search state, window paging, and the center-open callback. */
export interface ContextDocsProps {
  docs: ContextDoc[]
  /** Search query over the documents' label, form, badge, and text. */
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

/** Presentation badge: file-backed instructions vs runtime-injected context. */
function docBadge(doc: ContextDoc): string {
  return doc.form === 'instructions' ? '指令文件' : '动态上下文'
}

/** Whether a document matches the search query over its label, form, badge, and text. */
function matches(doc: ContextDoc, needle: string): boolean {
  if (needle === '') return true
  const haystack = `${doc.label ?? ''} ${doc.form ?? ''} ${docBadge(doc)} ${doc.text}`.toLowerCase()
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
        <span className={css.docBadge}>{docBadge(doc)}</span>
        <span className={css.docTime}>{formatTime(doc.time)}</span>
      </button>
    </li>
  )
}

/** A section heading plus its document list; empty sections render a note instead. */
function DocSection({
  title, docs, emptyNote, onOpenDoc, fill = false,
}: {
  title: string
  docs: ContextDoc[]
  emptyNote: string
  onOpenDoc: (seq: number) => void
  /** Take the remaining column height (the history stream scrolls). */
  fill?: boolean
}): ReactNode {
  return (
    <section className={fill ? `${css.docSection} ${css.docSectionFill}` : css.docSection}>
      <header className={css.docSectionHeader}>
        <span className={css.docSectionTitle}>{title}</span>
        <span className={css.docSectionCount}>{docs.length} 篇</span>
      </header>
      {docs.length === 0
        ? <p className={css.docEmpty}>{emptyNote}</p>
        : <ul className={css.docList}>{docs.map(doc => <DocRow key={doc.seq} doc={doc} onOpenDoc={onOpenDoc} />)}</ul>}
    </section>
  )
}

/**
 * Render the injected-documents view.
 * @param props - component props.
 * @returns the search box plus the live-window and history sections.
 */
export function ContextDocs(props: ContextDocsProps): ReactNode {
  if (!props.hasSession) {
    return <p className={css.empty}>选择会话后显示其已注入的上下文文档。</p>
  }
  const needle = props.filter.trim().toLowerCase()
  const searching = needle !== ''
  // The filter and the section splits re-run only when the documents or the
  // query move: the per-document haystack builds (label + form + badge +
  // full text, lowercased) are the expensive part, not the splits.
  const { matchedNewest, matchedCount, activeNewest, historyNewest } = useMemo(() => {
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
          <DocSection title="历史流水" docs={historyNewest} emptyNote="还没有被压缩的历史注入文档。" onOpenDoc={props.onOpenDoc} fill />
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
