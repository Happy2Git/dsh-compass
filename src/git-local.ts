/**
 * Local backend of the git seam: registers `ctx.git` by running the `git`
 * binary over `ctx.subprocess` in collected-output mode. Two primitives serve
 * the client's read-only commit-graph panel — one bounded topo-ordered page of
 * the commit DAG, and one commit's metadata plus changed-file list. Output is
 * bounded at the configured byte and item caps; parsing is the strict inverse
 * of the `--pretty=format:` strings below (field separator `%x00`, record
 * separator `%x1e`). Design rationale lives in the git capability seam Agent
 * Note.
 * @module @deepseek-ai/dsh-host-git-local
 */

import { isAbsolute as isAbsolutePosix } from 'node:path/posix'
import { isAbsolute as isAbsoluteWin32 } from 'node:path/win32'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves `ctx.subprocess` to the subprocess seam's service.
import type {} from '@deepseek-ai/dsh-subprocess'
// Type-only: resolves `ctx.webServer` to the webserver route registry.
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import {
  Git, GitError,
} from './git-seam.ts'
import type {
  GitCommitDetail, GitCommitFile, GitCommitFileStatus, GitFileDiff, GitGraphEntry, GitGraphPage, GitGraphOptions,
  GitStatusFile, GitWorkspaceFile, GitWorkspaceStatus,
} from './git-seam.ts'

/** Validated plugin configuration. */
export interface Config {
  /** Collected-output cap for one git invocation's stdout and stderr, in bytes. */
  maxOutputBytes: number
  /** Subprocess SIGTERM→SIGKILL escalation grace and collected-pipe drain grace, in ms. */
  graceMs: number
  /** Page-size cap for {@link graph}: a caller asking for more is cut here. */
  maxCommits: number
  /** Complete-result cap for one commit's changed-file list. */
  maxFiles: number
}

/** Byte cap for one request body; the routes carry only `{ cwd, ... }` payloads. */
const MAX_BODY_BYTES = 64 * 1024

/** HTTP failure with a status, answered as a structured JSON error. */
class RouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one JSON request body, enforcing the cross-site write fence (only the
 * `application/json` media type is accepted, forcing a browser preflight) and
 * a size cap. Empty body is `undefined`; a malformed body is a typed 400.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new RouteError(415, 'content type must be application/json')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new RouteError(413, 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new RouteError(400, 'body is not JSON')
  }
}

/** Write one JSON response body. */
function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/** Map a route/git failure onto an HTTP status (the client surfaces the message). */
function statusOf(error: unknown): number {
  if (error instanceof RouteError) return error.status
  return error instanceof GitError ? 400 : 500
}

/**
 * One request-bound abort signal: a client that disconnects before the
 * response finishes aborts the host work. `res` emits `close` on completion
 * too, so only the not-yet-finished case (the client actually left) aborts.
 */
function requestSignal(res: ServerResponse): AbortSignal {
  const controller = new AbortController()
  res.once('close', () => {
    if (!res.writableEnded) controller.abort(new Error('client disconnected'))
  })
  return controller.signal
}

/**
 * True when the path names one fixed filesystem location on this platform,
 * aligned with the browse backend's `fullyQualified`: POSIX-absolute on
 * POSIX; drive-qualified or full-UNC on Windows (rooted drive-less forms
 * like `\foo`/`/foo` still resolve against the process's current drive).
 */
function fullyQualified(path: string): boolean {
  return process.platform === 'win32'
    ? isAbsoluteWin32(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : isAbsolutePosix(path)
}

/** Validate one graph-request body into typed pagination controls. */
function readGraphBody(body: unknown): { cwd: string; count?: number; skip?: number } {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing cwd')
  const record = body as { cwd?: unknown; count?: unknown; skip?: unknown }
  if (typeof record.cwd !== 'string' || record.cwd === '' || !fullyQualified(record.cwd)) {
    throw new RouteError(400, 'cwd must be an absolute path')
  }
  if (record.count !== undefined && (typeof record.count !== 'number' || !Number.isInteger(record.count) || record.count <= 0)) {
    throw new RouteError(400, 'count must be a positive integer')
  }
  if (record.skip !== undefined && (typeof record.skip !== 'number' || !Number.isInteger(record.skip) || record.skip < 0)) {
    throw new RouteError(400, 'skip must be a non-negative integer')
  }
  return {
    cwd: record.cwd,
    ...(record.count === undefined ? {} : { count: record.count }),
    ...(record.skip === undefined ? {} : { skip: record.skip }),
  }
}

/** Validate one show-commit-request body into `cwd` + `hash`. */
function readShowCommitBody(body: unknown): { cwd: string; hash: string } {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing cwd or hash')
  const record = body as { cwd?: unknown; hash?: unknown }
  if (typeof record.cwd !== 'string' || record.cwd === '' || !fullyQualified(record.cwd)) {
    throw new RouteError(400, 'cwd must be an absolute path')
  }
  if (typeof record.hash !== 'string' || record.hash === '') throw new RouteError(400, 'missing hash')
  return { cwd: record.cwd, hash: record.hash }
}

/** Validate one workspace-request body into `cwd`. */
function readWorkspaceBody(body: unknown): { cwd: string } {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing cwd')
  const record = body as { cwd?: unknown }
  if (typeof record.cwd !== 'string' || record.cwd === '' || !fullyQualified(record.cwd)) {
    throw new RouteError(400, 'cwd must be an absolute path')
  }
  return { cwd: record.cwd }
}

/** Validate one status-request body into `dir`. */
function readStatusBody(body: unknown): { dir: string } {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing dir')
  const record = body as { dir?: unknown }
  if (typeof record.dir !== 'string' || record.dir === '' || !fullyQualified(record.dir)) {
    throw new RouteError(400, 'dir must be an absolute path')
  }
  return { dir: record.dir }
}

/** Validate one show-diff-request body into `cwd` + `hash` + `path`. */
function readShowDiffBody(body: unknown): { cwd: string; hash: string; path: string } {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing cwd, hash, or path')
  const record = body as { cwd?: unknown; hash?: unknown; path?: unknown }
  if (typeof record.cwd !== 'string' || record.cwd === '' || !fullyQualified(record.cwd)) {
    throw new RouteError(400, 'cwd must be an absolute path')
  }
  if (typeof record.hash !== 'string' || record.hash === '') throw new RouteError(400, 'missing hash')
  if (typeof record.path !== 'string' || record.path === '' || record.path.length > 1024) {
    throw new RouteError(400, 'missing path')
  }
  return { cwd: record.cwd, hash: record.hash, path: record.path }
}

/** Map a `--name-status` one-letter status onto the closed file-status union. */
function statusKind(letter: string): GitCommitFileStatus {
  if (letter === 'A') return 'added'
  if (letter === 'D') return 'deleted'
  return 'modified'
}

/** Map a porcelain-v1 XY pair onto the closed workspace-file status. */
function workspaceStatusKind(xy: string): GitWorkspaceFile['status'] {
  if (xy === '!!') return 'ignored'
  if (xy === '??') return 'untracked'
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

/** Classify a non-zero git exit into the closed failure vocabulary. */
function classifyFailure(stderr: string): GitError {
  const message = stderr.trim() || 'git exited with a non-zero status'
  if (/not a git repository/i.test(stderr)) return new GitError('not-a-repository', message)
  if (/unknown revision|bad object|ambiguous argument|bad revision/i.test(stderr)) return new GitError('commit-unreadable', message)
  return new GitError('git-unavailable', message)
}

/** Parse the `--name-status --no-renames` stream into a path → status map. */
function parseNameStatus(output: string): Map<string, GitCommitFileStatus> {
  const statusByPath = new Map<string, GitCommitFileStatus>()
  for (const line of output.split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const status = line.slice(0, tab).trim()
    const path = line.slice(tab + 1)
    if (path === '') continue
    statusByPath.set(path, statusKind(status))
  }
  return statusByPath
}

/** Parse the `--numstat --no-renames` stream into path-keyed line counts. */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const countsByPath = new Map<string, { additions: number; deletions: number }>()
  for (const line of output.split('\n')) {
    if (line === '') continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const additions = parts[0] === '-' ? 0 : Number(parts[0])
    const deletions = parts[1] === '-' ? 0 : Number(parts[1])
    const path = parts.slice(2).join('\t')
    if (path === '') continue
    countsByPath.set(path, { additions, deletions })
  }
  return countsByPath
}

/** The `ctx.git` local implementation (stateless — every call is one or two git round trips). */
export default class LocalGit extends Git {
  static inject = ['subprocess', 'webServer']

  static Config: z<Config> = z.object({
    maxOutputBytes: z.natural().min(1).default(262144),
    graceMs: z.natural().min(1).default(5000),
    maxCommits: z.natural().min(1).default(100),
    maxFiles: z.natural().min(1).default(500),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    // Loopback-only: these routes read any local repository, so they must
    // never be reachable from a network interface. Fail loud instead of
    // serving them on a non-loopback host.
    if (ctx.webServer.host !== '127.0.0.1') {
      throw new Error('git-local: /git/* is loopback-only; refuse to serve on a non-loopback host')
    }
    // Serve the two read primitives on the plugin's own routes, so the panel
    // does not need the core API gateway — a third-party git plugin carries its
    // transport with it.
    this.registerRoutes()
  }

  /** Register the plugin-owned HTTP routes with the webserver. */
  private registerRoutes(): void {
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: '/git/graph',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        try {
          const body = readGraphBody(await readJsonBody(req))
          const options: GitGraphOptions = {}
          if (body.count !== undefined) options.count = body.count
          if (body.skip !== undefined) options.skip = body.skip
          const page = await this.graph(body.cwd, options, signal)
          writeJson(res, 200, page)
        } catch (error: unknown) {
          writeJson(res, statusOf(error), { error: { message: messageOf(error) } })
        }
      },
    }), 'git-local: /git/graph')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: '/git/show-commit',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        try {
          const body = readShowCommitBody(await readJsonBody(req))
          const detail = await this.showCommit(body.cwd, body.hash, signal)
          writeJson(res, 200, detail)
        } catch (error: unknown) {
          writeJson(res, statusOf(error), { error: { message: messageOf(error) } })
        }
      },
    }), 'git-local: /git/show-commit')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: '/git/workspace',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        try {
          const body = readWorkspaceBody(await readJsonBody(req))
          const status = await this.workspaceStatus(body.cwd, signal)
          writeJson(res, 200, status)
        } catch (error: unknown) {
          writeJson(res, statusOf(error), { error: { message: messageOf(error) } })
        }
      },
    }), 'git-local: /git/workspace')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: '/git/show-diff',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        try {
          const body = readShowDiffBody(await readJsonBody(req))
          const diff = await this.showFileDiff(body.cwd, body.hash, body.path, signal)
          writeJson(res, 200, diff)
        } catch (error: unknown) {
          writeJson(res, statusOf(error), { error: { message: messageOf(error) } })
        }
      },
    }), 'git-local: /git/show-diff')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: '/git/status',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        try {
          const body = readStatusBody(await readJsonBody(req))
          const files = await this.directoryStatus(body.dir, signal)
          writeJson(res, 200, { files })
        } catch (error: unknown) {
          writeJson(res, statusOf(error), { error: { message: messageOf(error) } })
        }
      },
    }), 'git-local: /git/status')
  }

  /**
   * Run one git invocation and return its collected stdout plus the
   * truncation flag, classifying a spawn-level failure or non-zero exit into
   * {@link GitError}. Callers decide whether a lossy (truncated) stream is a
   * failure or a bounded result.
   */
  private async runGit(cwd: string, args: readonly string[], signal: AbortSignal | undefined): Promise<{ text: string; lossy: boolean }> {
    const handle = this.ctx.subprocess.spawn({
      argv: ['git', '-C', cwd, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.config.maxOutputBytes },
        stderr: { maxBytes: this.config.maxOutputBytes },
      },
      graceMs: this.config.graceMs,
      signal,
    })
    let outcome
    try {
      outcome = await handle.done
    } catch (error: unknown) {
      // A spawn-level failure means the git binary cannot run (missing from
      // PATH, not executable) — the caller's abort reason is rethrown below.
      signal?.throwIfAborted()
      throw new GitError('git-unavailable', `cannot run git: ${messageOf(error)}`)
    }
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0) {
      signal?.throwIfAborted()
      throw classifyFailure(stderr)
    }
    const stdout = handle.collected.stdout
    if (stdout === undefined) return { text: '', lossy: false }
    const read = stdout.readFrom(0)
    // A truncated stream parses into half-records with empty hashes/fields;
    // the call sites decide: page/detail/status fail closed, diff truncates.
    return { text: read.text, lossy: read.lossy }
  }

  /**
   * Collected output that must parse whole: a truncated stream fails closed.
   */
  private async runGitStrict(cwd: string, args: readonly string[], signal: AbortSignal | undefined): Promise<string> {
    const read = await this.runGit(cwd, args, signal)
    if (read.lossy) {
      throw new GitError('git-unavailable', `git output exceeded ${this.config.maxOutputBytes} bytes`)
    }
    return read.text
  }

  async graph(cwd: string, options: GitGraphOptions, signal?: AbortSignal): Promise<GitGraphPage> {
    const count = Math.min(options.count ?? this.config.maxCommits, this.config.maxCommits)
    const skip = options.skip ?? 0
    // Request count + 1 so an extra record proves `hasMore` without a second round trip.
    const output = await this.runGitStrict(cwd, [
      'log', '--all', '--topo-order', '--date-order',
      `--skip=${skip}`, `--max-count=${count + 1}`,
      '--pretty=format:%H%x00%P%x00%D%x00%s%x00%aN%x00%aI%x1e',
    ], signal)
    const entries: GitGraphEntry[] = []
    for (const record of output.split('\x1e')) {
      if (record.trim() === '') continue
      const [hash, parents, refs, message, author, date] = record.split('\x00')
      entries.push({
        hash: (hash ?? '').trim(),
        parents: (parents ?? '').trim() === '' ? [] : (parents ?? '').trim().split(/\s+/),
        refs: (refs ?? '').trim(),
        message: (message ?? '').trim(),
        author: (author ?? '').trim(),
        date: (date ?? '').trim(),
      })
    }
    const hasMore = entries.length > count
    if (hasMore) entries.length = count
    return { entries, hasMore }
  }

  async showCommit(cwd: string, hash: string, signal?: AbortSignal): Promise<GitCommitDetail> {
    // One invocation for the metadata + name-status (the `%x1e` record end
    // separates the header from the status stream), one for the line counts.
    const headerAndStatus = await this.runGitStrict(cwd, [
      'show', '-m', '--first-parent', '--no-renames',
      '--format=%H%x00%B%x00%aN%x00%aI%x1e',
      '--name-status', hash,
    ], signal)
    const numstat = await this.runGitStrict(cwd, [
      'show', '-m', '--first-parent', '--no-renames', '--format=', '--numstat', hash,
    ], signal)

    const headerEnd = headerAndStatus.indexOf('\x1e')
    const header = headerEnd === -1 ? headerAndStatus : headerAndStatus.slice(0, headerEnd)
    const statusOutput = headerEnd === -1 ? '' : headerAndStatus.slice(headerEnd + 1)
    const [commitHash, message, author, date] = header.split('\x00')

    const statusByPath = parseNameStatus(statusOutput)
    const countsByPath = parseNumstat(numstat)
    const files: GitCommitFile[] = []
    let truncated = false
    for (const [path, counts] of countsByPath) {
      if (files.length === this.config.maxFiles) {
        truncated = true
        break
      }
      files.push({
        path,
        status: statusByPath.get(path) ?? 'modified',
        additions: counts.additions,
        deletions: counts.deletions,
      })
    }

    return {
      hash: (commitHash ?? '').trim(),
      message: (message ?? '').trim(),
      author: (author ?? '').trim(),
      date: (date ?? '').trim(),
      files,
      truncated,
    }
  }

  async workspaceStatus(cwd: string, signal?: AbortSignal): Promise<GitWorkspaceStatus> {
    const statusOutput = await this.runGitStrict(cwd, ['status', '--porcelain=v1', '--branch'], signal)
    const numstatOutput = await this.runGitStrict(cwd, ['diff', 'HEAD', '--numstat', '--no-renames'], signal)

    let branch: string | null = null
    let upstream: string | null = null
    let ahead = 0
    let behind = 0
    const statusByPath = new Map<string, GitWorkspaceFile['status']>()
    for (const line of statusOutput.split('\n')) {
      if (line.startsWith('## ')) {
        const header = line.slice(3)
        // `main...origin/main [ahead 2, behind 1]`, `main [no upstream]`,
        // `No commits yet on main`, or `HEAD (no branch)`.
        const upstreamMatch = /^([^\s]+)\.\.\.([^\s]+)(?:\s+\[ahead (\d+)(?:, behind (\d+))?\])?/.exec(header)
        if (upstreamMatch !== null) {
          const matchedBranch = upstreamMatch[1]
          const matchedUpstream = upstreamMatch[2]
          if (matchedBranch !== undefined && matchedUpstream !== undefined) {
            branch = matchedBranch
            upstream = matchedUpstream
            ahead = Number(upstreamMatch[3] ?? 0)
            behind = Number(upstreamMatch[4] ?? 0)
          }
        } else if (header.startsWith('No commits yet on ')) {
          branch = header.slice('No commits yet on '.length)
        }
        continue
      }
      if (line.length < 3) continue
      const xy = line.slice(0, 2)
      if (xy === '!!') continue // ignored entries are not uncommitted changes
      if (xy === '??') {
        statusByPath.set(line.slice(3), 'untracked')
        continue
      }
      let rest = line.slice(3)
      // Renames/copies print `old -> new`; the row shows the new path.
      const arrow = rest.indexOf(' -> ')
      if (arrow !== -1) rest = rest.slice(arrow + 4)
      if (rest === '') continue
      statusByPath.set(rest, workspaceStatusKind(xy))
    }

    const countsByPath = parseNumstat(numstatOutput)
    const files: GitWorkspaceFile[] = []
    let truncated = false
    // Code-unit name order: deterministic across locales (localeCompare's
    // collation is environment-dependent and reorders mixed-case names).
    for (const [path, status] of [...statusByPath].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))) {
      if (files.length === this.config.maxFiles) {
        truncated = true
        break
      }
      const counts = countsByPath.get(path)
      files.push({
        path,
        status,
        additions: status === 'untracked' ? 0 : counts?.additions ?? 0,
        deletions: status === 'untracked' ? 0 : counts?.deletions ?? 0,
      })
    }
    return { branch, upstream, ahead, behind, files, truncated }
  }

  async directoryStatus(dir: string, signal?: AbortSignal): Promise<GitStatusFile[]> {
    // A path outside any repository reports an empty list (the directory
    // browser shows no badges) rather than a failure.
    let prefix: string
    try {
      prefix = (await this.runGitStrict(dir, ['rev-parse', '--show-prefix'], signal)).trim()
    } catch (error) {
      if (error instanceof GitError && error.code === 'not-a-repository') return []
      throw error
    }
    let output: string
    try {
      output = await this.runGitStrict(dir, ['status', '--porcelain=v1', '--ignored', '--untracked-files=all', '--', '.'], signal)
    } catch (error) {
      if (error instanceof GitError && error.code === 'not-a-repository') return []
      throw error
    }
    const files: GitStatusFile[] = []
    for (const line of output.split('\n')) {
      if (line.length < 3) continue
      const xy = line.slice(0, 2)
      let rest = line.slice(3)
      // Renames/copies print `old -> new`; the badge shows the new path.
      const arrow = rest.indexOf(' -> ')
      if (arrow !== -1) rest = rest.slice(arrow + 4)
      if (!rest.startsWith(prefix)) continue
      rest = rest.slice(prefix.length)
      // Only direct children of the browsed directory carry a badge; deeper
      // paths belong to a deeper listing.
      if (rest.includes('/')) continue
      if (rest === '') continue
      files.push({ name: rest, status: workspaceStatusKind(xy) })
    }
    // Code-unit name order: deterministic across locales.
    files.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    return files
  }

  async showFileDiff(cwd: string, hash: string, path: string, signal?: AbortSignal): Promise<GitFileDiff> {
    const read = await this.runGit(cwd, [
      'show', '--format=', '--no-ext-diff', '--unified=3', hash, '--', path,
    ], signal)
    // A diff is presentational: a cut stream renders with the truncated flag
    // instead of failing the whole view.
    return { path, diff: read.text, truncated: read.lossy }
  }
}
