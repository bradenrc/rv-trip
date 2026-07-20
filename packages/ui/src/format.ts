/** Format a dollar amount for display (e.g. 204 → "$204"). */
export function money(n: number): string {
  return "$" + n.toLocaleString("en-US");
}
