import { BadRequestException } from "@nestjs/common";
import type { CreateUploadRequest } from "@sloppy/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Delegation, SyrService } from "../syr/syr.service";
import { folderPathFor, MediaService, splitUploadId } from "./media.service";

const DID = "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9";

const DELEGATION: Delegation = {
  did: DID,
  syr_instance_url: "https://syr.example",
  delegate_public_key: "z6Mkok",
  access_token: "token",
};

function serviceOver(store: Partial<SyrService>): MediaService {
  return new MediaService(store as SyrService);
}

const REQUEST: CreateUploadRequest = {
  role: "emoji",
  filename: "wave.png",
  mime_type: "image/png",
  size: 1024,
};

describe("splitUploadId", () => {
  it("splits on the last separator, so a did's own slashes survive", () => {
    expect(splitUploadId(`${DID}/01ABC`)).toEqual({
      did: DID,
      localId: "01ABC",
    });
  });

  it.each(["", "/", "no-separator", `${DID}/`])("refuses %s", (id) => {
    expect(() => splitUploadId(id)).toThrow(BadRequestException);
  });
});

describe("where a role's blobs land", () => {
  // A folder named `public` is the store's whole access rule, and a note is
  // private until its subtree is published.
  it("keeps a note's pictures out of the open, and puts the rest in it", () => {
    expect(folderPathFor("block")[0]).not.toBe("public");
    for (const role of ["avatar", "banner", "emoji"] as const) {
      expect(folderPathFor(role)[0]).toBe("public");
    }
  });
});

describe("asking for somewhere to put a file", () => {
  it("refuses a type the role does not take, before anything is asked of the store", async () => {
    const createUpload = vi.fn();
    await expect(
      serviceOver({ createUpload }).createUpload(DELEGATION, {
        ...REQUEST,
        mime_type: "application/x-msdownload",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("refuses a file past the role's limit, before anything is asked of the store", async () => {
    const createUpload = vi.fn();
    await expect(
      serviceOver({ createUpload }).createUpload(DELEGATION, {
        ...REQUEST,
        size: 8 * 1024 * 1024,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("carries the store's ticket back as one opaque id", async () => {
    const ticket = await serviceOver({
      createUpload: vi.fn().mockResolvedValue({
        signedUrl: "https://blobs.example/put?sig=1",
        finalUrl: "https://blobs.example/wave.png",
        uploadDid: DID,
        uploadLocalId: "01ABC",
      }),
    }).createUpload(DELEGATION, REQUEST);

    expect(ticket.upload_id).toBe(`${DID}/01ABC`);
    expect(ticket.upload_url).toBe("https://blobs.example/put?sig=1");
    expect(ticket.upload_headers).toEqual({ "content-type": "image/png" });
  });
});

describe("saying the bytes are there", () => {
  // The waits between attempts are real seconds; nothing here is waiting on
  // anything but them.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks again while the store has not seen them, and answers when it has", async () => {
    const completeUpload = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        filename: "wave.png",
        mime_type: "image/png",
        size: 1024,
        url: "https://blobs.example/wave.png",
        metadata: { width: 64, height: 64 },
      });

    const answering = serviceOver({ completeUpload }).completeUpload(
      DELEGATION,
      { upload_id: `${DID}/01ABC` },
    );
    await vi.runAllTimersAsync();
    const asset = await answering;

    expect(completeUpload).toHaveBeenCalledTimes(2);
    // No address: where the bytes actually live is the store's, and handing it
    // to a reader is what tells that machine who is reading.
    expect(asset).toEqual({
      upload_id: `${DID}/01ABC`,
      mime_type: "image/png",
      size: 1024,
      width: 64,
      height: 64,
    });
  });

  it("gives up rather than asking forever", async () => {
    const completeUpload = vi.fn().mockResolvedValue(null);
    const giving = serviceOver({ completeUpload }).completeUpload(DELEGATION, {
      upload_id: `${DID}/01ABC`,
    });
    const refused = expect(giving).rejects.toThrow(BadRequestException);
    await vi.runAllTimersAsync();
    await refused;
    expect(completeUpload.mock.calls.length).toBeGreaterThan(1);
  });
});
