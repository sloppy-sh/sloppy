// Finding a picture inside a note the reader pulled. The listing it is found in
// is paginated and can be long — docs/ARCHITECTURE.md § "Pictures" — so what is
// checked here is that one walk answers for the whole branch, and that nothing
// is asked at all about an author the reader holds nothing of.

import { NotFoundException } from "@nestjs/common";
import type { DidSyr, OwnedRef, Pull, SyrOwnedUpload } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import type { PullRepository } from "../peer/pull.repository";
import type { SyrService } from "../syr/syr.service";
import { HeldPictures } from "./held-pictures";

const AVA =
  "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9" as DidSyr;
const BRAM =
  "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG" as DidSyr;
const HERE = "http://127.0.0.1:8020";
const THERE = "http://127.0.0.1:9999";

const config = {
  isProduction: false,
  publicUrl: HERE,
} as AppConfigService;

const region = {
  publication: `${AVA}/PUBLICATION` as OwnedRef,
  source_url: THERE,
} as Pull;

/** A completed public picture, as the author's own instance lists one. */
function upload(at: number, of: Partial<SyrOwnedUpload> = {}): SyrOwnedUpload {
  return {
    did: AVA,
    local_id: `PICTURE${String(at).padStart(3, "0")}`,
    filename: `figure-${at}.png`,
    mime_type: "image/png",
    size: 96,
    status: "completed",
    is_public: true,
    url: `${THERE}/files/${at}.png`,
    ...of,
  };
}

/** The author's listing, served a page at a time, counting what it was asked.
 *  `serves` is the far end's own ceiling on a page, which is theirs to pick. */
function author(held: SyrOwnedUpload[], serves = 100) {
  const asked: { instanceUrl: string; offset: number }[] = [];
  const syr = {
    async listPublicUploads(
      instanceUrl: string,
      _did: string,
      page: { limit: number; offset: number },
    ) {
      asked.push({ instanceUrl, offset: page.offset });
      return held.slice(
        page.offset,
        page.offset + Math.min(page.limit, serves),
      );
    },
  } as unknown as SyrService;
  return { syr, asked };
}

function holding(pull: Pull | null): PullRepository {
  return {
    async regionFrom(_reader: DidSyr, of: DidSyr) {
      return of === AVA ? pull : null;
    },
  } as unknown as PullRepository;
}

describe("a picture inside a note the reader holds", () => {
  it("finds one past the first page of the author's listing", async () => {
    const listing = Array.from({ length: 260 }, (_, at) => upload(at));
    const { syr, asked } = author(listing);
    const pictures = new HeldPictures(config, holding(region), syr);

    await expect(
      pictures.address(BRAM, { did: AVA, localId: "PICTURE250" }),
    ).resolves.toBe(`${THERE}/files/250.png`);
    expect(asked.map((one) => one.offset)).toEqual([0, 100, 200]);
    expect(new Set(asked.map((one) => one.instanceUrl))).toEqual(
      new Set([THERE]),
    );
  });

  // A note full of figures is one walk, not one per figure, which is the whole
  // of what puts a searched listing behind an `<img>`.
  it("answers for every picture the walk passed on the way", async () => {
    const listing = Array.from({ length: 120 }, (_, at) => upload(at));
    const { syr, asked } = author(listing);
    const pictures = new HeldPictures(config, holding(region), syr);

    await pictures.address(BRAM, { did: AVA, localId: "PICTURE110" });
    const reads = asked.length;
    await expect(
      pictures.address(BRAM, { did: AVA, localId: "PICTURE007" }),
    ).resolves.toBe(`${THERE}/files/7.png`);

    expect(asked).toHaveLength(reads);
  });

  // Which is how the browser actually asks: every picture in the note at once.
  it("walks once for pictures asked for all at the same time", async () => {
    const listing = Array.from({ length: 260 }, (_, at) => upload(at));
    const { syr, asked } = author(listing);
    const pictures = new HeldPictures(config, holding(region), syr);

    await expect(
      Promise.all(
        ["PICTURE250", "PICTURE007", "PICTURE130"].map((localId) =>
          pictures.address(BRAM, { did: AVA, localId }),
        ),
      ),
    ).resolves.toEqual([
      `${THERE}/files/250.png`,
      `${THERE}/files/7.png`,
      `${THERE}/files/130.png`,
    ]);
    expect(asked.map((one) => one.offset)).toEqual([0, 100, 200]);
  });

  it("takes up a listing where the last walk of it stopped", async () => {
    const listing = Array.from({ length: 260 }, (_, at) => upload(at));
    const { syr, asked } = author(listing);
    const pictures = new HeldPictures(config, holding(region), syr);

    await pictures.address(BRAM, { did: AVA, localId: "PICTURE050" });
    await expect(
      pictures.address(BRAM, { did: AVA, localId: "PICTURE250" }),
    ).resolves.toBe(`${THERE}/files/250.png`);

    expect(asked.map((one) => one.offset)).toEqual([0, 100, 200]);
  });

  // The far end is a stranger's instance, and how much of a listing it hands
  // back at a time is its own business, not this one's.
  it("keeps walking past a page shorter than the one it asked for", async () => {
    const listing = Array.from({ length: 60 }, (_, at) => upload(at));
    const { syr, asked } = author(listing, 24);
    const pictures = new HeldPictures(config, holding(region), syr);

    await expect(
      pictures.address(BRAM, { did: AVA, localId: "PICTURE050" }),
    ).resolves.toBe(`${THERE}/files/50.png`);
    expect(asked.map((one) => one.offset)).toEqual([0, 24, 48]);
  });

  it("reads back from where the store says the bytes read back from", async () => {
    const { syr } = author([
      upload(0, { downloadUrl: `${THERE}/download/0.png` }),
    ]);
    const pictures = new HeldPictures(config, holding(region), syr);

    await expect(
      pictures.address(BRAM, { did: AVA, localId: "PICTURE000" }),
    ).resolves.toBe(`${THERE}/download/0.png`);
  });

  it("asks nothing at all about an author the reader holds no branch of", async () => {
    const { syr, asked } = author([upload(0)]);
    const pictures = new HeldPictures(config, holding(null), syr);

    await expect(
      pictures.address(BRAM, { did: AVA, localId: "PICTURE000" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(asked).toEqual([]);
  });

  it("serves nothing the author's store has not put in the open", async () => {
    const { syr } = author([
      upload(0, { is_public: false }),
      upload(1, { status: "finalizing", url: null }),
      upload(2, { mime_type: "application/pdf" }),
    ]);
    const pictures = new HeldPictures(config, holding(region), syr);

    for (const localId of ["PICTURE000", "PICTURE001", "PICTURE002"]) {
      await expect(
        pictures.address(BRAM, { did: AVA, localId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it("refuses a picture named under something that is not an identity", async () => {
    const { syr, asked } = author([upload(0)]);
    const pictures = new HeldPictures(config, holding(region), syr);

    await expect(
      pictures.address(BRAM, { did: "../../etc", localId: "PICTURE000" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(asked).toEqual([]);
  });
});
