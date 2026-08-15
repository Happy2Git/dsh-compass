/**
 * File-row glyph selection: a small type glyph per file name, mapped from its
 * extension onto the design system's limited icon set (there is no generic
 * "file" icon, so documents and unknown types share the browse glyph). Pure
 * and testable: the kind is a function of the name, the glyph renders it.
 */
import type { ReactNode } from 'react'
import {
  IconArchiveOutline20, IconBrowseOutline16, IconCodeOutline16, IconDataOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Panel.module.css'

/** The four glyph families a file name maps to. */
export type FileIconKind = 'code' | 'data' | 'archive' | 'doc'

/** Source and stylesheet extensions — the code glyph. */
const CODE_EXTS: ReadonlySet<string> = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'kts',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'cs', 'rb', 'php', 'swift', 'scala',
  'sh', 'bash', 'zsh', 'fish', 'sql', 'sol', 'dart', 'lua', 'r', 'm', 'mm',
  'vue', 'svelte', 'css', 'scss', 'sass', 'less', 'styl',
])

/** Data and configuration extensions — the data glyph. */
const DATA_EXTS: ReadonlySet<string> = new Set([
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'tsv',
  'env', 'lock', 'properties', 'graphql', 'gql', 'proto', 'prisma', 'gitignore',
])

/** Compressed-archive extensions — the archive glyph. */
const ARCHIVE_EXTS: ReadonlySet<string> = new Set([
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst',
])

/** The lower-cased extension of a file name ('' when there is none). A leading
 * dot (a dotfile like `.env` or `.gitignore`) yields the rest of the name. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * Map a file name onto its glyph family.
 * @param name - the file's base name.
 * @returns the glyph kind for the name's extension.
 */
export function fileIconKind(name: string): FileIconKind {
  const ext = extensionOf(name)
  if (CODE_EXTS.has(ext)) return 'code'
  if (DATA_EXTS.has(ext)) return 'data'
  if (ARCHIVE_EXTS.has(ext)) return 'archive'
  return 'doc'
}

/**
 * Render the file glyph for one name.
 * @param name - the file's base name.
 * @returns the 16px type glyph.
 */
export function FileGlyph({ name }: { name: string }): ReactNode {
  switch (fileIconKind(name)) {
    case 'code': return <IconCodeOutline16 className={css.rowGlyphIcon} />
    case 'data': return <IconDataOutline16 className={css.rowGlyphIcon} />
    case 'archive': return <IconArchiveOutline20 size={16} className={css.rowGlyphIcon} />
    default: return <IconBrowseOutline16 className={css.rowGlyphIcon} />
  }
}
