/**
 * Standalone logic tests for the porcelain-status fold behind the directory
 * badges. Run with any tsx:
 *
 *   tsx tests/git-status-fold.test.mjs
 *
 * Exercises porcelainStatus, aggregateStatus, and foldPorcelainStatuses
 * against the exact `git status --porcelain=v1 --ignored
 * --untracked-files=all` shapes git emits. Exits non-zero on failure.
 */
import { aggregateStatus, foldIgnoredListing, foldPorcelainStatuses, mergeStatusEntries, porcelainStatus } from '../src/git-seam.ts'

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

// porcelainStatus: the XY vocabulary.
check('porcelain: ignored', porcelainStatus('!!') === 'ignored')
check('porcelain: untracked', porcelainStatus('??') === 'untracked')
check('porcelain: staged add', porcelainStatus('A ') === 'added')
check('porcelain: unstaged delete', porcelainStatus(' D') === 'deleted')
check('porcelain: modified (unstaged)', porcelainStatus(' M') === 'modified')
check('porcelain: modified (staged+unstaged)', porcelainStatus('MM') === 'modified')

// aggregateStatus: priority order and empty input.
check('aggregate: empty -> null', aggregateStatus([]) === null)
check('aggregate: modified outranks untracked', aggregateStatus(['untracked', 'modified']) === 'modified')
check('aggregate: added outranks deleted', aggregateStatus(['deleted', 'added']) === 'added')
check('aggregate: ignored alone survives', aggregateStatus(['ignored']) === 'ignored')
check('aggregate: modified beats everything', aggregateStatus(['ignored', 'untracked', 'added', 'deleted', 'modified']) === 'modified')

// foldPorcelainStatuses: direct children, prefix, directory aggregation.
const fold = (output, prefix = '') => {
  const byName = new Map()
  for (const entry of foldPorcelainStatuses(output, prefix)) byName.set(entry.name, entry)
  return byName
}

// Direct-child files keep their own status; deeper paths fold into the dir.
{
  const map = fold([
    ' M README.md',
    ' M src/a.ts',
    '?? src/new.txt',
    ' A docs/guide.md',
  ].join('\n'))
  check('fold: direct file keeps its status', map.get('README.md')?.status === 'modified' && map.get('README.md')?.aggregate === null)
  check('fold: deeper files never appear as entries', !map.has('a.ts') && !map.has('new.txt'))
  check('fold: directory aggregates (M beats U)', map.get('src')?.status === null && map.get('src')?.aggregate === 'modified')
  check('fold: directory aggregates (added)', map.get('docs')?.aggregate === 'added')
}

// Ignored directory line (trailing slash) is the directory's own status.
{
  const map = fold('!! node_modules/\n?? stray.txt')
  check('fold: fully ignored dir keeps its own status', map.get('node_modules')?.status === 'ignored' && map.get('node_modules')?.aggregate === null)
  check('fold: untracked file beside it', map.get('stray.txt')?.status === 'untracked')
}

// A directory mixing ignored and modified contents: modified wins, the
// ignored line contributes but never outranks.
{
  const map = fold('!! build/cache.tmp\n M build/config.js')
  check('fold: mixed dir aggregates to modified', map.get('build')?.aggregate === 'modified' && map.get('build')?.status === null)
}

// Renames count at the new path.
{
  const map = fold('R  old/name.txt -> new/name.txt')
  check('fold: rename folds at the new path', map.get('new')?.aggregate === 'modified')
}

// The listing prefix strips before matching; foreign paths never leak in.
{
  const map = fold(' M sub/file.txt\n M elsewhere/other.txt', 'sub/')
  check('fold: prefix strips the listed dir', map.get('file.txt')?.status === 'modified')
  check('fold: paths outside the prefix are dropped', !map.has('elsewhere'))
}

// Name order is deterministic code-unit order.
{
  const names = foldPorcelainStatuses(' M b\n M a').map(entry => entry.name)
  check('fold: name-sorted output', names[0] === 'a' && names[1] === 'b')
}

// foldIgnoredListing: collapsed trees become one entry; deeper paths drop.
{
  const list = foldIgnoredListing('node_modules/\0.pnpm-store/\0build/cache.tmp\0.DS_Store\0')
  const names = list.map(entry => entry.name)
  check('ignored: fully-ignored tree collapses to its dir', names.includes('node_modules') && names.includes('.pnpm-store'))
  check('ignored: direct ignored file listed', names.includes('.DS_Store'))
  check('ignored: deeper ignored path dropped', !names.includes('cache.tmp') && !names.includes('build'))
  check('ignored: entries carry ignored status', list.every(entry => entry.status === 'ignored' && entry.aggregate === null))
}

// mergeStatusEntries: primary (tracked/untracked) wins over ignored.
{
  const primary = foldPorcelainStatuses(' M src/x.ts\n?? stray.txt')
  const ignored = foldIgnoredListing('node_modules/\0stray.txt\0')
  const merged = mergeStatusEntries(primary, ignored)
  const byName = new Map(merged.map(entry => [entry.name, entry]))
  check('merge: ignored dir joins beside primary entries', byName.get('node_modules')?.status === 'ignored')
  check('merge: primary wins on name collision', byName.get('stray.txt')?.status === 'untracked')
  check('merge: name-sorted output', merged.map(entry => entry.name).join(',') === 'node_modules,src,stray.txt')
}

process.exit(failures === 0 ? 0 : 1)
