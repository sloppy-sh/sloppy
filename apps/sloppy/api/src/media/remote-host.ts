// Which addresses the asset route is willing to fetch from. Everything it
// fetches was named by somebody else's note, so the answer decides whether a
// stranger can aim this instance at its own network.

import { type LookupAllOptions, lookup as resolveHost } from "node:dns";
import { isIP } from "node:net";
import { ForbiddenException } from "@nestjs/common";
// Both from the same copy: Node's own `fetch` is undici, but refuses a
// dispatcher built by a separately installed one — and a dispatcher is the only
// place a connection's address check can live.
import { Agent, type RequestInit, type Response, fetch } from "undici";

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
 * A name is not settled here, because a name is not an address:
 * `metadata.google.internal` and a wildcard host pointed at loopback both pass
 * this and are refused by `fetchReachable`, which applies this same answer to
 * what the name resolves to and connects to nothing else.
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
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw refused();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw refused();
  if (policy.ownOrigin && url.origin === policy.ownOrigin) return url;
  if (!isReachableRemoteHost(url.hostname, policy)) throw refused();
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

export type ReachableResponse = Response;

function refused(): ForbiddenException {
  return new ForbiddenException("That picture could not be loaded.");
}

/** Thrown in the connection's own resolution step, so it reaches the caller
 *  under a `fetch failed` it has to look inside. */
class RefusedAddress extends Error {}

/**
 * A connection that resolves the name itself, refuses unless **every** address
 * it resolves to passes the policy, and then connects to one of those — so the
 * address a fetch reaches is the address that was checked, and a second
 * resolution cannot answer differently in between.
 */
function pinnedTo(allowPrivate: boolean): Agent {
  return new Agent({
    connect: {
      lookup(host, options, done) {
        const all: LookupAllOptions = { ...options, all: true };
        resolveHost(host, all, (err, entries) => {
          if (err) return done(err, "", 0);
          const reaches = (entry: { address: string }) =>
            isReachableRemoteHost(entry.address, { allowPrivate });
          if (entries.length === 0 || !entries.every(reaches)) {
            return done(new RefusedAddress(host), "", 0);
          }
          if (options.all) return done(null, entries);
          done(null, entries[0].address, entries[0].family);
        });
      },
    },
  });
}

const PINNED = {
  strict: pinnedTo(false),
  permissive: pinnedTo(true),
};

/** `undefined` for this instance's own address, whose exemption `reachableUrl`
 *  states and which a resolved-address policy would otherwise overrule. */
function connectionFor(at: URL, policy: HostPolicy): Agent | undefined {
  if (policy.ownOrigin && at.origin === policy.ownOrigin) return undefined;
  return policy.allowPrivate ? PINNED.permissive : PINNED.strict;
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
): Promise<ReachableResponse> {
  let at = reachableUrl(target, policy);
  for (let hop = 0; ; hop++) {
    const response = await connect(at, policy, init);
    const location = response.headers.get("location");
    if (!isRedirect(response.status) || !location) return response;

    await response.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) throw refused();
    at = reachableUrl(new URL(location, at).toString(), policy);
  }
}

async function connect(
  at: URL,
  policy: HostPolicy,
  init: RequestInit,
): Promise<ReachableResponse> {
  try {
    return await fetch(at, {
      ...init,
      redirect: "manual",
      dispatcher: connectionFor(at, policy),
    });
  } catch (error) {
    if (refusedAddress(error)) throw refused();
    throw error;
  }
}

function refusedAddress(error: unknown): boolean {
  let at: unknown = error;
  while (at instanceof Error) {
    if (at instanceof RefusedAddress) return true;
    at = at.cause;
  }
  return false;
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
