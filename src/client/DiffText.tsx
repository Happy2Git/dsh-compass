/**
 * Colored unified-diff surface for the centered previews: one line per diff
 * line, tinted by role (additions green, deletions red, hunk headers in the
 * brand color, file headers bold, metadata dim). The raw text stays verbatim —
 * the renderer only classifies each line's leading characters, never rewrites
 * content. Colors resolve through --dsw-* tokens; the sheet owns geometry.
 */
import type { ReactNode } from 'react'
import css from './Panel.module.css'

/** One diff line's presentation role, derived from its leading characters. */
type DiffLineKind = 'meta' | 'header' | 'hunk' | 'add' | 'del' | 'context'

/** Classify one unified-diff line by its prefix. */
function lineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'header'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  if (line === '' || line.startsWith(' ')) return 'context'
  // diff --git, index, new/deleted file mode, \ No newline markers…
  return 'meta'
}

const KIND_CLASS: Record<DiffLineKind, string | undefined> = {
  meta: css.diffLineMeta,
  header: css.diffLineHeader,
  hunk: css.diffLineHunk,
  add: css.diffLineAdd,
  del: css.diffLineDel,
  context: css.diffLineContext,
}

/**
 * Render one unified diff as colored lines.
 * @param props.text - the raw git diff text.
 * @returns the line list (empty diff renders one empty line, as git does).
 */
/** Complete-result bound of one rendered diff (rows; the wire is byte-capped already). */
const MAX_DIFF_LINES = 4000

/**
 * Render one unified diff as colored lines.
 * @param props.text - the raw git diff text.
 * @returns the line list (empty diff renders one empty line, as git does).
 */
export function DiffText({ text }: { text: string }): ReactNode {
  const lines = text.split('\n')
  const cut = lines.length > MAX_DIFF_LINES
  const visible = cut ? lines.slice(0, MAX_DIFF_LINES) : lines
  return (
    <div className={css.diffText}>
      {visible.map((line, index) => (
        <div key={index} className={KIND_CLASS[lineKind(line)] ?? css.diffLineContext} data-diff-line={lineKind(line)}>
          {line === '' ? ' ' : line}
        </div>
      ))}
      {cut && <div className={css.diffLineMeta}>… 行数过多，仅显示前 {MAX_DIFF_LINES} 行。</div>}
    </div>
  )
}
