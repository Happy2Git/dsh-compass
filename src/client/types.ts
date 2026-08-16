/**
 * Panel data contracts: the injected face built in apply, and the projected
 * injected-context document shown in the context tab.
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { DirectoryListing, DirectoryRead } from '../directory-types.ts'
import type { GitCommitDetail, GitFileDiff, GitGraphPage, GitStatusFile, GitWorkspaceStatus } from '../git-seam.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { DocsStream } from './docs-stream.ts'

/** One injected-context document projected from a logged non-user message. */
export interface ContextDoc {
  /** Sequence of the durable event this document came from. */
  seq: number
  /** Unix epoch ms from the source event. */
  time: number
  /** Model-facing role of the context (inject / recall). */
  role: 'inject' | 'recall'
  /** Producer label: instruction paths, session titles, plugin id, or the source kind. */
  label: string | null
  /** Producer-declared information form, or null when this UI presents it opaquely. */
  form: string | null
  /** The complete rendered markdown text. */
  text: string
  /** True while the document is still in the model's live window (not shadowed by a compaction checkpoint). */
  active: boolean
}

/**
 * The injected face the panel component receives: plain callbacks closed over
 * the apply context. Event-handler reads only; render reads arrive through
 * the framework hooks and the declared store. Property-function syntax (not
 * method syntax) matches the arrow closures apply produces — no `this` — and
 * keeps unbound-method lint silent at every pass-through site.
 */
export interface InjectedFace {
  /** List one directory level through the Host's browse capability. */
  listDirectory: (path: string | undefined, signal: AbortSignal) => Promise<DirectoryListing>
  /** Read one text file's content through the Host's browse capability. */
  readText: (path: string, signal: AbortSignal) => Promise<DirectoryRead>
  /** Open a path with the Host operating system's default application. */
  openPath: (path: string) => Promise<void>
  /** One bounded page of the topo-ordered commit graph for a repository. */
  gitGraph: (cwd: string, count: number | undefined, skip: number | undefined, signal: AbortSignal) => Promise<GitGraphPage>
  /** One commit's metadata and changed files. */
  gitShowCommit: (cwd: string, hash: string, signal: AbortSignal) => Promise<GitCommitDetail>
  /** One read-only snapshot of the working tree (branch, ahead/behind, uncommitted files). */
  workspaceStatus: (cwd: string, signal: AbortSignal) => Promise<GitWorkspaceStatus>
  /** One file's unified diff within one commit. */
  showFileDiff: (cwd: string, hash: string, path: string, signal: AbortSignal) => Promise<GitFileDiff>
  /** One workspace file's working-tree diff against HEAD (staged or unstaged). */
  showWorkspaceDiff: (cwd: string, path: string, signal: AbortSignal) => Promise<GitFileDiff>
  /** One directory's per-child working-tree statuses for the tree badges. */
  gitStatusFor: (dir: string, signal: AbortSignal) => Promise<GitStatusFile[]>
  /** Project the injected-context documents of one session from its loaded log window. */
  readInjectedDocs: (sessionId: SessionId) => ContextDoc[]
  /** The latest in-window compaction checkpoint's seq, or null when none is loaded. */
  compactionBoundary: (sessionId: SessionId) => number | null
  /**
   * Fetch one session's complete injected-document source events through the
   * plugin-owned `/dir/injected-docs` route (the host filters the durable log
   * server-side, so tool payloads never cross the wire) and fold them with
   * the same provenance readers as the live projection. The shared
   * conversation window stays untouched. Failures answer an empty fold.
   */
  fetchDocEvents: (sessionId: SessionId, signal: AbortSignal) => Promise<{ docs: ContextDoc[]; boundary: number }>
  /** Whether the session log has older pages beyond the loaded window. */
  hasMoreDocs: (sessionId: SessionId) => boolean
  /** Page one earlier history batch into the window (older documents then join the projection). */
  loadOlderDocs: (sessionId: SessionId) => Promise<void>
  /** The session's workspace directory, absent when the host row carries none. */
  sessionCwd: (sessionId: SessionId) => string | undefined
  /**
   * Registrant-private observable sources, bound by the renderer to
   * `use<Name>` selector hooks. `docsStream` moves whenever the current
   * session's conversation stream advances, driving the context tab's
   * automatic re-projection.
   */
  hooks: {
    docsStream: ObservableSnapshot<DocsStream>
  }
}
