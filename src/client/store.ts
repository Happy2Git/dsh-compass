/**
 * The panel entry's viewing-state store: open/closed, active tab, tree
 * expansion, directory filter, and the selected context document. Transient
 * interaction state only — directory data and injected documents stay
 * component-local (fetched per render lifecycle), and session facts stay in
 * the object layer.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** The panel's two views. */
export type PanelTab = 'files' | 'context' | 'git'

/** Panel store state. */
type PanelState = {
  /** Active view tab. */
  tab: PanelTab
  /** Basename filter for the directory tree. */
  filter: string
  /** Absolute paths of expanded directory rows. */
  expandedDirs: string[]
  /** Absolute path of the file opened in the centered pop-out; null hides it. */
  centerFile: string | null
  /** Seq of the context document opened in the centered pop-out; null hides it. */
  centerDocSeq: number | null
  /** Whether the panel is collapsed to its rail (mirrors the left sidebar). */
  collapsed: boolean
  /** Expanded width in px, adjustable from the panel's left edge. */
  width: number
}

/** Annotation twin of the actions literal below. */
type PanelActions = {
  setTab: (draft: PanelState, tab: PanelTab) => void
  setFilter: (draft: PanelState, filter: string) => void
  toggleDir: (draft: PanelState, path: string) => void
  openCenter: (draft: PanelState, path: string) => void
  openDocCenter: (draft: PanelState, seq: number) => void
  closeCenter: (draft: PanelState) => void
  toggleCollapsed: (draft: PanelState) => void
  setWidth: (draft: PanelState, width: number) => void
}

/**
 * Create the panel store handle. The context tab is the initial view: it is
 * the feature's core deliverable (injected markdown), while the directory
 * tree is the secondary navigation surface.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createPanelStore(): EngineStoreHandle<PanelState, PanelActions> {
  return defineStore({
    init: (): PanelState => ({
      tab: 'context',
      filter: '',
      expandedDirs: [],
      centerFile: null,
      centerDocSeq: null,
      collapsed: false,
      width: 280,
    }),
    actions: {
      setTab: (d, tab) => { d.tab = tab },
      setFilter: (d, filter) => { d.filter = filter },
      toggleDir: (d, path) => {
        const index = d.expandedDirs.indexOf(path)
        if (index >= 0) d.expandedDirs.splice(index, 1)
        else d.expandedDirs.push(path)
      },
      openCenter: (d, path) => { d.centerFile = path },
      openDocCenter: (d, seq) => { d.centerDocSeq = seq },
      closeCenter: (d) => { d.centerFile = null; d.centerDocSeq = null },
      toggleCollapsed: (d) => { d.collapsed = !d.collapsed },
      setWidth: (d, width) => { d.width = width },
    },
  })
}
