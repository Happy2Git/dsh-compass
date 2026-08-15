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
export type GitCommitFileStatus = 'added' | 'modified' | 'deleted' | 'untracked'

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
}

export default Git
