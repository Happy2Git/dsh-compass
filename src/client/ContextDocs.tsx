/**
 * Context tab: the session's injected-context documents (workspace
 * instructions, skill invocations, goal notices, cross-session recalls) as a
 * selectable list. A click opens the document in the centered pop-out (same
 * interaction as a file row in the directory tab); the "load earlier" control
 * pages the runtime window back so the session-start baseline instructions
 * (AGENTS.md and friends) join the list.
 */
import type { ReactNode } from 'react'
import css from './Panel.module.css'
import type { ContextDoc } from './types.ts'

/** Component props: fetched documents, window paging, and the center-open callback. */
export interface ContextDocsProps {
  docs: ContextDoc[]
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

/**
 * Render the injected-documents view.
 * @param props - component props.
 * @returns the document list.
 */
export function ContextDocs(props: ContextDocsProps): ReactNode {
  if (!props.hasSession) {
    return <p className={css.empty}>选择会话后显示其已注入的上下文文档。</p>
  }
  if (props.docs.length === 0) {
    return (
      <div className={css.emptyBox}>
        <p className={css.empty}>当前日志窗口内尚未注入任何上下文文档。</p>
        {props.hasMore
          ? <button type="button" className={css.refresh} onClick={props.onLoadOlder}>加载更早</button>
          : null}
        <button type="button" className={css.refresh} onClick={props.onRefresh}>刷新</button>
      </div>
    )
  }
  return (
    <div className={css.contextLayout}>
      <div className={css.docHeader}>
        <span className={css.docCount}>已注入 {props.docs.length} 篇</span>
        <button type="button" className={css.refresh} onClick={props.onRefresh}>刷新</button>
      </div>
      <ul className={css.docList}>
        {props.docs.map(doc => (
          <li key={doc.seq} className={css.docLi}>
            <button
              type="button"
              className={css.docItem}
              onClick={() => props.onOpenDoc(doc.seq)}
            >
              <span className={css.docLabel}>{doc.label ?? doc.form ?? '上下文'}</span>
              <span className={css.docBadge}>{docBadge(doc)}</span>
              <span className={css.docTime}>{formatTime(doc.time)}</span>
            </button>
          </li>
        ))}
      </ul>
      {props.hasMore
        ? (
          <button
            type="button"
            className={css.loadMore}
            onClick={props.onLoadOlder}
            disabled={props.loadingOlder}
          >
            {props.loadingOlder ? '加载中…' : '加载更早的注入文档'}
          </button>
        )
        : null}
    </div>
  )
}
