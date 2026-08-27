/**
 * Where sign-in may put somebody down afterwards. The caller names this, so the
 * list is closed: an open redirect on the route that has just minted a session
 * is how a session gets handed to a stranger.
 *
 * Four shapes, one per surface Sloppy runs on:
 *   - a path on this API's own host — the web shell;
 *   - the Tauri webview's own origins — the native shell, navigating in place;
 *   - `sloppy://auth/callback` — the mobile shell's deep link;
 *   - `http://localhost:<port>/` — the desktop shell's loopback listener, whose
 *     port is chosen per handshake and so cannot be pinned.
 */
const TAURI_ORIGIN =
  /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)(\/[^\s]*)?$/;
const DEEP_LINK = /^sloppy:\/\/auth\/callback(?:\?[^\s]*)?$/;
const LOOPBACK = /^http:\/\/localhost:\d{2,5}\/?(?:\?[^\s]*)?$/;

export function isAllowedRedirect(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  // `//host` and `/\host` are absolute URLs to somebody else's host that read
  // as paths. A leading slash is not enough to make a target ours.
  if (value.startsWith("/"))
    return !value.startsWith("//") && !value.startsWith("/\\");
  return (
    TAURI_ORIGIN.test(value) || DEEP_LINK.test(value) || LOOPBACK.test(value)
  );
}

/** A scheme no browser will follow from a `Location` header on its own. */
export function isDeepLink(target: string): boolean {
  return DEEP_LINK.test(target);
}

/** Add a query parameter to a target of any of the four shapes above. */
export function withParams(
  target: string,
  params: Record<string, string>,
): string {
  const query = new URLSearchParams(params).toString();
  return `${target}${target.includes("?") ? "&" : "?"}${query}`;
}
