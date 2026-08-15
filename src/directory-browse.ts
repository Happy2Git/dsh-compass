/**
 * Plugin-owned directory browser: one-level listing, bounded text read, and
 * child-directory creation over the host filesystem via Node's stdlib. The
 * panel's routes call these primitives directly instead of the host's
 * directoryPicker seam, so the package works on any dsh composition — the
 * main-track web profile resolves a native chooser on desktops (no in-app
 * browse capability) and its seam lacks `readText`. Policy decisions (hidden
 * entries flagged but returned, symlinks followed, whole-filesystem scope)
 * mirror the fork's directory-picker-browse backend.
 * @module dsh-compass/directory-browse
 */

import { mkdir, open, opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'
import { BrowseError, type DirectoryEntry, type DirectoryListing, type DirectoryRead } from './directory-types.ts'

/** Validated browser bounds, owned by the plugin's Config. */
export interface BrowseConfig {
  /** Complete-result bound of one listing level. */
  maxEntries: number
  /** Complete-read bound of one text file, in bytes. */
  maxTextBytes: number
}

/**
 * Ancestor chain from the filesystem root to `target` inclusive — the
 * breadcrumb rows of a listing, every one a jump target.
 */
function ancestryCrumbs(target: string): DirectoryEntry[] {
  const crumbs: DirectoryEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    // basename of a root is '' — label the root crumb by its full path ('/', 'C:\').
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, hidden: false, kind: 'directory' })
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/** One streamed listing candidate: the dirent facts a row needs, nothing else retained. */
interface ListingCandidate {
  /** Base name within the streamed level. */
  name: string
  /** Dirent or symlink probe says directory. */
  isDirectory: boolean
  /** Dirent says symlink (enterability needs a stat probe). */
  isSymbolicLink: boolean
}

/**
 * Order two listing candidates: directories first, then files — each group
 * name-ascending. A symlink's group is its target's kind, probed by the
 * caller before the insert.
 */
function compareCandidates(a: ListingCandidate, b: ListingCandidate): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name.localeCompare(b.name)
}

/**
 * Insert a streamed candidate into the directories-first bounded window,
 * evicting the largest candidate when the window exceeds `keep`. Memory over
 * an arbitrarily large level therefore stays O(keep) regardless of how many
 * children the directory holds.
 * @param window - the directories-first name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
function boundedInsert(window: ListingCandidate[], candidate: ListingCandidate, keep: number): boolean {
  // Full window, candidate at or beyond the tail: one comparison rejects, so
  // an oversized level costs O(1) per candidate past the head.
  if (window.length === keep && compareCandidates(candidate, window[window.length - 1]!) >= 0) return true
  // Binary insertion keeps a retained candidate at O(log keep) comparisons.
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (compareCandidates(candidate, window[mid]!) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation
 * itself keeps running against a handle the caller then closes — its late
 * settlement is swallowed here so an abandoned read cannot surface as an
 * unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller,
        // and the abort reason already carried the outcome.
      })
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/** The thrown value as an Error (wire/abort reasons may be anything). */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Swallow the close failure of a handle its caller already departed. */
function swallowCloseFailure(): void {}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One listing row for a dirent, following symlinks: a directory (or a symlink
 * to one) becomes an enterable directory row, a file (or a symlink to one)
 * becomes a file row, and broken/cyclic links or exotic targets return null
 * (skipped silently — the browser shows what exists, and a broken link is not
 * a row anyone can act on).
 */
async function entryRow(
  parent: string, name: string, isDirectory: boolean, isSymbolicLink: boolean, signal: AbortSignal | undefined,
): Promise<DirectoryEntry | null> {
  const path = join(parent, name)
  let kind: 'directory' | 'file' = isDirectory ? 'directory' : 'file'
  if (isSymbolicLink) {
    try {
      // The probe races the caller too: a symlink target on a stalled
      // network filesystem must not keep a departed caller's request alive.
      const target = await raceAbort(stat(path), signal)
      if (target.isDirectory()) kind = 'directory'
      else if (target.isFile()) kind = 'file'
      else return null
    } catch {
      if (signal?.aborted) throw asError(signal.reason)
      // Broken or cyclic symlink: stat is the probe, failure means "no row".
      return null
    }
  }
  // POSIX hidden convention; Windows' hidden attribute is not exposed by
  // dirents. The client owns whether hidden rows show.
  return { name, path, hidden: name.startsWith('.'), kind }
}

/**
 * List one directory level, bounded and directories-first.
 * @param config - listing and read bounds.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the scan.
 * @returns the level's listing with ancestry.
 * @throws {BrowseError} `directory-unreadable` when the target is not fully
 * qualified or cannot be listed.
 */
export async function listDirectory(config: BrowseConfig, path: string | undefined, signal?: AbortSignal): Promise<DirectoryListing> {
  const home = homedir()
  if (path !== undefined && !fullyQualified(path)) {
    throw new BrowseError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
  }
  const target = resolve(path ?? home)
  // Stream the level (opendir, one dirent at a time) into a directories-first
  // window of maxEntries + 1 candidates: memory stays bounded no matter how
  // many children the directory holds, and the +1 slot lets an in-window
  // extra row prove the cut.
  const keep = config.maxEntries + 1
  const window: ListingCandidate[] = []
  let evicted = false
  try {
    const opening = opendir(target)
    const level = await raceAbort(opening, signal).catch((error: unknown) => {
      // The abandoned open can still mint a handle after the abort won;
      // close it so a departed caller cannot leak a descriptor.
      void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
        // Already rejected: raceAbort surfaced or swallowed it.
      })
      throw error
    })
    try {
      for (;;) {
        const dirent = await raceAbort(level.read(), signal)
        if (dirent === null) break
        // Rows a browser could act on contend for the window; dirent says
        // "directory" or "file" outright, a symlink needs the stat probe.
        if (!dirent.isDirectory() && !dirent.isFile() && !dirent.isSymbolicLink()) continue
        // A symlink's sort group is its target's kind: probe it during the
        // stream (racing the caller like every other filesystem await), so
        // a symlinked directory sorts with the directories.
        let isDirectory = dirent.isDirectory()
        if (dirent.isSymbolicLink()) {
          try {
            const targetStat = await raceAbort(stat(join(target, dirent.name)), signal)
            isDirectory = targetStat.isDirectory()
          } catch {
            // Broken or cyclic symlink: keep the dirent kind for the sort;
            // entryRow drops the row later.
            if (signal?.aborted) throw asError(signal.reason)
          }
        }
        const candidate = { name: dirent.name, isDirectory, isSymbolicLink: dirent.isSymbolicLink() }
        if (boundedInsert(window, candidate, keep)) evicted = true
      }
    } finally {
      // Manual read() never auto-closes; close on every exit. The aborted
      // exit must not await it — Node queues close behind any in-flight
      // read, so awaiting would chain the departed caller back onto the
      // very stall the abort escaped.
      const closing = level.close()
      if (signal?.aborted) {
        closing.catch(swallowCloseFailure)
      } else {
        await closing
      }
    }
  } catch (error: unknown) {
    // An abort is the caller's own reason, not an unreadable directory.
    signal?.throwIfAborted()
    throw new BrowseError('directory-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
  }
  const entries: DirectoryEntry[] = []
  let truncated = evicted
  for (const candidate of window) {
    // A caller that departed between reads and probes stops before the
    // next probe (each probe's own await is raced inside entryRow).
    signal?.throwIfAborted()
    const row = await entryRow(target, candidate.name, candidate.isDirectory, candidate.isSymbolicLink, signal)
    if (row === null) continue
    if (entries.length === config.maxEntries) {
      truncated = true
      break
    }
    entries.push(row)
  }
  return { path: target, home, crumbs: ancestryCrumbs(target), entries, truncated }
}

/**
 * Read one text file, bounded at `maxTextBytes` (the +1 byte proves the cut)
 * with a NUL-byte binary verdict.
 * @param config - listing and read bounds.
 * @param path - absolute path of the file to read.
 * @param signal - caller lifetime; abort stops the read.
 * @returns the decoded prefix plus the truncation flag.
 * @throws {BrowseError} `file-unreadable` when the file cannot be read,
 * `file-not-text` when a NUL byte marks binary content.
 */
export async function readTextFile(config: BrowseConfig, path: string, signal?: AbortSignal): Promise<DirectoryRead> {
  if (!fullyQualified(path)) {
    throw new BrowseError('file-unreadable', path, `cannot read "${path}": not a fully qualified path`)
  }
  const target = resolve(path)
  try {
    const opening = open(target, 'r')
    const handle = await raceAbort(opening, signal).catch((error: unknown) => {
      void opening.then(h => h.close().catch(swallowCloseFailure), () => {})
      throw error
    })
    try {
      // One bounded read: maxTextBytes + 1 proves the cut without holding
      // more than the bound plus one byte in memory.
      const buffer = Buffer.allocUnsafe(config.maxTextBytes + 1)
      const { bytesRead } = await raceAbort(handle.read(buffer, 0, buffer.length, 0), signal)
      const content = buffer.subarray(0, bytesRead)
      // A NUL byte marks binary content: decoding it would hand the browser
      // mojibake where a preview cannot exist.
      if (content.includes(0)) {
        throw new BrowseError('file-not-text', target, `${target} is not a text file`)
      }
      const truncated = bytesRead > config.maxTextBytes
      return {
        path: target,
        text: content.subarray(0, config.maxTextBytes).toString('utf8'),
        truncated,
      }
    } finally {
      const closing = handle.close()
      if (signal?.aborted) {
        closing.catch(swallowCloseFailure)
      } else {
        await closing
      }
    }
  } catch (error: unknown) {
    // An abort is the caller's own reason, not an unreadable file; the
    // binary verdict is already dressed above.
    signal?.throwIfAborted()
    if (error instanceof BrowseError) throw error
    throw new BrowseError('file-unreadable', target, `cannot read ${target}: ${messageOf(error)}`)
  }
}

/**
 * Create one child directory under an existing parent.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment (no separators, not `.`/`..`).
 * @returns the created directory's absolute path.
 * @throws {BrowseError} `directory-exists` for an existing child,
 * `directory-create-failed` for an invalid parent or any other failure.
 */
export async function createDirectory(path: string, name: string): Promise<string> {
  if (!fullyQualified(path)) {
    throw new BrowseError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
  }
  const parent = resolve(path)
  if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new BrowseError('directory-create-failed', join(parent, name), `"${name}" is not a single path segment`)
  }
  const target = join(parent, name)
  try {
    // Non-recursive: the parent is the directory the browser is showing, so
    // a missing parent is a real failure, not a level to invent.
    await mkdir(target)
    return target
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw new BrowseError('directory-exists', target, `${target} already exists`)
    }
    throw new BrowseError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`)
  }
}
