/**
 * Browser half of dsh-compass: one list-slot entry into `shell.overlay`
 * (the frame-wide floating layer — additive by id), plus the session-log
 * download action registered into the panel's own `panel.header.utilities`
 * list and its locale dictionary. Both registrations live in this one entry,
 * so the download action shares the panel package's fiber and disposal.
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ui-layout's SlotMap declaration (the shell.overlay seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale and command-hook Context merges.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { DirectoryListing, DirectoryRead } from '../directory-types.ts'
import { PanelRoot } from './PanelRoot.tsx'
import { hasMoreDocs, loadOlderDocs, readInjectedDocs } from './read-context.ts'
import { createPanelStore } from './store.ts'
import type { ContextDoc, InjectedFace } from './types.ts'
import { SessionLogDownloadController } from './export/controller.ts'
import type { SessionLogDownloadDialogInjected } from './export/Dialog.tsx'
import { SessionLogDownloadHeaderAction } from './export/HeaderAction.tsx'
import { en, NS, zh, type SessionLogDownloadKey } from './export/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Right-aligned utilities in the panel's header row (the panel owns the
     * collapse toggle on the left). Root scope: a registrant reads the current
     * session through the standard `useSessions` seat.
     */
    'panel.header.utilities': { kind: 'list'; scope: 'root' }
  }

  interface LocaleNamespaceMap {
    'session-log-download': SessionLogDownloadKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionLogDownload: SessionLogDownloadController
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

/** Required services: the slot registry, the session service, and the locale registry. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: register the panel entry into the layout-declared
 * `shell.overlay` list slot, then the download action into the panel's
 * header utilities. `slots.inject` waits for each declaration, so the
 * contributions install regardless of sibling load order and leave with this
 * plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionLogDownloadController()
  ctx.provide('sessionLogDownload', controller)
  ctx.effect(() => async () => { await controller.dispose() }, 'dsh-compass: download lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-compass: browser dictionaries')
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'export' && result.kind === 'success') void controller.download(sessionId)
  })
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
      readInjectedDocs: (sessionId: SessionId): ContextDoc[] => readInjectedDocs(ctx, sessionId),
      hasMoreDocs: (sessionId: SessionId): boolean => hasMoreDocs(ctx, sessionId),
      loadOlderDocs: (sessionId: SessionId): Promise<void> => loadOlderDocs(ctx, sessionId),
      sessionCwd: (sessionId: SessionId): string | undefined =>
        ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
    }),
  }, PanelRoot))
  ctx.slots.inject('panel.header.utilities', () => ctx.slots.register({
    name: 'panel.header.utilities',
    id: 'session-log-download',
    locale: NS,
    inject: (): SessionLogDownloadDialogInjected => ({
      hooks: { sessionLogDownload: controller.store },
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
    }),
  }, SessionLogDownloadHeaderAction))
}
