// Pan/zoom state for the schematic canvas, kept as plain maths so it can be
// tested headless. The viewport shows a window of SVG user space sized
// (boxW/zoom, boxH/zoom) with its top-left corner at (x, y); zoom = 1 means one
// SVG unit per CSS pixel.

export interface View {
  zoom: number
  x: number
  y: number
}

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 4

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function viewBox(view: View, boxW: number, boxH: number): string {
  return `${view.x} ${view.y} ${boxW / view.zoom} ${boxH / view.zoom}`
}

/** Box-relative pixel coordinates to SVG user space. */
export function toSvg(
  view: View,
  boxX: number,
  boxY: number,
): { x: number; y: number } {
  return { x: view.x + boxX / view.zoom, y: view.y + boxY / view.zoom }
}

/** Scale by `factor` while keeping the SVG point under (boxX, boxY) put. */
export function zoomAt(
  view: View,
  factor: number,
  boxX: number,
  boxY: number,
): View {
  const zoom = clampZoom(view.zoom * factor)
  if (zoom === view.zoom) return view
  return {
    zoom,
    x: view.x + boxX / view.zoom - boxX / zoom,
    y: view.y + boxY / view.zoom - boxY / zoom,
  }
}

/** Drag the canvas by a pixel delta: the window moves the other way. */
export function panBy(view: View, dx: number, dy: number): View {
  return { zoom: view.zoom, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom }
}

/** Fit a drawing into the box and centre it, never enlarging past 1:1 so small
 * plans keep their natural size instead of being blown up. */
export function fitView(
  drawW: number,
  drawH: number,
  boxW: number,
  boxH: number,
): View {
  // Before the container is measured there is nothing to fit to.
  if (boxW <= 0 || boxH <= 0 || drawW <= 0 || drawH <= 0) {
    return { zoom: 1, x: 0, y: 0 }
  }
  const zoom = clampZoom(Math.min(1, boxW / drawW, boxH / drawH))
  return {
    zoom,
    x: (drawW - boxW / zoom) / 2,
    y: (drawH - boxH / zoom) / 2,
  }
}
