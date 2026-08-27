// Which addresses the asset route is willing to fetch from. Everything it
// fetches was named by somebody else's note, so the answer decides whether a
// stranger can aim this instance at its own network.

import { isIP } from "node:net";
import { ForbiddenException } from "@nestjs/common";

/** Refused whatever the deployment says: the cloud metadata service, multicast
 *  and the ranges that are never a real host. */
function alwaysRefusedV4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = parts;
  return a === 0 || a >= 224 || (a === 169 && b === 254);
}

function alwaysRefusedV6(ip: string): boolean {
  const h = ip.toLowerCase();
  return h.startsWith("fe80:") || h.startsWith("ff");
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map((n) => Number.parseInt(n, 10));
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function privateV6(ip: string): boolean {
  const h = ip.toLowerCase();
  return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd");
}

/**
 * `allowPrivate` is what a development machine needs and a deployment must
 * not have: two instances on one LAN are a real test, and the same permission
 * in production is a stranger reading this network through Sloppy.
 *
 * A hostname is allowed on its face. Pinning it through DNS is the missing
 * half of this — a name that resolves into the private range still gets
 * fetched, so this bounds the damage rather than closing it.
 */
export function isReachableRemoteHost(
  host: string,
  options: { allowPrivate: boolean },
): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost"))
    return options.allowPrivate;

  const kind = isIP(h);
  if (kind === 4) {
    if (alwaysRefusedV4(h)) return false;
    return privateV4(h) ? options.allowPrivate : true;
  }
  if (kind === 6) {
    if (alwaysRefusedV6(h)) return false;
    return privateV6(h) ? options.allowPrivate : true;
  }
  return h.length > 0;
}

/**
 * The address this instance answers on is always reachable, whatever the
 * policy says about the range it sits in: a local identity's pictures live
 * there, and inside a container that address is loopback.
 *
 * Refuses in the words a reader gets, because both callers put the result in
 * front of one.
 */
export function reachableUrl(
  target: string,
  policy: { allowPrivate: boolean; ownOrigin?: string },
): URL {
  const refuse = () =>
    new ForbiddenException("That picture could not be loaded.");
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw refuse();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw refuse();
  if (policy.ownOrigin && url.origin === policy.ownOrigin) return url;
  if (!isReachableRemoteHost(url.hostname, policy)) throw refuse();
  return url;
}

/** `undefined` where the configured address is unreadable, which leaves the
 *  policy above with nothing to exempt rather than exempting everything. */
export function ownOrigin(publicUrl: string): string | undefined {
  try {
    return new URL(publicUrl).origin;
  } catch {
    return undefined;
  }
}

export interface HostPolicy {
  allowPrivate: boolean;
  ownOrigin?: string;
}

/** Enough to follow a store that moved its bucket, not enough to be walked
 *  around a network on. */
const MAX_REDIRECTS = 3;

/**
 * A remote read where **every hop** is checked, not just the first. A `302`
 * from an allowed host is a second address chosen by the same stranger who
 * chose the first, so following one on the platform's behalf would hand back
 * exactly the reach `reachableUrl` refuses.
 */
export async function fetchReachable(
  target: string,
  policy: HostPolicy,
  init: RequestInit,
): Promise<Response> {
  let at = reachableUrl(target, policy);
  for (let hop = 0; ; hop++) {
    const response = await fetch(at, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (!isRedirect(response.status) || !location) return response;

    await response.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) {
      throw new ForbiddenException("That picture could not be loaded.");
    }
    at = reachableUrl(new URL(location, at).toString(), policy);
  }
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}
