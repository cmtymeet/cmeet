/** Community display names never replace the member handle. */
export function memberName(handle: string, displayName?: string): string {
  return displayName?.trim() ? `${displayName} · @${handle}` : handle;
}
