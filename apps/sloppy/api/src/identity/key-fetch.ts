// Reading a key from an address an email domain decides.
// docs/ARCHITECTURE.md § "Who a person is".

import { ForbiddenException, Logger } from "@nestjs/common";
import type { KeyAnswer, ReadKeyAt } from "@sloppy/openpgp";
import {
  type HostPolicy,
  type ReachableResponse,
  fetchReachable,
} from "../media/remote-host";

const REQUEST_TIMEOUT_MS = 10_000;

/** A key with a lifetime of signatures on it sits far under this; an answer
 *  that runs past it is not a key. */
const MAX_KEY_BYTES = 256 * 1024;

const logger = new Logger("KeyFetch");

/**
 * A read bounded on every side the address can push on: which host may be
 * connected to, how long it may take, and how much it may send.
 *
 * **A refusal is `unreachable`.** Nothing was learned about whose key it is,
 * which grants nothing and takes nothing away — and a domain somebody else
 * chose must never be able to turn a lookup into a statement about them.
 */
export function readKeyThrough(policy: HostPolicy): ReadKeyAt {
  return async (url: string): Promise<KeyAnswer> => {
    let response: ReachableResponse;
    try {
      response = await fetchReachable(url, policy, {
        method: "GET",
        headers: { accept: "application/pgp-keys" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn(
        error instanceof ForbiddenException
          ? `${url} is at an address this instance will not connect to`
          : `${url} did not answer: ${reason(error)}`,
      );
      return { answer: "unreachable" };
    }

    if (response.status === 404 || response.status === 410) {
      await discard(response);
      return { answer: "none" };
    }
    if (!response.ok) {
      await discard(response);
      logger.warn(`${url} answered ${response.status}`);
      return { answer: "unreachable" };
    }

    const block = await bounded(response, url);
    if (block === null) return { answer: "unreachable" };
    return block.byteLength === 0
      ? { answer: "none" }
      : { answer: "held", block };
  };
}

/** `null` where the answer ran past what is read, or stopped part way — an
 *  answer nobody has the whole of is not one. */
async function bounded(
  response: ReachableResponse,
  url: string,
): Promise<Uint8Array | null> {
  const stream = response.body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const held: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_KEY_BYTES) {
        logger.warn(`${url} was still answering past the size Sloppy reads`);
        return null;
      }
      held.push(value);
    }
  } catch (error) {
    logger.warn(`${url} stopped part way: ${reason(error)}`);
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const whole = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of held) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return whole;
}

async function discard(response: ReachableResponse): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
