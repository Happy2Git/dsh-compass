/**
 * Wire types of the plugin-owned directory browser. Structurally identical to
 * the fork's directory-picker seam types (`DirectoryEntry` / `DirectoryListing`
 * / `DirectoryRead`), but owned by this package so the panel never depends on
 * the host's directoryPicker seam — the main-track dsh composes a native
 * chooser on desktops, and `readText` is fork-only.
 * @module dsh-compass/directory-types
 */

/** One listing row: a listing child or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — clients never join path segments themselves. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
  /** Whether the row is enterable (directory, including a symlink to one) or a file. */
  kind: 'directory' | 'file'
}

/** One directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct children: directories first (symlinks to directories included), then files — each group name-sorted. */
  entries: DirectoryEntry[]
  /**
   * True when the backend cut `entries` at its complete-result bound: the
   * level has more children than reported, and the missing rows are the
   * directories-first name-sorted tail (hidden rows count toward the bound).
   */
  truncated: boolean
}

/** One bounded text-file read. */
export interface DirectoryRead {
  /** Absolute path of the file read. */
  path: string
  /** The decoded text content (cut at the byte bound). */
  text: string
  /** True when the file continued past the byte bound. */
  truncated: boolean
}

/** Closed failure vocabulary of the directory browser. */
export type BrowseErrorCode = 'directory-unreadable' | 'directory-exists' | 'directory-create-failed' | 'file-unreadable' | 'file-not-text'

/** Typed failure thrown by the browser primitives (the route layer maps the message onto the wire). */
export class BrowseError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the host path the failure names.
   * @param message - operator-facing description.
   */
  constructor(readonly code: BrowseErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'BrowseError'
  }
}
