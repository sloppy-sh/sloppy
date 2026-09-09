// How a picture's bytes travel. A store across a network is sent them; a store
// that is this device takes them itself, because a webview carries no request
// body to the app it belongs to.

import { describe, expect, it, vi } from "vitest";
import { uploadFile } from "./upload.js";

const PICTURE = new File([new Uint8Array([1, 2, 3])], "seed.png", {
  type: "image/png",
});

const TICKET = {
  upload_id: "01UPLOAD",
  upload_url: "vault://localhost/%2Fgarden%2Fmedia%2Fa.png",
  upload_headers: {},
};

function client(sendUpload?: (ticket: unknown, file: Blob) => Promise<void>) {
  return {
    createUpload: async () => TICKET,
    completeUpload: async () => ({ upload_id: TICKET.upload_id }),
    ...(sendUpload ? { sendUpload } : {}),
  } as never;
}

describe("sending a picture", () => {
  it("hands the bytes to a store that takes them itself", async () => {
    const kept = vi.fn(async () => {});
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    await uploadFile(client(kept), PICTURE, { role: "block" }).asset;

    expect(kept).toHaveBeenCalledWith(TICKET, PICTURE);
    expect(sent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("says so where those bytes could not be kept", async () => {
    const kept = async () => {
      throw new Error("That picture is not here.");
    };

    await expect(
      uploadFile(client(kept), PICTURE, { role: "block" }).asset,
    ).rejects.toThrow("That picture is not here.");
  });
});
