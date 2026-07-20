// Positions the user dragged boxes to, overriding the automatic layout.
// Keyed by box key: the stage id in the standard view, `stageId#unit` in the
// complex one. Keying by box rather than by a whole-plan signature is what
// makes a change that only moves rates around keep the user's arrangement:
// the boxes are still there, so their overrides still apply. Boxes the new
// chain dropped take their overrides with them.

export interface Point {
  x: number
  y: number
}

export type ManualLayout = Record<string, Point>

/** Discard overrides for boxes the current plan no longer draws. Returns the
 * same object when nothing was dropped, so callers can feed it back into state
 * without re-rendering. */
export function pruneLayout(
  layout: ManualLayout,
  validKeys: Set<string>,
): ManualLayout {
  const kept = Object.entries(layout).filter(([key]) => validKeys.has(key))
  if (kept.length === Object.keys(layout).length) return layout
  return Object.fromEntries(kept)
}

/** Offset a box by an SVG-space delta, starting from wherever it sits now
 * (`auto` is the position the automatic layout gave it). */
export function moveBox(
  layout: ManualLayout,
  key: string,
  auto: Point,
  dx: number,
  dy: number,
): ManualLayout {
  const from = layout[key] ?? auto
  return { ...layout, [key]: { x: from.x + dx, y: from.y + dy } }
}
