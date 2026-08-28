// The seed is the part of the layout the protocol claims, so it is proved here
// rather than asserted: AI.md § "The Address Is the Protocol" says two peers
// applying the same creations must agree, and a seed that disagreed would put
// the same subtree in a different place on every screen.

import { type Address, parseAddress } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { makeCorpus, mulberry32 } from "../corpus.test-support.js";
import { seedAddress, seedField } from "./geometry.js";

const corpus = makeCorpus();
const addresses = corpus.nodes.map((node) => node.address);

describe("seedField", () => {
  it("agrees with the one-address form, everywhere", () => {
    const field = seedField(addresses);
    for (const address of addresses) {
      expect(field.get(address)).toEqual(seedAddress(address));
    }
  });

  it("does not depend on the order it is handed", () => {
    const shuffled = shuffle(addresses, 7);
    const straight = seedField(addresses);
    const scrambled = seedField(shuffled);
    for (const address of addresses) {
      expect(scrambled.get(address)).toEqual(straight.get(address));
    }
  });

  // The claim that matters: a peer that pulled one branch and a peer that holds
  // the whole graph put that branch in the same place, without either shipping
  // a coordinate.
  it("gives a peer holding one subtree the same positions", () => {
    const whole = seedField(addresses);
    const branch = addresses.filter((address) => address.startsWith("3"));
    expect(branch.length).toBeGreaterThan(10);
    const partial = seedField(branch);
    for (const address of branch) {
      expect(partial.get(address)).toEqual(whole.get(address));
    }
  });

  it("never seeds two addresses to the same point", () => {
    const seen = new Set<string>();
    for (const address of addresses) {
      const seed = seedAddress(address);
      const key = `${seed.x}:${seed.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  // A subtree that started scattered would be a subtree the force pass has to
  // gather, and gathering is what makes a settle look like a hairball resolving.
  it("starts a subtree inside a disc its own generation bounds", () => {
    const field = seedField(addresses);
    const roots = addresses.filter(
      (address) => parseAddress(address).length === 3,
    );
    for (const root of roots.slice(0, 40)) {
      const from = field.get(root);
      if (!from) continue;
      const depth = parseAddress(root).length;
      for (const address of addresses) {
        if (!isUnder(root, address)) continue;
        const to = field.get(address);
        if (!to) continue;
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThan(
          reachFrom(depth),
        );
      }
    }
  });
});

/** The furthest a descendant can be seeded from a node `depth` generations in. */
function reachFrom(depth: number): number {
  let reach = 0;
  for (let at = depth + 1; at <= 24; at++) reach += 300 * 0.8 ** (at - 2);
  return reach + 1;
}

function isUnder(ancestor: Address, address: Address): boolean {
  const a = parseAddress(ancestor);
  const d = parseAddress(address);
  if (a.length >= d.length) return false;
  return a.every(
    (segment, at) =>
      segment.kind === d[at].kind && segment.ordinal === d[at].ordinal,
  );
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let at = out.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1));
    [out[at], out[swap]] = [out[swap], out[at]];
  }
  return out;
}
