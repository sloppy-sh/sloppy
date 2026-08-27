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
 * The address to render a picture from. Viewing a federated node must never
 * leak the viewer's IP to the author's instance, so every address that came
 * from somebody else's graph goes through here before it reaches an `<img>` or
 * a `fetch`; AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store"
 * states the rule.
 *
 * A `MediaAsset`-shaped address the API minted is a path under the API, and it
 * lands on whichever host this shell reaches its instance at. An absolute URL —
 * including a look-alike from a peer — is sent to the asset route unsigned,
 * where it is refused rather than fetched, so a picture nothing vouched for
 * fails to draw instead of reaching a stranger's machine.
 *
 * Anything else — a data URL, a bundled asset — is already local and is handed
 * back untouched.
 */
export function proxied(src: string): string {
  if (isAssetRoute(src)) return apiUrl(src);
  if (!/^https?:\/\//i.test(src)) return src;
  return apiUrl(`/proxy?url=${encodeURIComponent(src)}`);
}

/** The API's own asset route, as the API's `AssetLinks` mints it. Having no
 *  origin is the whole point: an absolute address is somebody else's host, even
 *  when it is spelled like this one. */
function isAssetRoute(src: string): boolean {
  return src.startsWith("/proxy?ref=");
}
