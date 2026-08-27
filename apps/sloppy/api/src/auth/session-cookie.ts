import type { Request, Response } from "express";

export const SESSION_COOKIE = "sloppy_session";

/**
 * Two ways to present the same session, one per surface. The browser gets a
 * cookie because the callback lands there as a navigation, with nowhere to put
 * a token; every other shell sends `Authorization: Bearer`, because a cookie
 * cannot cross from this origin to `tauri://localhost` or a deep link.
 *
 * The header wins when both arrive: it is the credential the caller chose for
 * this request, and a cookie left over from an earlier one should not shadow it.
 */
export function readCredential(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (bearer) return bearer[1].trim() || undefined;
  }
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

/** Express parses cookies only with middleware `main.ts` does not install. */
function readCookie(header: unknown, name: string): string | undefined {
  if (typeof header !== "string") return undefined;
  // A jar can carry several cookies of one name — anything on a shared parent
  // domain may write one — so an unusable value is skipped rather than
  // answering for the ones behind it.
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    const value = decodedOrNothing(pair.slice(eq + 1).trim());
    if (value) return value;
  }
  return undefined;
}

function decodedOrNothing(value: string): string | undefined {
  try {
    return decodeURIComponent(value) || undefined;
  } catch {
    return undefined;
  }
}

export function setSessionCookie(
  res: Response,
  credential: string,
  expiresAt: string,
  secure: boolean,
): void {
  res.cookie(SESSION_COOKIE, credential, {
    path: "/",
    httpOnly: true,
    secure,
    // `lax`, not `none`: `none` would attach this cookie to every cross-site
    // request, and a cross-site form POST needs no preflight for CORS to stop.
    // Top-level navigations still carry it, which is all the callback needs.
    sameSite: "lax",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
