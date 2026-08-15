/**
 * Panel data contracts: the injected face built in apply, and the projected
 * injected-context document shown in the context tab.
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { DirectoryListing, DirectoryRead } from '../directory-types.ts'
import type { GitCommitDetail, GitGraphPage } from '../git-seam.ts'

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
  /** Project the injected-context documents of one session from its loaded log window. */
  readInjectedDocs: (sessionId: SessionId) => ContextDoc[]
  /** Whether the session log has older pages beyond the loaded window. */
  hasMoreDocs: (sessionId: SessionId) => boolean
  /** Page one earlier history batch into the window (older documents then join the projection). */
  loadOlderDocs: (sessionId: SessionId) => Promise<void>
  /** The session's workspace directory, absent when the host row carries none. */
  sessionCwd: (sessionId: SessionId) => string | undefined
}
