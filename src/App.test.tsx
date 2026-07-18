import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

// Render smoke test for the console wiring. localStorage is absent here, so
// loadState falls back to the defaults: one iron node, one Iron Plate output.
describe('App', () => {
  const html = renderToStaticMarkup(<App />)

  it('renders without throwing', () => {
    expect(html).toContain('FICSIT')
  })

  it('shows a max hint above every output rate field', () => {
    expect(html.match(/class="rate-hint"/g)).toHaveLength(1)
    // 60 ore -> 60 ingots -> 40 plates, the same max the engine reports.
    expect(html).toContain('MAX 40/min')
  })

  it('offers the build mode toggle instead of a sink checkbox', () => {
    expect(html).toContain('Whole machines')
    expect(html).not.toContain('Smart Splitter')
  })
})
