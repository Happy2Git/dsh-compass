/**
 * The panel entry's viewing-state store: open/closed, active tab, tree
 * expansion, directory filter, and the selected context document. Transient
 * interaction state only — directory data and injected documents stay
 * component-local (fetched per render lifecycle), and session facts stay in
 * the object layer.
 */
import { defineStore, type EngineStoreHandle, type EngineStoreInstance } from '@deepseek-ai/dsh-client-runtime/client'

/** The panel's two views. */
export type PanelTab = 'files' | 'context' | 'git'

/** Panel store state. */
type PanelState = {
  /** Active view tab. */
  tab: PanelTab
  /** Basename filter for the directory tree. */
  filter: string
  /** Whether dot-prefixed (POSIX hidden) entries show in the directory tree. */
  showHiddenFiles: boolean
  /** Absolute paths of expanded directory rows. */
  expandedDirs: string[]
  /** Absolute path of the file opened in the centered pop-out; null hides it. */
  centerFile: string | null
  /** Seq of the context document opened in the centered pop-out; null hides it. */
  centerDocSeq: number | null
  /** Diff opened in the centered pop-out: commit hash (null = working-tree diff) + file path; null hides it. */
  centerDiff: { hash: string | null; path: string } | null
  /** Whether the panel is collapsed to its rail (mirrors the left sidebar). */
  collapsed: boolean
  /** Expanded width in px, adjustable from the panel's left edge. */
  width: number
  /** Search query over injected-context documents (label + text + form). */
  contextFilter: string
  /**
   * Unseen context events while the context tab is not active: newly injected
   * documents plus compaction boundary moves. Transient — a reload never
   * replays it; opening the context tab clears it.
   */
  contextPulse: number
}

/** Annotation twin of the actions literal below. */
type PanelActions = {
  setTab: (draft: PanelState, tab: PanelTab) => void
  setFilter: (draft: PanelState, filter: string) => void
  toggleHiddenFiles: (draft: PanelState) => void
  setContextFilter: (draft: PanelState, filter: string) => void
  bumpContextPulse: (draft: PanelState, events: number) => void
  clearContextPulse: (draft: PanelState) => void
  toggleDir: (draft: PanelState, path: string) => void
  openCenter: (draft: PanelState, path: string) => void
  openDocCenter: (draft: PanelState, seq: number) => void
  openDiffCenter: (draft: PanelState, hash: string | null, path: string) => void
  closeCenter: (draft: PanelState) => void
  toggleCollapsed: (draft: PanelState) => void
  setWidth: (draft: PanelState, width: number) => void
}

/**
 * Create the panel store handle. The context tab is the initial view: it is
 * the feature's core deliverable (injected markdown), while the directory
 * tree is the secondary navigation surface. The whole state persists to
 * localStorage (the engine's opt-in channel), so width, active tab, and
 * collapse survive a reload per browser origin — each profile's origin is
 * its own storage identity. The centered pop-out is transient: the wrapper
 * clears any rehydrated center selection before a render can show it.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createPanelStore(): EngineStoreHandle<PanelState, PanelActions> {
  const inner = defineStore<PanelState, PanelActions>({
    persist: 'dsh-compass.panel',
    init: (): PanelState => ({
      tab: 'context',
      filter: '',
      showHiddenFiles: false,
      contextFilter: '',
      contextPulse: 0,
      expandedDirs: [],
      centerFile: null,
      centerDocSeq: null,
      centerDiff: null,
      collapsed: false,
      width: 280,
    }),
    actions: {
      // Opening the context tab is the act of seeing the pulse events.
      setTab: (d, tab) => {
        d.tab = tab
        if (tab === 'context') d.contextPulse = 0
      },
      setFilter: (d, filter) => { d.filter = filter },
      toggleHiddenFiles: (d) => { d.showHiddenFiles = !d.showHiddenFiles },
      setContextFilter: (d, filter) => { d.contextFilter = filter },
      bumpContextPulse: (d, events) => { d.contextPulse += events },
      clearContextPulse: (d) => { d.contextPulse = 0 },
      toggleDir: (d, path) => {
        const index = d.expandedDirs.indexOf(path)
        if (index >= 0) d.expandedDirs.splice(index, 1)
        else d.expandedDirs.push(path)
      },
      openCenter: (d, path) => { d.centerFile = path },
      openDocCenter: (d, seq) => { d.centerDocSeq = seq },
      openDiffCenter: (d, hash, path) => { d.centerDiff = { hash, path } },
      closeCenter: (d) => { d.centerFile = null; d.centerDocSeq = null; d.centerDiff = null },
      toggleCollapsed: (d) => { d.collapsed = !d.collapsed },
      setWidth: (d, width) => { d.width = width },
    },
  })
  return {
    spec: inner.spec,
    create(): EngineStoreInstance<PanelState, PanelActions> {
      const instance = inner.create()
      // Rehydrated state may carry a centered pop-out from the previous page
      // life; a reload must not reopen a preview dialog. Clear it before any
      // render sees the store.
      const snapshot = instance.getSnapshot()
      if (snapshot.centerFile !== null || snapshot.centerDocSeq !== null) {
        instance.actions.closeCenter()
      }
      // The pulse is a live-session signal; a rehydrated count from the
      // previous page life would badge a tab with events already seen.
      if (snapshot.contextPulse !== 0) {
        instance.actions.clearContextPulse()
      }
      return instance
    },
  }
}
