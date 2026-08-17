/**
 * Pure presentation statistics over the projected injected-context documents:
 * byte totals per compaction section and per origin class. Everything derives
 * from the documents themselves — measured UTF-8 bytes of the injected text,
 * never a token estimate — so the strip always tells the wire truth.
 * @module dsh-compass/client/doc-stats
 */
import type { ContextDoc, DocOrigin } from './types.ts'

/** Presentation labels for the origin classes (zh panel copy). */
export const ORIGIN_LABEL: Record<DocOrigin, string> = {
  instructions: '指令文件',
  skill: '技能注入',
  plugin: '插件注入',
  recall: '跨会话召回',
  runtime: '运行时注入',
}

/** One origin's contribution inside a section. */
export interface OriginSlice {
  origin: DocOrigin
  count: number
  bytes: number
}

/** Aggregate facts about one compaction section of the projection. */
export interface SectionStats {
  count: number
  bytes: number
  /** Origin slices, largest byte share first. */
  slices: readonly OriginSlice[]
}

/**
 * Aggregate one document set: totals plus per-origin slices ordered by byte
 * share (the occupancy bar reads left to right, biggest contributor first).
 * @param docs - the section's documents.
 * @returns the aggregate.
 */
export function sectionStats(docs: readonly ContextDoc[]): SectionStats {
  const byOrigin = new Map<DocOrigin, OriginSlice>()
  let bytes = 0
  for (const doc of docs) {
    bytes += doc.bytes
    const slice = byOrigin.get(doc.origin) ?? { origin: doc.origin, count: 0, bytes: 0 }
    slice.count += 1
    slice.bytes += doc.bytes
    byOrigin.set(doc.origin, slice)
  }
  return { count: docs.length, bytes, slices: [...byOrigin.values()].sort((left, right) => right.bytes - left.bytes) }
}

/**
 * Format a byte count for the compact presentation (B / KiB / MiB, one
 * decimal above 1 KiB).
 * @param bytes - measured byte total.
 * @returns the formatted size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
