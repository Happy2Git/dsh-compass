/**
 * dsh-compass — the right-side context-and-files panel as one
 * installable bundle. Node half: mounts the local git backend (`/git/*`), the
 * plugin-owned directory routes (`/dir/*`), and the session-log download
 * command as child plugins of this row. The browser half (`./client`)
 * registers the panel into `shell.overlay` and the download action into the
 * panel's header utilities.
 *
 * One package, one loader row: the child plugins are ordinary Cordis children
 * of this fiber (their static injections resolve from the composed tree), and
 * the client half rides the package's `dsh.client` declaration.
 * @module dsh-compass
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Type-only: resolves the service names the children and the route guards read.
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import type { BrowseConfig } from './directory-browse.ts'
import DirectoryRoutes from './directory-routes.ts'
import LocalGit from './git-local.ts'

/** Cordis plugin name (the loader row name is the package name and wins). */
export const name = 'context-files-panel'

/** Validated plugin configuration: the directory browser's bounds, shared with the routes child. */
export interface Config extends BrowseConfig {}

/** Required service for this row's own apply (the children declare their own). */
export const inject = ['commands']

export const Config: z<Config> = z.object({
  maxEntries: z.natural().min(1).default(1000),
  maxTextBytes: z.natural().min(1).default(262144),
})

const REQUESTED: CommandResult = {
  kind: 'success',
  text: 'Session log download requested.',
}

/**
 * Mount the backend children and register the /export command.
 * @param ctx - host context.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(LocalGit)
  ctx.plugin(DirectoryRoutes, { maxEntries: config.maxEntries, maxTextBytes: config.maxTextBytes })
  ctx.effect(() => ctx.commands.register({
    name: 'export',
    description: 'Download this Session log as a ZIP archive',
    handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
      ? REQUESTED
      : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
  }), 'dsh-compass: session log download command')
}
