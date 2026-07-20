import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Plan } from '../engine/solve'
import type { GameData } from '../engine/types'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitView,
  panBy,
  viewBox,
  zoomAt,
  type View,
} from '../ui/viewport'
import {
  moveBox,
  pruneLayout,
  type ManualLayout,
  type Point,
} from '../ui/manualLayout'
import Schematic, { boxKeys, layoutSize, type ViewMode } from './Schematic'

interface Props {
  plan: Plan
  data: GameData
  beltMk: number
  pipeMk: number
  viewMode: ViewMode
  /** Owned by the app, not by this component: an invalid input swaps the whole
   * viewport for the error panel, and state living here would die with it. */
  layout: ManualLayout
  onLayoutChange: (next: ManualLayout) => void
}

const WHEEL_STEP = 1.12
const BUTTON_STEP = 1.35

/**
 * Pan/zoom shell around the schematic: wheel to zoom at the cursor, drag to
 * pan, and a fullscreen toggle for big chains. The maths lives in ui/viewport
 * so it can be tested headless; this component is only the browser plumbing.
 */
export default function SchematicViewport({
  plan,
  data,
  beltMk,
  pipeMk,
  viewMode,
  layout,
  onLayoutChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useMemo(() => layoutSize(plan, viewMode), [plan, viewMode])
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })
  const [isFull, setIsFull] = useState(false)
  // Fallback for when the Fullscreen API refuses (no user activation, an
  // embedding iframe without allow="fullscreen", a locked-down policy): cover
  // the page with CSS instead, so the button is never a dead end.
  const [filled, setFilled] = useState(false)
  // Once the user pans or zooms, stop re-fitting under them on every resize.
  const touched = useRef(false)

  // Replanning keeps whatever the user arranged, as long as the box is still
  // drawn: changing only an output rate leaves every box in place, while a
  // different chain drops the boxes it no longer has.
  const keys = useMemo(() => boxKeys(plan, viewMode), [plan, viewMode])
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  useEffect(() => {
    const pruned = pruneLayout(layoutRef.current, keys)
    if (pruned !== layoutRef.current) onLayoutChange(pruned)
  }, [keys, onLayoutChange])

  const onMoveBox = useCallback(
    (key: string, auto: Point, dx: number, dy: number) =>
      onLayoutChange(moveBox(layoutRef.current, key, auto, dx, dy)),
    [onLayoutChange],
  )

  const fit = useCallback(() => {
    touched.current = false
    setView(fitView(size.width, size.height, box.w, box.h))
  }, [size.width, size.height, box.w, box.h])

  // Track the container size; the viewBox is derived from it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBox({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new plan is a new drawing: re-fit it and hand control back to autofit.
  useEffect(() => {
    touched.current = false
  }, [size.width, size.height, viewMode])

  useEffect(() => {
    if (touched.current) return
    setView(fitView(size.width, size.height, box.w, box.h))
  }, [size.width, size.height, box.w, box.h, viewMode])

  // Wheel must be non-passive to preventDefault, which React's onWheel is not.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      touched.current = true
      setView((v) =>
        zoomAt(
          v,
          e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP,
          e.clientX - r.left,
          e.clientY - r.top,
        ),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Native fullscreen handles Escape itself; the CSS fallback has to.
  useEffect(() => {
    if (!filled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilled(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filled])

  const expanded = isFull || filled

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (filled) {
      setFilled(false)
      return
    }
    const el = ref.current
    if (!el) return
    Promise.resolve(el.requestFullscreen()).catch(() => setFilled(true))
  }

  const stepZoom = (factor: number) => {
    touched.current = true
    setView((v) => zoomAt(v, factor, box.w / 2, box.h / 2))
  }

  const drag = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      ref={ref}
      className={`viewport${isFull ? ' viewport--full' : ''}${filled ? ' viewport--filled' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const from = drag.current
        if (!from) return
        touched.current = true
        setView((v) => panBy(v, e.clientX - from.x, e.clientY - from.y))
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={(e) => {
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      <Schematic
        plan={plan}
        data={data}
        beltMk={beltMk}
        pipeMk={pipeMk}
        viewMode={viewMode}
        viewBox={viewBox(view, box.w, box.h)}
        layout={layout}
        onMoveBox={onMoveBox}
        scale={view.zoom}
      />
      {/* The controls sit inside the viewport, so their pointerdown would
          bubble to the pan handler above. That handler calls setPointerCapture,
          which retargets the rest of the gesture to the container and swallows
          the button's click entirely: the HUD would look alive but do nothing.
          Stop the gesture here so the buttons get their clicks. */}
      <div
        className="viewport-controls"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => stepZoom(BUTTON_STEP)}
          disabled={view.zoom >= MAX_ZOOM}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => stepZoom(1 / BUTTON_STEP)}
          disabled={view.zoom <= MIN_ZOOM}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button onClick={fit} title="Fit to screen" aria-label="Fit to screen">
          ⤢
        </button>
        {Object.keys(layout).length > 0 && (
          <button
            onClick={() => onLayoutChange({})}
            title="Undo my arrangement"
            aria-label="Reset arrangement"
          >
            ↺
          </button>
        )}
        <button
          onClick={toggleFullscreen}
          title={expanded ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {expanded ? '✕' : '⛶'}
        </button>
        <span className="viewport-zoom">{Math.round(view.zoom * 100)}%</span>
      </div>
    </div>
  )
}
