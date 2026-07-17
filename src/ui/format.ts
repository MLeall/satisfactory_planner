/** Format a rate/quantity: up to 2 decimals, trailing zeros trimmed. */
export function fmt(n: number): string {
  return Number(n.toFixed(2)).toString()
}
