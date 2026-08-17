/**
 * Service Definition for the `ctx.git` capability seam: read-only git history
 * for the web-GUI host. Two primitives serve the client's commit-graph panel —
 * one bounded page of the topo-ordered commit DAG, and the changed-file list of
 * one commit. There are no write primitives: staging, committing, branching,
 * and their friends stay out of this seam. The local implementation lives in
 * `@deepseek-ai/dsh-host-git-local`.
 * @module @deepseek-ai/dsh-host-git
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** One commit in the graph page: the DAG facts and the display fields a lane graph needs. */
export interface GitGraphEntry {
  /** Full commit hash. */
  hash: string
  /** Parent hashes, in order (empty for a root commit). */
  parents: string[]
  /** Raw `%D` ref decorations (e.g. `HEAD -> main, origin/main`); the client parses them. */
  refs: string
  /** Commit subject line (`%s`). */
  message: string
  /** Author name (`%aN`). */
  author: string
  /** Author date, ISO-8601 (`%aI`). */
  date: string
}

/** One bounded page of the commit graph plus whether more history follows. */
export interface GitGraphPage {
  /** The requested commits, oldest-first or newest-first as the backend ordered them. */
  entries: GitGraphEntry[]
  /** True when the backend cut the page at its bound — more commits follow after `skip`. */
  hasMore: boolean
}

/** Change kind of one file within a commit or in the working tree. */
export type GitCommitFileStatus = 'added' | 'modified' | 'deleted' | 'untracked' | 'ignored'

/**
 * Priority order for aggregating a directory's descendant statuses: the
 * strongest signal wins. "Modified" ranks first (an edit somewhere inside
 * outranks a stray untracked file), and "ignored" ranks last so an ignored
 * cache cannot crowd out real changes.
 */
const AGGREGATE_PRIORITY: readonly GitCommitFileStatus[] = ['modified', 'added', 'deleted', 'untracked', 'ignored']

/**
 * Aggregate many descendant statuses into one presentation status, or null
 * for an empty input. Pure wire-layer logic shared by the host fold and its
 * tests.
 * @param statuses - descendant statuses of one directory child.
 * @returns the strongest status, or null when there is nothing to show.
 */
export function aggregateStatus(statuses: readonly GitCommitFileStatus[]): GitCommitFileStatus | null {
  for (const rank of AGGREGATE_PRIORITY) {
    if (statuses.includes(rank)) return rank
  }
  return null
}

/**
 * Map one `git status --porcelain=v1` XY pair onto the closed status
 * vocabulary. Staged/unstaged combinations collapse the way the workspace
 * fold always has: A anywhere means added, D anywhere means deleted, the
 * rest are modified.
 * @param xy - the two status characters of one porcelain line.
 * @returns the presentation status.
 */
export function porcelainStatus(xy: string): GitCommitFileStatus {
  if (xy === '!!') return 'ignored'
  if (xy === '??') return 'untracked'
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

/** One file a commit touched, with its line-count facts. */
export interface GitCommitFile {
  /** Repo-relative path. */
  path: string
  /** Whether the commit added, modified, or deleted the file (renames are shown as delete + add). */
  status: GitCommitFileStatus
  /** Added line count (0 for binary files). */
  additions: number
  /** Deleted line count (0 for binary files). */
  deletions: number
}

/** One commit's metadata plus its changed files, for the expanded detail row. */
export interface GitCommitDetail {
  /** Full commit hash. */
  hash: string
  /** Commit message (subject + body, trimmed). */
  message: string
  /** Author name. */
  author: string
  /** Author date, ISO-8601. */
  date: string
  /** Changed files, in the backend's diff order. */
  files: GitCommitFile[]
  /** True when the backend cut `files` at its complete-result bound. */
  truncated: boolean
}

/** Pagination and bound controls for {@link Git.graph}. */
export interface GitGraphOptions {
  /** Number of commits to return; the backend caps it at its configured maximum. */
  count?: number
  /** Commit offset for lazy "load more". */
  skip?: number
}

/** One uncommitted working-tree file. */
export interface GitWorkspaceFile {
  /** Repo-relative path. */
  path: string
  /** What the working tree changed about the file (`untracked` files carry no line counts). */
  status: GitCommitFileStatus
  /** Added line count (0 for untracked files). */
  additions: number
  /** Deleted line count (0 for untracked files). */
  deletions: number
}

/** One read-only snapshot of the working tree: branch position and uncommitted changes. */
export interface GitWorkspaceStatus {
  /** Current branch name, or null on a detached HEAD. */
  branch: string | null
  /** Upstream branch (`origin/main` form), or null when no upstream is configured. */
  upstream: string | null
  /** Commits ahead of the upstream (0 without an upstream). */
  ahead: number
  /** Commits behind the upstream (0 without an upstream). */
  behind: number
  /** Uncommitted files, name-sorted; `truncated` flags a cut at the backend bound. */
  files: GitWorkspaceFile[]
  /** True when the backend cut `files` at its complete-result bound. */
  truncated: boolean
}

/** One direct child's working-tree status for the directory browser. */
export interface GitStatusFile {
  /** Base name within the listed directory. */
  name: string
  /**
   * The entry's own status: files, and a directory ignored in its entirety
   * (`!! dir/` porcelain line). Null for every other directory child.
   */
  status: GitCommitFileStatus | null
  /**
   * Priority-aggregated status of everything beneath a directory child (M/U
   * badges on folder rows); null for files and for directories with no
   * working-tree changes anywhere inside.
   */
  aggregate: GitCommitFileStatus | null
}

/**
 * Fold one `git status --porcelain=v1 --ignored --untracked-files=all` output
 * into per-direct-child status entries for a directory listing. Direct-child
 * files keep their own status; every deeper path contributes its status to
 * its top-level directory's aggregate (renames count at the new path, the
 * same as the workspace fold). The listing prefix (git's own
 * `--show-prefix`) is stripped before matching, so paths outside the listed
 * directory never leak in.
 * @param output - the raw porcelain text.
 * @param prefix - the repo-relative prefix of the listed directory.
 * @returns the folded status entries, name-sorted.
 */
export function foldPorcelainStatuses(output: string, prefix = ''): GitStatusFile[] {
  const byName = new Map<string, GitStatusFile>()
  const ensure = (name: string): GitStatusFile => {
    const existing = byName.get(name)
    if (existing !== undefined) return existing
    const entry: GitStatusFile = { name, status: null, aggregate: null }
    byName.set(name, entry)
    return entry
  }
  for (const line of output.split('\n')) {
    if (line.length < 3) continue
    const xy = line.slice(0, 2)
    let rest = line.slice(3)
    // Renames/copies print `old -> new`; the badge shows the new path.
    const arrow = rest.indexOf(' -> ')
    if (arrow !== -1) rest = rest.slice(arrow + 4)
    if (!rest.startsWith(prefix)) continue
    rest = rest.slice(prefix.length)
    if (rest === '') continue
    const status = porcelainStatus(xy)
    if (rest.endsWith('/')) {
      // A directory porcelain line (an ignored tree) is the directory's own
      // status, not an aggregate.
      const entry = ensure(rest.slice(0, -1))
      entry.status = status
      continue
    }
    const slash = rest.indexOf('/')
    if (slash === -1) {
      ensure(rest).status = status
      continue
    }
    // A deeper path: fold into its top-level directory's aggregate.
    const dirName = rest.slice(0, slash)
    const entry = ensure(dirName)
    const seen = entry.aggregate === null ? [] : [entry.aggregate]
    entry.aggregate = aggregateStatus([...seen, status])
  }
  return [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

/**
 * Fold one `git ls-files --others --ignored --exclude-standard --directory -z`
 * output into ignored-status entries for a directory listing. The `--directory`
 * flag collapses fully-ignored trees into single `name/` lines, so a
 * node_modules never lists its files; deeper ignored paths inside partially
 * ignored directories are not direct children and are dropped here.
 * @param output - the NUL-separated ls-files text.
 * @returns the ignored direct-child entries, name-sorted.
 */
export function foldIgnoredListing(output: string): GitStatusFile[] {
  const byName = new Map<string, GitStatusFile>()
  for (const raw of output.split('\0')) {
    const name = raw.replace(/\/+$/, '')
    if (name === '' || name.includes('/')) continue
    byName.set(name, { name, status: 'ignored', aggregate: null })
  }
  return [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

/**
 * Merge two folded status lists; entries already present in `primary` win
 * (a path is either tracked-changed/untracked or ignored, never both).
 * @param primary - the tracked-change/untracked fold.
 * @param ignored - the ignored fold.
 * @returns the merged list, name-sorted.
 */
export function mergeStatusEntries(primary: readonly GitStatusFile[], ignored: readonly GitStatusFile[]): GitStatusFile[] {
  const byName = new Map<string, GitStatusFile>()
  for (const entry of primary) byName.set(entry.name, entry)
  for (const entry of ignored) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry)
  }
  return [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

/** One file's diff within one commit. */
export interface GitFileDiff {
  /** Repo-relative path. */
  path: string
  /** Unified diff text; `truncated` flags a cut at the byte bound. */
  diff: string
  /** True when the diff output exceeded the backend's byte bound. */
  truncated: boolean
}

/** Closed failure vocabulary of the git primitives (mirrored onto the wire by consumers). */
export type GitErrorCode = 'git-unavailable' | 'not-a-repository' | 'commit-unreadable'

/** Typed failure thrown by git primitives so consumers can map business codes without string matching. */
export class GitError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param message - operator-facing description.
   */
  constructor(readonly code: GitErrorCode, message: string) {
    super(message)
    this.name = 'GitError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: Git
  }
}

/**
 * Read-only git service. Subclass, implement {@link graph} and
 * {@link showCommit}, and load the subclass as a plugin — it registers as
 * `ctx.git` (one implementation per context; loading a second throws, cordis'
 * standard duplicate-service behavior).
 */
export abstract class Git extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * One bounded page of the topo-ordered commit graph.
   * @param cwd - absolute path of the repository to read.
   * @param options - pagination and page-size controls.
   * @param signal - caller lifetime; abort stops the git scan and rejects with the abort reason.
   * @returns the page plus whether more history follows.
   * @throws {GitError} `git-unavailable` when the git binary cannot run, `not-a-repository`
   * when `cwd` is not inside a git repository.
   */
  abstract graph(cwd: string, options: GitGraphOptions, signal?: AbortSignal): Promise<GitGraphPage>

  /**
   * One commit's metadata and changed files.
   * @param cwd - absolute path of the repository to read.
   * @param hash - full or unambiguous abbreviated commit hash.
   * @param signal - caller lifetime; abort stops the git scan and rejects with the abort reason.
   * @returns the commit's display fields and bounded file list.
   * @throws {GitError} `git-unavailable` when the git binary cannot run, `not-a-repository`
   * when `cwd` is not inside a git repository, `commit-unreadable` when the hash cannot be read.
   */
  abstract showCommit(cwd: string, hash: string, signal?: AbortSignal): Promise<GitCommitDetail>

  /**
   * One read-only snapshot of the working tree.
   * @param cwd - absolute path of the repository to read.
   * @param signal - caller lifetime; abort stops the git scan and rejects with the abort reason.
   * @returns the branch position and the bounded uncommitted-file list.
   * @throws {GitError} `git-unavailable` when the git binary cannot run, `not-a-repository`
   * when `cwd` is not inside a git repository.
   */
  abstract workspaceStatus(cwd: string, signal?: AbortSignal): Promise<GitWorkspaceStatus>

  /**
   * One file's diff within one commit.
   * @param cwd - absolute path of the repository to read.
   * @param hash - full or unambiguous abbreviated commit hash.
   * @param path - repo-relative path of the file within the commit.
   * @param signal - caller lifetime; abort stops the git scan and rejects with the abort reason.
   * @returns the bounded unified diff (cut diffs carry `truncated`).
   * @throws {GitError} `git-unavailable` when the git binary cannot run, `not-a-repository`
   * when `cwd` is not inside a git repository, `commit-unreadable` when the hash cannot be read.
   */
  abstract showFileDiff(cwd: string, hash: string, path: string, signal?: AbortSignal): Promise<GitFileDiff>

  /**
   * One file's working-tree diff against HEAD (staged or unstaged). An
   * untracked file has no HEAD version: its diff is the whole file as
   * additions, produced through a `--no-index` comparison against an empty
   * file. The panel opens this from the workspace block's rows.
   * @param cwd - absolute path of the repository to read.
   * @param path - repo-relative path of the changed file.
   * @param signal - caller lifetime; abort stops the git scan and rejects with the abort reason.
   * @returns the bounded unified diff (cut diffs carry `truncated`).
   * @throws {GitError} `git-unavailable` when the git binary cannot run, `not-a-repository`
   * when `cwd` is not inside a git repository.
   */
  abstract showWorkspaceDiff(cwd: string, path: string, signal?: AbortSignal): Promise<GitFileDiff>

  /**
   * The working-tree status of one directory's direct children, for the
   * directory browser's per-file badges. A path outside any repository
   * reports an empty list rather than failing.
   * @param dir - absolute path of the directory to inspect (any depth inside a repository).
   * @param signal - caller lifetime; abort stops the git scan and rejects with the abort reason.
   * @returns one entry per direct child that git reports (modified, added,
   * untracked, or ignored); clean children carry no entry.
   */
  abstract directoryStatus(dir: string, signal?: AbortSignal): Promise<GitStatusFile[]>
}

export default Git
