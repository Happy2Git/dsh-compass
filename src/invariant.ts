/**
 * Package-owned invariant companion for `dsh-compass`.
 * @module dsh-compass/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-compass'

/** Cordis companion plugin name. */
export const name = 'context-files-panel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the panel registers through the slot registry (whose
 * own effect accounting owns that relationship), the git and directory
 * backends are stateless round trips against external repositories, and the
 * download action owns no independent event stream to check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
