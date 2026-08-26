// Who may make a CREDENTIALED cross-origin request. `credentials: true` lets
// the calling page read the response, so reflecting every origin would hand any
// site on the internet a readable session belonging to whoever visits it. The
// list is closed in production; development additionally allows loopback and
// RFC1918, because the shells are served from another port on the same machine
// — but only those, never any origin.

/** RFC1918 and loopback. Development only. */
const DEV_LAN = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
];

const TAURI_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

/** Distinct denied origins worth a log line. The caller picks the header, so
 *  the supply of distinct values is theirs; past this the API stays quiet. */
export const DENIAL_LOG_LIMIT = 32;

export type CorsOriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void;

export interface CorsOriginOptions {
  allowedOrigins: readonly string[];
  isProduction: boolean;
  warn: (message: string) => void;
}

function isDevLanOrigin(origin: string): boolean {
  try {
    return DEV_LAN.some((re) => re.test(new URL(origin).hostname));
  } catch {
    return false;
  }
}

export function corsOrigin({
  allowedOrigins,
  isProduction,
  warn,
}: CorsOriginOptions): CorsOriginCheck {
  const allowed = new Set([...TAURI_ORIGINS, ...allowedOrigins]);
  const logged = new Set<string>();

  return (origin, callback) => {
    // No Origin header at all: a same-origin navigation, curl, or the
    // server-to-server fetch federation actually runs on.
    if (!origin) return callback(null, true);
    if (allowed.has(origin)) return callback(null, true);
    if (!isProduction && isDevLanOrigin(origin)) return callback(null, true);

    if (logged.size < DENIAL_LOG_LIMIT && !logged.has(origin)) {
      logged.add(origin);
      warn(
        `CORS: denied ${origin} — add it to SLOPPY_ALLOWED_ORIGINS if it is one of yours`,
      );
    }
    // `false`, not an Error: omitting the header is the correct refusal, and
    // throwing would turn a blocked page into a 500 in our own logs.
    return callback(null, false);
  };
}
