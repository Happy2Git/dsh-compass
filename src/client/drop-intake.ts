/**
 * Panel-path drop intake for shells whose composer does not consume the
 * panel's drag MIME itself. The panel's file rows drag with the
 * `application/x-dsh-path` MIME (the absolute host path — the browser never
 * sees the bytes); fork builds mount the composer-side intake inside
 * ui-conversation, upstream shells do not. This module supplies the missing
 * receiver: a whole-window drop that appends the path to the composer draft,
 * so the agent still receives a reference it can act on with its tools.
 *
 * Coexistence is decided per drag, not per build: every listener sits on
 * `window` in the BUBBLE phase, which the dispatch order guarantees runs
 * after any document-level listener of the same event (the shell's intake is
 * document-level). A drag the shell already claimed arrives here with
 * `defaultPrevented` set and is left untouched — on a fork build the shell's
 * richer intake (image attach) wins and this module is fully passive; on a
 * shell without panel-path support nobody claims the drag and this module
 * owns it end to end.
 * @module dsh-compass/client/drop-intake
 */

/** The drag MIME the panel's file rows set (wire contract with the composer intake). */
const PANEL_PATH_MIME = 'application/x-dsh-path'

/** One style-tag identity for the drag overlay; one overlay per page. */
const OVERLAY_STYLE_ID = 'dsh-compass-drop-overlay'

const OVERLAY_CSS = [
  'position:fixed', 'inset:8px', 'z-index:2147483646', 'pointer-events:none',
  'border:2px dashed rgba(64,132,255,.8)', 'border-radius:12px',
  'background:rgba(64,132,255,.08)', 'box-sizing:border-box',
].join(';')

function isZh(): boolean {
  return (document.documentElement.lang ?? 'zh').toLowerCase().startsWith('zh')
}

function overlayText(): string {
  return isZh() ? '松开以将文件拖入对话' : 'Release to drop the file into the conversation'
}

function sentence(path: string): string {
  return isZh() ? `已拖入文件 ${path}。` : `Dropped file ${path}.`
}

/** The drag payload carries the panel path MIME. */
function hasPanelPath(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(PANEL_PATH_MIME) ?? false
}

/** The composer textarea: upstream and fork both stamp it with data-phase. */
function composerTextarea(): HTMLTextAreaElement | undefined {
  const all = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-phase]')]
  return all.find(el => !el.disabled && !el.readOnly && el.offsetParent !== null)
    ?? all.find(el => el.offsetParent !== null)
}

/**
 * Append the dropped path to the composer draft as a sentence (fork's
 * degraded path-only parity). insertText keeps the textarea's native undo;
 * the setRangeText + synthetic input fallback covers engines without it —
 * a controlled React textarea updates through the input event either way.
 * @param path - the absolute host path carried by the drag.
 * @returns whether a live composer received the sentence.
 */
function appendPathToDraft(path: string): boolean {
  const target = composerTextarea()
  if (target === undefined) return false
  const line = sentence(path)
  target.focus()
  const end = target.value.length
  target.setSelectionRange(end, end)
  const insertion = target.value.trim() === '' ? line : `\n\n${line}`
  let applied = false
  try {
    applied = document.execCommand('insertText', false, insertion)
  } catch {
    applied = false
  }
  if (applied !== true) {
    target.setRangeText(insertion, end, end, 'end')
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: insertion }))
  }
  return true
}

/**
 * Install the window-level drag listeners. Idempotent per plugin apply.
 * @returns the cordis effect disposer.
 */
export function installPanelDropIntake(): () => void {
  let overlay: HTMLDivElement | undefined

  const showOverlay = (): void => {
    if (overlay !== undefined) return
    overlay = document.createElement('div')
    overlay.setAttribute('data-plugin', 'dsh-compass')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.style.cssText = OVERLAY_CSS
    overlay.textContent = overlayText()
    document.head.appendChild(overlay)
  }
  const hideOverlay = (): void => {
    overlay?.remove()
    overlay = undefined
  }

  const onDragOver = (event: DragEvent): void => {
    if (!hasPanelPath(event)) return
    if (event.defaultPrevented) {
      // The shell's own intake claimed this drag (fork builds): stand down.
      hideOverlay()
      return
    }
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    showOverlay()
  }
  const onDrop = (event: DragEvent): void => {
    if (!hasPanelPath(event)) return
    hideOverlay()
    if (event.defaultPrevented) return
    event.preventDefault()
    const path = event.dataTransfer?.getData(PANEL_PATH_MIME) ?? ''
    if (path !== '') void appendPathToDraft(path)
  }
  const onLeave = (event: DragEvent): void => {
    // relatedTarget null: the drag left the window entirely.
    if (event.relatedTarget === null) hideOverlay()
  }
  const onDragEnd = (): void => hideOverlay()

  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragleave', onLeave)
  window.addEventListener('dragend', onDragEnd)
  return () => {
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('drop', onDrop)
    window.removeEventListener('dragleave', onLeave)
    window.removeEventListener('dragend', onDragEnd)
    hideOverlay()
  }
}
