/**
 * Shared text-file rendering for the panel's two preview surfaces (the
 * docked lower pane and the centered pop-out). Every text file renders: a
 * markdown name renders rich, anything else renders as plain pre-formatted
 * text. No extension allowlist — the host's bounded read + binary detection
 * decide whether content exists, not this renderer.
 */
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Panel.module.css'

/** Whether a file name should render as markdown (rich) rather than plain text. */
export function isMarkdownName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'markdown'
}

/** Render one text file's content by name. */
export function FileContent({ name, text }: { name: string; text: string }): ReactNode {
  return isMarkdownName(name)
    ? <MarkdownText text={text} />
    : <pre className={css.filePreviewText}>{text}</pre>
}
