/**
 * Plugin-owned HTTP routes for the panel's directory browsing. The browser
 * panel cannot reach host services directly, and the core API gateway is a
 * closed contract, so this plugin registers its own routes (`/dir/list`,
 * `/dir/read-text`, `/dir/open-path`) over `ctx.webServer` and answers them
 * from the plugin-owned directory browser (`./directory-browse.ts`) — no
 * directoryPicker seam dependency, so the package runs on any dsh
 * composition (the main-track profile resolves a native chooser on desktops).
 * @module dsh-compass/directory-routes
 */

import { isAbsolute as isAbsolutePosix } from 'node:path/posix'
import { isAbsolute as isAbsoluteWin32 } from 'node:path/win32'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { execFile } from 'node:child_process'
import z from '@deepseek-ai/schemastery'
import { createDirectory, listDirectory, readImageFile, readTextFile, type BrowseConfig } from './directory-browse.ts'

/** Testable command boundary; native implementations never invoke a shell. */
export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a host command with utf8 stdio, abort propagation, and Windows hide.
 * @param command - executable path or PATH name.
 * @param args - argv (never a shell string).
 * @param signal - caller/connection lifetime; abort terminates the child.
 * @returns captured stdout/stderr on exit 0.
 */
const runNativeCommand: NativeCommandRunner = (command, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', signal, windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) {
          const failure = Object.assign(new Error(error.message, { cause: error }), {
            code: error.code,
            stdout,
            stderr,
          })
          reject(failure)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })

/** Byte cap for one request body; the routes carry only `{ path }` payloads. */
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

/** HTTP status for a thrown route failure (every business failure is a client 400). */
function statusOf(error: unknown): number {
  return error instanceof RouteError ? error.status : 400
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

/** Validate one `{ path }` payload as an absolute host path. */
function readAbsolutePath(body: unknown): string {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing path')
  const path = (body as { path?: unknown }).path
  if (typeof path !== 'string' || path === '') throw new RouteError(400, 'missing path')
  if (!fullyQualified(path)) throw new RouteError(400, 'path must be absolute')
  return path
}

/** Injectable platform facts for deterministic opener tests. */
export interface OpenPathInternals {
  /** Platform override; defaults to the ambient `process.platform`. */
  platform?: NodeJS.Platform
  /** Native command runner override; defaults to the real `runNativeCommand`. */
  run?: NativeCommandRunner
}

/**
 * Open one host path with its default application (minimal, no-shell):
 * `open(1)` on macOS, `Invoke-Item` through PowerShell on Windows,
 * `xdg-open` elsewhere.
 * @param path - absolute host path handed to the platform command.
 * @param signal - request lifetime; abort terminates the native command.
 * @param internals - platform and runner hooks for deterministic tests.
 * @returns resolves when the platform command exits successfully.
 */
export async function openPathNative(
  path: string, signal: AbortSignal, internals: OpenPathInternals = {},
): Promise<void> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand
  if (platform === 'darwin') {
    await run('open', [path], signal)
    return
  }
  if (platform === 'win32') {
    const literal = `'${path.replace(/'/g, "''")}'`
    await run('powershell.exe', ['-NoProfile', '-Command', `Invoke-Item -LiteralPath ${literal}`], signal)
    return
  }
  await run('xdg-open', [path], signal)
}

/** Wrap one route body in the read-validate-answer shape. */
async function serve(res: ServerResponse, run: () => Promise<unknown>): Promise<void> {
  try {
    writeJson(res, 200, await run())
  } catch (error: unknown) {
    writeJson(res, statusOf(error), { error: { message: messageOf(error) } })
  }
}

/** The raster formats panel image intake serves, matched by magic bytes. */
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/**
 * Match encoded raster bytes against the fixed format set: the actual header,
 * never a filename extension (a renamed file's extension lies, its magic
 * bytes do not). Unknown content has no image intake path.
 */
function sniffImageMediaType(data: Uint8Array): (typeof IMAGE_MEDIA_TYPES)[number] | undefined {
  const head = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 12))
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (head.length >= 6 && (head.toString('ascii', 0, 6) === 'GIF87a' || head.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif'
  return undefined
}

/** One raw wire event the injected-doc extractor reads (structural; no session-package dependency). */
interface WireSessionEvent {
  seq: number
  time: number
  type: string
  surfaceOp?: { op: string } | undefined
  data?: {
    source?: { kind?: string } | undefined
    content?: readonly { type: string; text?: string }[] | undefined
  }
}

/** Validate one injected-docs-request body into its session id. */
function readDocEventsBody(body: unknown): { sessionId: string } {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'missing sessionId')
  const sessionId = (body as { sessionId?: unknown }).sessionId
  if (typeof sessionId !== 'string' || sessionId === '') throw new RouteError(400, 'missing sessionId')
  return { sessionId }
}

/** Bounded revision-keyed memo of one session's filtered doc events. */
const docEventCache = new Map<string, { revision: unknown; events: WireSessionEvent[] }>()
const DOC_EVENT_CACHE_MAX = 8

/** Filter one event log down to the injected-document source events (text blocks only). */
function filterDocEvents(events: readonly WireSessionEvent[]): WireSessionEvent[] {
  const docs: WireSessionEvent[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (event.data?.source === undefined || event.data.source.kind === 'user') continue
    docs.push({
      seq: event.seq,
      time: event.time,
      type: event.type,
      ...event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp },
      data: {
        source: event.data.source,
        content: (event.data.content ?? []).filter(block => block.type === 'text'),
      },
    })
  }
  return docs
}

/**
 * The persistence store's filtered doc events for one session, memoized by
 * the store's opaque revision token. The live session's unflushed events
 * merge per request, so the memo never serves stale tails.
 */
async function persistedDocEvents(
  ctx: Context,
  sessionId: string,
  signal: AbortSignal,
): Promise<{ events: WireSessionEvent[]; revision: unknown }> {
  const persistence = ctx.get('sessionPersistence') as {
    inspect(id: string, signal?: AbortSignal): Promise<{ events: readonly WireSessionEvent[] }>
    listSnapshots(signal?: AbortSignal): Promise<{ header: { id: string }; revision: unknown }[]>
  } | undefined
  if (persistence === undefined) return { events: [], revision: undefined }
  const snapshots = await persistence.listSnapshots(signal)
  const revision = snapshots.find(snapshot => snapshot.header.id === sessionId)?.revision
  const cached = docEventCache.get(sessionId)
  if (cached !== undefined && cached.revision === revision) return cached
  const events = (await persistence.inspect(sessionId, signal)).events
  const entry = { revision, events: filterDocEvents(events) }
  docEventCache.set(sessionId, entry)
  if (docEventCache.size > DOC_EVENT_CACHE_MAX) {
    const oldest = docEventCache.keys().next().value
    if (oldest !== undefined) docEventCache.delete(oldest)
  }
  return entry
}

/**
 * Collect one session's injected-document source events from the complete
 * durable log: every `user/message` whose source is not the human, plus their
 * surface op for compaction-checkpoint detection. Serves the live session's
 * unflushed events on top of the persistence store's (memoized) log, deduped
 * by seq. Text blocks only: image and tool payloads never cross this wire.
 */
async function injectedDocEvents(ctx: Context, sessionId: string, signal: AbortSignal): Promise<WireSessionEvent[]> {
  const { events: persisted } = await persistedDocEvents(ctx, sessionId, signal)
  const sessions = ctx.get('sessions') as {
    get(id: string): { events: readonly WireSessionEvent[] } | undefined
  } | undefined
  const live = sessions?.get(sessionId)
  if (live === undefined) return persisted
  const bySeq = new Map<number, WireSessionEvent>()
  for (const event of persisted) bySeq.set(event.seq, event)
  for (const event of live.events) bySeq.set(event.seq, event)
  // Filter once more after the merge: the live window's raw events carry
  // human messages too, and only the doc-relevant events may cross the wire.
  return filterDocEvents([...bySeq.values()].sort((left, right) => left.seq - right.seq))
}

/** The route-registration plugin body. */
export default class DirectoryRoutes {
  static inject = ['webServer']

  static Config: z<BrowseConfig> = z.object({
    maxEntries: z.natural().min(1).default(1000),
    maxTextBytes: z.natural().min(1).default(262144),
    maxImageBytes: z.natural().min(1).default(8 * 1024 * 1024),
  })

  constructor(ctx: Context, private readonly config: BrowseConfig) {
    // Loopback-only: these routes read and open arbitrary host paths, so they
    // must never be reachable from a network interface. Fail loud instead of
    // serving them on a non-loopback host.
    if (ctx.webServer.host !== '127.0.0.1') {
      throw new Error('directory-routes: /dir/* is loopback-only; refuse to serve on a non-loopback host')
    }
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dir/list',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        await serve(res, async () => {
          const body = await readJsonBody(req) as { path?: string } | undefined
          const path = body === undefined ? undefined : readAbsolutePath(body)
          return await listDirectory(this.config, path, signal)
        })
      },
    }), 'directory-routes: /dir/list')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dir/read-text',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        await serve(res, async () => {
          const path = readAbsolutePath(await readJsonBody(req))
          return await readTextFile(this.config, path, signal)
        })
      },
    }), 'directory-routes: /dir/read-text')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dir/read-image',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        await serve(res, async () => {
          const path = readAbsolutePath(await readJsonBody(req))
          const read = await readImageFile(this.config, path, signal)
          // The attachment per-file limit is the authoritative intake bound
          // when the host composes an attachment store; enforce it here so an
          // oversized image never crosses the wire just to be refused.
          const attachments = ctx.get('attachments') as {
            imageLimits: { maxImageBytes: number }
          } | undefined
          if (attachments !== undefined && read.data.byteLength > attachments.imageLimits.maxImageBytes) {
            throw new RouteError(413, 'image exceeds the configured per-file limit')
          }
          const mediaType = sniffImageMediaType(read.data)
          if (mediaType === undefined) throw new RouteError(415, 'not a supported image format')
          return { path: read.path, mediaType, data: Buffer.from(read.data).toString('base64') }
        })
      },
    }), 'directory-routes: /dir/read-image')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dir/injected-docs',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        await serve(res, async () => {
          const body = readDocEventsBody(await readJsonBody(req))
          return { events: await injectedDocEvents(ctx, body.sessionId, signal) }
        })
      },
    }), 'directory-routes: /dir/injected-docs')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dir/open-path',
      handler: async (req, res) => {
        const signal = requestSignal(res)
        await serve(res, async () => {
          const path = readAbsolutePath(await readJsonBody(req))
          await openPathNative(path, signal)
          return { opened: true }
        })
      },
    }), 'directory-routes: /dir/open-path')
  }
}
