/**
 * Standalone logic tests for the context-tab statistics and the doc fold's
 * provenance/bytes projection. Run with any tsx:
 *
 *   tsx tests/doc-stats.test.mjs
 *
 * foldDocEvents imports the runtime client (type-only at run time — the
 * value imports it uses are contextProvenance/contextForm); this test feeds
 * events through the real fold so origin classification and byte measurement
 * are exercised against the shipped code path. Exits non-zero on failure.
 */
import { foldDocEvents, classifyDocOrigin } from '../src/client/read-context.ts'
import { formatBytes, ORIGIN_LABEL, sectionStats } from '../src/client/doc-stats.ts'

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

// classifyDocOrigin: the durable source kinds, plus the degrade path.
check('origin: agent-instructions', classifyDocOrigin({ kind: 'agent-instructions' }) === 'instructions')
check('origin: skill-invocation', classifyDocOrigin({ kind: 'skill-invocation' }) === 'skill')
check('origin: plugin', classifyDocOrigin({ kind: 'plugin', plugin: 'x' }) === 'plugin')
check('origin: session-reference', classifyDocOrigin({ kind: 'session-reference' }) === 'recall')
check('origin: unknown kind degrades to runtime', classifyDocOrigin({ kind: 'tomorrow-producer' }) === 'runtime')
check('origin: non-object degrades to runtime', classifyDocOrigin(null) === 'runtime')

// formatBytes: the compact presentation at each tier.
check('bytes: B tier', formatBytes(0) === '0 B' && formatBytes(1023) === '1023 B')
check('bytes: KiB tier', formatBytes(1024) === '1.0 KiB' && formatBytes(1536) === '1.5 KiB')
check('bytes: MiB tier', formatBytes(1024 * 1024) === '1.0 MiB')

// foldDocEvents: provenance + measured bytes + the compaction shadow.
const text = (n) => 'x'.repeat(n)
const events = [
  { seq: 1, time: 1, data: { source: { kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }] }, content: [{ type: 'text', text: text(100) }] } },
  { seq: 2, time: 2, data: { source: { kind: 'plugin', plugin: 'dsh-compass' }, content: [{ type: 'text', text: text(50) }] } },
  { seq: 3, time: 3, surfaceOp: { op: 'replace' }, data: { source: { kind: 'plugin', plugin: 'compact', compactionId: 'c1' }, content: [] } },
  { seq: 4, time: 4, data: { source: { kind: 'skill-invocation', name: 'review' }, content: [{ type: 'text', text: text(200) }] } },
  { seq: 5, time: 5, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'human message, not a doc' }] } },
]
const folded = foldDocEvents(events)
check('fold: boundary captured at checkpoint seq', folded.boundary === 3)
check('fold: user-source message dropped', folded.docs.length === 3 && !folded.docs.some(doc => doc.seq === 5))
check('fold: origin per doc', folded.docs[0].origin === 'instructions' && folded.docs[1].origin === 'plugin' && folded.docs[2].origin === 'skill')
check('fold: bytes are measured UTF-8 lengths', folded.docs[0].bytes === 100 && folded.docs[1].bytes === 50 && folded.docs[2].bytes === 200)
check('fold: docs at/before the boundary are shadowed', folded.docs[0].active === false && folded.docs[1].active === false)
check('fold: docs after the boundary stay live', folded.docs[2].active === true)
check('fold: multi-byte text measures bytes not chars', foldDocEvents([
  { seq: 1, time: 1, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '中文' }] } },
]).docs[0].bytes === 6)

// sectionStats: totals and per-origin slices ordered by byte share.
const docs = folded.docs.map(doc => ({ ...doc, active: true }))
const stats = sectionStats(docs)
check('stats: totals over all docs', stats.count === 3 && stats.bytes === 350)
check('stats: slices ordered by byte share', stats.slices[0].origin === 'skill' && stats.slices[0].bytes === 200)
check('stats: each origin labeled', stats.slices.every(slice => typeof ORIGIN_LABEL[slice.origin] === 'string' && ORIGIN_LABEL[slice.origin].length > 0))
check('stats: empty input', sectionStats([]).count === 0 && sectionStats([]).bytes === 0 && sectionStats([]).slices.length === 0)

process.exit(failures === 0 ? 0 : 1)
