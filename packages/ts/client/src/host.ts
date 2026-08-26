// Where the API is. One module owns it, because the answer differs per shell
// and changes at runtime: the web app is same-origin, the native app points at
// whatever host the person configured, and either may be re-pointed mid-session.
//
// Nothing outside here spells a URL. `apiUrl` is the only place that knows the
// API mounts under `/api`, so a client call names a path and nothing more.

/** The prefix `main.ts` sets with `setGlobalPrefix`. */
const API_PREFIX = "/api";

let base = "";

/**
 * Called once at boot, before any request, and again whenever the person
 * re-points the app at another server. `''` means same-origin.
 *
 * A live `SloppyClient` re-reads this per request, so re-pointing needs no new
 * client — but an api implementation swap does. See `@sloppy/app-core`'s
 * `resetApi`.
 */
export function setHost(url: string): void {
  base = (url ?? "").replace(/\/+$/, "");
}

export function getHost(): string {
  return base;
}

/** `path` starts with `/` and is relative to the API, not to the origin. */
export function apiUrl(path: string): string {
  return `${base}${API_PREFIX}${path}`;
}

/** True where the API shares the page's origin, so a cookie session reaches it. */
export function isSameOrigin(): boolean {
  return base === "";
}

/**
 * Route a remote asset through our own proxy. Viewing a federated node must
 * never leak the viewer's IP to the author's instance, so every URL that came
 * from somebody else's graph goes through here before it reaches an `<img>` or
 * a `fetch`; AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store"
 * states the rule.
 *
 * Anything that is not an absolute http(s) URL — a data URL, a bundled asset —
 * is already local and is handed back untouched.
 */
export function proxied(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  return apiUrl(`/proxy?url=${encodeURIComponent(url)}`);
}
