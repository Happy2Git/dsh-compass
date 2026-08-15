/**
 * Web context-and-files panel plugin, browser half: one list-slot entry into
 * `shell.overlay` (the frame-wide floating layer — additive by id, and the
 * shipped seat for a surface of your own). The entry declares the panel's
 * viewing-state store and injects plain callbacks closed over the runtime
 * services; components never see ctx.
 *
 * Export discipline: packages/client/AGENTS.md — nothing beyond the cordis
 * loading contract leaves this module.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ui-layout's SlotMap declaration (the shell.overlay seat)
// and its package-identity edge into this compilation.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { DirectoryListing, DirectoryRead } from '../directory-types.ts'
import type { GitFileDiff, GitStatusFile, GitWorkspaceStatus } from '../git-seam.ts'
import { PanelRoot } from './PanelRoot.tsx'
import { hasMoreDocs, loadOlderDocs, readInjectedDocs } from './read-context.ts'
import { createPanelStore } from './store.ts'
import type { ContextDoc, InjectedFace } from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Right-aligned utilities in the panel's header row (the panel owns the
     * collapse toggle on the left). Root scope: a registrant reads the current
     * session through the standard `useSessions` seat.
     */
    'panel.header.utilities': { kind: 'list'; scope: 'root' }
  }
}

/**
 * POST one JSON request to a plugin-owned HTTP route and decode its JSON body.
 * The git backend and the directory-routes backend each serve their own routes
 * (`/git/*`, `/dir/*`), so the panel never touches the core API gateway for
 * git or directory data.
 * @param path - the backend's route pathname.
 * @param body - the request payload.
 * @param signal - aborts the fetch on caller supersession.
 * @returns the decoded value.
 */
async function routeFetch<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(payload?.error?.message ?? `请求失败 (${response.status})`)
  }
  return await response.json() as T
}

/** Required services: the slot registry plus the session service the injected face reads. */
export const inject = ['slots', 'sessions']

/**
 * Client plugin body: register the panel entry into the layout-declared
 * `shell.overlay` list slot. `slots.inject` waits for the declaration, so the
 * contribution installs regardless of sibling load order and leaves with this
 * plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'context-files',
    store: createPanelStore,
    children: {
      'panel.header.utilities': { kind: 'list', scope: 'root' },
    },
    inject: (): InjectedFace => ({
      listDirectory: (path, signal): Promise<DirectoryListing> => routeFetch<DirectoryListing>('/dir/list', { path }, signal),
      readText: (path, signal): Promise<DirectoryRead> => routeFetch<DirectoryRead>('/dir/read-text', { path }, signal),
      openPath: (path): Promise<void> => routeFetch('/dir/open-path', { path }, new AbortController().signal).then(() => undefined),
      gitGraph: (cwd, count, skip, signal) => routeFetch('/git/graph', { cwd, count, skip }, signal),
      gitShowCommit: (cwd, hash, signal) => routeFetch('/git/show-commit', { cwd, hash }, signal),
      workspaceStatus: (cwd, signal): Promise<GitWorkspaceStatus> => routeFetch<GitWorkspaceStatus>('/git/workspace', { cwd }, signal),
      showFileDiff: (cwd, hash, path, signal): Promise<GitFileDiff> => routeFetch<GitFileDiff>('/git/show-diff', { cwd, hash, path }, signal),
      gitStatusFor: (dir, signal): Promise<GitStatusFile[]> => routeFetch<{ files: GitStatusFile[] }>('/git/status', { dir }, signal).then(value => value.files),
      readInjectedDocs: (sessionId: SessionId): ContextDoc[] => readInjectedDocs(ctx, sessionId),
      hasMoreDocs: (sessionId: SessionId): boolean => hasMoreDocs(ctx, sessionId),
      loadOlderDocs: (sessionId: SessionId): Promise<void> => loadOlderDocs(ctx, sessionId),
      sessionCwd: (sessionId: SessionId): string | undefined =>
        ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
    }),
  }, PanelRoot))
}
