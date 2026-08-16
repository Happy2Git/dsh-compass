/**
 * Standalone logic test for dsh-compass drop-intake. Run with any tsx:
 *
 *   tsx tests/drop-intake.test.mjs
 *
 * Stubs the DOM surface the module touches; exercises the three paths:
 * unclaimed drag (take it), shell-claimed drag (stand down), and the
 * insertText fallback when execCommand is unavailable. No test runner or
 * workspace dependency — the file exits non-zero on any failure. Real
 * HTML5 drags cannot be synthesized by CDP input, so the last browser
 * mile stays a manual acceptance step.
 */
const listeners = new Map()

function makeEvent(type, { types = [], data = null, prevented = false, relatedTarget = null } = {}) {
  const event = {
    type,
    defaultPrevented: prevented,
    relatedTarget,
    dataTransfer: {
      types,
      dropEffect: 'none',
      getData: (mime) => (mime === 'application/x-dsh-path' ? data ?? '' : ''),
    },
    _prevented: false,
    preventDefault() { this._prevented = true; this.defaultPrevented = true },
  }
  return event
}

const createdElements = []
let headChildren = []
const fakeTextarea = {
  tagName: 'TEXTAREA',
  value: '',
  disabled: false,
  readOnly: false,
  offsetParent: {},
  selectionStart: 0,
  focusCount: 0,
  events: [],
  focus() { this.focusCount += 1 },
  setSelectionRange(a, b) { this.selectionStart = a },
  setRangeText(text, start, _end, mode) {
    this.value = this.value.slice(0, start) + text + this.value.slice(start)
    this.selectionStart = this.value.length
  },
  dispatchEvent(ev) { this.events.push(ev) },
}

globalThis.window = {
  addEventListener: (type, fn) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn])
  },
  removeEventListener: () => {},
}
globalThis.document = {
  documentElement: { lang: 'zh' },
  head: { appendChild: (el) => headChildren.push(el) },
  createElement: () => {
    const el = {
      style: { cssText: '' },
      setAttribute() {}, remove() {
        headChildren = headChildren.filter(node => node !== el)
      },
    }
    createdElements.push(el)
    return el
  },
  querySelectorAll: (selector) => (selector === 'textarea[data-phase]' ? [fakeTextarea] : []),
  execCommand: undefined,
}
globalThis.InputEvent = class InputEvent {
  constructor(type, init) { this.type = type; this.init = init }
}

const fire = (type, event) => {
  for (const fn of listeners.get(type) ?? []) fn(event)
}

const { installPanelDropIntake } = await import(
  new URL('../src/client/drop-intake.ts', import.meta.url)
)
installPanelDropIntake()

const MIME = 'application/x-dsh-path'
let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

// Path 1: unclaimed drag — module takes it.
const over1 = makeEvent('dragover', { types: [MIME] })
fire('dragover', over1)
check('unclaimed dragover: preventDefault', over1._prevented === true)
check('unclaimed dragover: dropEffect copy', over1.dataTransfer.dropEffect === 'copy')
check('unclaimed dragover: overlay shown', headChildren.length === 1)

fakeTextarea.value = '现有草稿'
const drop1 = makeEvent('drop', { types: [MIME], data: '/tmp/a.md' })
fire('drop', drop1)
check('unclaimed drop: preventDefault', drop1._prevented === true)
check('unclaimed drop: overlay removed', headChildren.length === 0)
check('unclaimed drop: sentence appended with blank-line separation',
  fakeTextarea.value === '现有草稿\n\n已拖入文件 /tmp/a.md。')
check('unclaimed drop: textarea focused', fakeTextarea.focusCount === 1)
check('unclaimed drop: fallback input event dispatched', fakeTextarea.events.length === 1 && fakeTextarea.events[0].type === 'input')

// Path 2: shell-claimed drag (fork build) — module fully passive.
fakeTextarea.value = ''
const over2 = makeEvent('dragover', { types: [MIME], prevented: true })
fire('dragover', over2)
check('claimed dragover: not re-prevented (already true is fine, no side effects)', headChildren.length === 0)
const drop2 = makeEvent('drop', { types: [MIME], data: '/tmp/b.md', prevented: true })
fire('drop', drop2)
check('claimed drop: draft untouched', fakeTextarea.value === '')

// Path 3: non-panel drags (OS Files) are ignored entirely.
fakeTextarea.value = ''
const over3 = makeEvent('dragover', { types: ['Files'] })
fire('dragover', over3)
check('files-only dragover: ignored', over3._prevented === false && headChildren.length === 0)
const drop3 = makeEvent('drop', { types: ['Files'] })
fire('drop', drop3)
check('files-only drop: ignored', drop3._prevented === false && fakeTextarea.value === '')

// Path 4: empty draft inserts the sentence alone (no leading blanks).
headChildren = []
fakeTextarea.value = ''
const over4 = makeEvent('dragover', { types: [MIME] })
fire('dragover', over4)
const drop4 = makeEvent('drop', { types: [MIME], data: '/tmp/c.png' })
fire('drop', drop4)
check('empty draft: sentence alone', fakeTextarea.value === '已拖入文件 /tmp/c.png。')

// Path 5: drag leaving the window clears the overlay.
const over5 = makeEvent('dragover', { types: [MIME] })
fire('dragover', over5)
check('overlay back for path 5', headChildren.length === 1)
fire('dragleave', makeEvent('dragleave', { types: [MIME], relatedTarget: null }))
check('window-exit dragleave: overlay cleared', headChildren.length === 0)

process.exit(failures === 0 ? 0 : 1)
