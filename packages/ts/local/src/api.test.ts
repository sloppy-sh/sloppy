import {
  ServerRequiredError,
  SloppyNotImplementedError,
  type SloppyApi,
} from "@sloppy/client";
import { describe, expect, it } from "vitest";
import { LocalApi } from "./api.js";
import { MemoryFiles } from "./files.js";

/** True only where every public member of the client is answered here, by
 *  shape. A missing method makes it false, so the port cannot drift away from
 *  this class without the build saying so. */
type Answers = LocalApi extends SloppyApi ? true : false;

const api = new LocalApi(new MemoryFiles());

describe("the client a graph on this device is served through", () => {
  it("answers the whole surface every page already talks to", () => {
    const answers: Answers = true;
    expect(answers).toBe(true);
  });

  it("says in words what needs another machine to exist", async () => {
    await expect(api.publish({} as never)).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
    await expect(api.follow({} as never)).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
    await expect(api.listComments("did:syr:z1/01J")).rejects.toThrow(
      "Comments needs a server connection",
    );
    await expect(api.profileOf("did:syr:z1")).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
    await expect(api.emojiOf("did:syr:z1")).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
  });

  it("keeps what a local graph will serve apart from what it never will", async () => {
    await expect(api.listGraphs()).rejects.toBeInstanceOf(
      SloppyNotImplementedError,
    );
    await expect(api.listNodes()).rejects.toBeInstanceOf(
      SloppyNotImplementedError,
    );
    await expect(api.ownEmoji()).rejects.toBeInstanceOf(
      SloppyNotImplementedError,
    );
    await expect(api.searchNotes("anything")).rejects.toBeInstanceOf(
      SloppyNotImplementedError,
    );
  });
});
