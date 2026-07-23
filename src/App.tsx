import { useState } from 'react'
import Breakdown from './components/Breakdown'
import Console from './components/Console'
import SchematicViewport from './components/SchematicViewport'
import { shareUrl } from './ui/share'
import { data, usePlanner } from './ui/usePlanner'

export default function App() {
  const planner = usePlanner()
  const { result } = planner

  // 'null' | the link to copy by hand when the clipboard is unavailable.
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const share = () => {
    const url = shareUrl(location.href, planner.state)
    setShareLink(null)
    const copying = navigator.clipboard?.writeText(url)
    if (!copying) {
      setShareLink(url)
      return
    }
    copying.then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      // Clipboard blocked (insecure origin, denied permission): show the link
      // so the plan is still shareable, just with a manual copy.
      () => setShareLink(url),
    )
  }

  return (
    <>
      <header className="header">
        <h1>
          FICSIT<span> Factory Planner</span>
        </h1>
        <span className="tagline">
          From resource node to storage, fully balanced
        </span>
        <button
          className="share"
          onClick={share}
          title="Copy a link that rebuilds this exact plan"
        >
          {copied ? 'Link copied' : 'Share'}
        </button>
        <button
          className="clear-all"
          onClick={planner.reset}
          title="Reset every field"
        >
          Clear all
        </button>
        {shareLink && (
          <div className="share-fallback">
            <label htmlFor="share-link">Copy this link:</label>
            <input
              id="share-link"
              readOnly
              value={shareLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button onClick={() => setShareLink(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
      </header>

      <Console planner={planner} />

      <main className="main">
        {result.ok ? (
          <>
            <div className="canvas">
              <SchematicViewport
                plan={result.plan}
                data={data}
                viewMode={planner.state.viewMode}
                wiringMode={planner.state.wiringMode}
                layout={planner.state.layout}
                onLayoutChange={(layout) => planner.patch({ layout })}
              />
            </div>
            <Breakdown plan={result.plan} data={data} />
          </>
        ) : (
          <div className="errors">
            <h2>Cannot plan this chain</h2>
            <ul>
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  )
}
