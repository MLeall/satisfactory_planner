// Sharing a plan without a backend: the whole console state rides in the URL
// fragment. The fragment (not the query) because it never reaches a server, so
// a shared plan stays between the people holding the link.

const toBase64Url = (b64: string) =>
  b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

const fromBase64Url = (token: string) =>
  token.replaceAll('-', '+').replaceAll('_', '/')

export function encodeShare(state: unknown): string {
  const json = JSON.stringify(state)
  // btoa is latin1-only, so widen through UTF-8 bytes first.
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return toBase64Url(btoa(binary))
}

/** Parse a token produced by `encodeShare`. Anything else yields null: the
 * fragment is user-editable and arrives from strangers, so it is never trusted
 * to be well-formed. */
export function decodeShare(token: string): unknown | null {
  if (!token) return null
  try {
    const binary = atob(fromBase64Url(token))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    // Only an object can be merged over the defaults; reject scalars and null.
    if (typeof value !== 'object' || value === null) return null
    return value
  } catch {
    return null
  }
}

/** The current page, with the plan swapped into its fragment. */
export function shareUrl(href: string, state: unknown): string {
  const url = new URL(href)
  url.hash = encodeShare(state)
  return url.toString()
}
