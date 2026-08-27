// The file store, the emoji catalog and the profile, against a real SurrealDB.
//
// These are the rules a peer's reader and an app's uploader both depend on:
// which uploads a stranger may read, what a ticket is good for, and what an
// emoji is allowed to point at. Same gate as `delegation.integration.test.ts` —
// skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`.

import { createConnection } from "node:net";
import { Surreal } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IdpContext } from "./context.js";
import { addEmoji, emojiCatalog, removeEmoji } from "./emojis.js";
import {
  acceptUpload,
  blobUrl,
  finishUpload,
  foldersUnder,
  makeFolder,
  openUpload,
  publicUploadsOf,
  readUploadTicket,
  requireUpload,
} from "./files.js";
import {
  profileOf,
  register,
  resolveSession,
  updateProfile,
} from "./identity.js";
import { deriveIdpSecrets } from "./secrets.js";
import {
  defineIdentitySchema,
  IDENTITY_TABLES,
  purgeIdentity,
} from "./store.js";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const USER = process.env.SURREALDB_USER ?? "root";
const PASS = process.env.SURREALDB_PASS ?? "sloppy-dev-password";

const NAMESPACE = "sloppy_test";
const DATABASE = `files_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";
const BASE = "https://sloppy.example";

const listening = await new Promise<boolean>((resolve) => {
  const socket = createConnection({
    host: ENDPOINT.hostname,
    port: Number(ENDPOINT.port) || (ENDPOINT.protocol === "wss:" ? 443 : 80),
  });
  const settle = (answer: boolean) => {
    socket.destroy();
    resolve(answer);
  };
  socket.setTimeout(1000);
  socket.once("connect", () => settle(true));
  socket.once("timeout", () => settle(false));
  socket.once("error", () => settle(false));
});

/** As the bytes of a one-pixel picture would be checked. */
const BYTES = { size: 70, sha256: "a".repeat(64) };

describe.skipIf(!listening)(`the file store against ${ENDPOINT.href}`, () => {
  let ctx: IdpContext;
  let names = 0;

  const someone = async () =>
    (await register(ctx, { username: `filer${++names}`, password: PASSWORD }))
      .did;

  /** The three folders Sloppy puts a role's blobs in, as `SyrService` makes
   *  them: `public` is what decides a stranger may read what lands there. */
  async function publicFolder(did: string, role: string): Promise<string> {
    let parent: string | null = null;
    for (const name of ["public", "sloppy", role]) {
      parent = (await makeFolder(ctx, did, { name, parent_id: parent })).id;
    }
    return parent as string;
  }

  beforeAll(async () => {
    const db = new Surreal();
    await db.connect(ENDPOINT.href);
    await db.signin({ username: USER, password: PASS });
    await db.use({ namespace: NAMESPACE, database: DATABASE });
    await defineIdentitySchema(db);
    ctx = {
      db,
      secrets: deriveIdpSecrets("integration-secret-of-sufficient-length"),
      publicUrl: BASE,
    };
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.db.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
    await ctx.db.close();
  });

  describe("folders", () => {
    it("gives back the same folder rather than a second one", async () => {
      const did = await someone();
      const once = await makeFolder(ctx, did, { name: "public" });
      const again = await makeFolder(ctx, did, { name: "public" });
      expect(again.id).toBe(once.id);
      expect(await foldersUnder(ctx, did, null)).toHaveLength(1);
    });

    it("keeps two identities' folders of the same name apart", async () => {
      const [one, two] = [await someone(), await someone()];
      const mine = await makeFolder(ctx, one, { name: "public" });
      const theirs = await makeFolder(ctx, two, { name: "public" });
      expect(mine.id).not.toBe(theirs.id);
      expect(await foldersUnder(ctx, two, null)).toEqual([theirs]);
    });

    it("refuses to hang a folder off somebody else's", async () => {
      const [one, two] = [await someone(), await someone()];
      const theirs = await makeFolder(ctx, two, { name: "public" });
      await expect(
        makeFolder(ctx, one, { name: "sneaky", parent_id: theirs.id }),
      ).rejects.toThrow();
    });
  });

  describe("an upload", () => {
    it("is not readable by a stranger until the bytes are there", async () => {
      const did = await someone();
      const ticket = await openUpload(ctx, did, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
        folder_id: await publicFolder(did, "block"),
      });

      expect(ticket.isPublic).toBe(true);
      expect(await finishUpload(ctx, did, ticket.uploadLocalId)).toBe(null);
      expect(
        (await publicUploadsOf(ctx, did, { limit: 24, offset: 0 })).rows,
      ).toEqual([]);

      await acceptUpload(
        ctx,
        await requireUpload(ctx, did, ticket.uploadLocalId),
        BYTES,
      );

      expect(await finishUpload(ctx, did, ticket.uploadLocalId)).toMatchObject({
        status: "completed",
      });
      const { rows, total } = await publicUploadsOf(ctx, did, {
        limit: 24,
        offset: 0,
      });
      expect(total).toBe(1);
      expect(rows[0]?.url).toBe(ticket.finalUrl);
    });

    it("stays out of the public listing when it is not in a public folder", async () => {
      const did = await someone();
      const ticket = await openUpload(ctx, did, {
        filename: "private.png",
        mime_type: "image/png",
        size: BYTES.size,
        folder_id: (await makeFolder(ctx, did, { name: "notes" })).id,
      });
      expect(ticket.isPublic).toBe(false);

      await acceptUpload(
        ctx,
        await requireUpload(ctx, did, ticket.uploadLocalId),
        BYTES,
      );
      expect(
        (await publicUploadsOf(ctx, did, { limit: 24, offset: 0 })).rows,
      ).toEqual([]);
    });

    it("keeps the dimensions the uploader measured", async () => {
      const did = await someone();
      const ticket = await openUpload(ctx, did, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
        metadata: { width: 800, height: 600 },
      });
      const row = await requireUpload(ctx, did, ticket.uploadLocalId);
      expect(row.metadata).toEqual({ width: 800, height: 600 });
    });

    it("refuses bytes that are not the ones it was promised", async () => {
      const did = await someone();
      const ticket = await openUpload(ctx, did, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
        sha256: BYTES.sha256,
      });
      const row = await requireUpload(ctx, did, ticket.uploadLocalId);

      await expect(
        acceptUpload(ctx, row, { ...BYTES, size: BYTES.size + 1 }),
      ).rejects.toThrow();
      await expect(
        acceptUpload(ctx, row, { ...BYTES, sha256: "b".repeat(64) }),
      ).rejects.toThrow();
      expect(await finishUpload(ctx, did, ticket.uploadLocalId)).toBe(null);
    });

    it("is nobody else's to read, whatever they ask for", async () => {
      const [one, two] = [await someone(), await someone()];
      const ticket = await openUpload(ctx, one, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
      });
      await expect(
        requireUpload(ctx, two, ticket.uploadLocalId),
      ).rejects.toThrow();
    });
  });

  describe("an upload ticket", () => {
    it("names the upload it was issued for, and nothing else", async () => {
      const did = await someone();
      const one = await openUpload(ctx, did, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
      });
      const two = await openUpload(ctx, did, {
        filename: "b.png",
        mime_type: "image/png",
        size: BYTES.size,
      });

      const ticket = new URL(one.signedUrl).searchParams.get("ticket") ?? "";
      expect(readUploadTicket(ctx, ticket)).toEqual({
        did,
        localId: one.uploadLocalId,
      });
      expect(readUploadTicket(ctx, ticket)?.localId).not.toBe(
        two.uploadLocalId,
      );
    });

    it("is refused where it was signed by somebody else", async () => {
      const did = await someone();
      const { signedUrl } = await openUpload(ctx, did, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
      });
      const ticket = new URL(signedUrl).searchParams.get("ticket") ?? "";
      const elsewhere = {
        ...ctx,
        secrets: deriveIdpSecrets("a-completely-different-instance-secret"),
      };
      expect(readUploadTicket(elsewhere, ticket)).toBe(null);
    });

    // The ticket key and the session key are derived apart precisely so that
    // holding one is never holding the other.
    it("is not a session, and a session is not one", async () => {
      const grant = await register(ctx, {
        username: `filer${++names}`,
        password: PASSWORD,
      });
      const { signedUrl } = await openUpload(ctx, grant.did, {
        filename: "a.png",
        mime_type: "image/png",
        size: BYTES.size,
      });
      const ticket = new URL(signedUrl).searchParams.get("ticket") ?? "";

      expect(await resolveSession(ctx, ticket)).toBe(null);
      expect(readUploadTicket(ctx, grant.access_token)).toBe(null);
    });
  });

  describe("an emoji", () => {
    async function picture(did: string): Promise<string> {
      const ticket = await openUpload(ctx, did, {
        filename: "wave.png",
        mime_type: "image/png",
        size: BYTES.size,
        folder_id: await publicFolder(did, "emoji"),
      });
      await acceptUpload(
        ctx,
        await requireUpload(ctx, did, ticket.uploadLocalId),
        BYTES,
      );
      return ticket.finalUrl;
    }

    it("is named after a picture its owner uploaded", async () => {
      const did = await someone();
      const entry = await addEmoji(ctx, did, {
        shortcode: "wave",
        url: await picture(did),
        mime_type: "image/png",
        size: BYTES.size,
      });

      expect(entry).toMatchObject({
        did,
        shortcode: "wave",
        is_sticker: false,
      });
      const { entries, total } = await emojiCatalog(ctx, did, {
        limit: 24,
        offset: 0,
      });
      expect(total).toBe(1);
      expect(entries[0]?.local_id).toBe(entry.local_id);

      await removeEmoji(ctx, did, entry.local_id);
      expect(
        (await emojiCatalog(ctx, did, { limit: 24, offset: 0 })).total,
      ).toBe(0);
    });

    // Otherwise a shortcode is an address of somebody else's choosing, and
    // every reader of a note carrying it fetches from there.
    it("cannot be pointed at a machine its owner does not control", async () => {
      const did = await someone();
      for (const url of [
        "https://tracker.example/pixel.png",
        blobUrl(ctx, did, "01NOTHINGHERE"),
        await picture(await someone()),
      ]) {
        await expect(
          addEmoji(ctx, did, {
            shortcode: "borrowed",
            url,
            mime_type: "image/png",
            size: BYTES.size,
          }),
        ).rejects.toThrow();
      }
    });

    it("cannot be pointed at a picture that has not finished arriving", async () => {
      const did = await someone();
      const ticket = await openUpload(ctx, did, {
        filename: "wave.png",
        mime_type: "image/png",
        size: BYTES.size,
        folder_id: await publicFolder(did, "emoji"),
      });
      await expect(
        addEmoji(ctx, did, {
          shortcode: "early",
          url: ticket.finalUrl,
          mime_type: "image/png",
          size: BYTES.size,
        }),
      ).rejects.toThrow();
    });

    it("takes a shortcode nobody in this catalog has taken", async () => {
      const did = await someone();
      const entry = {
        shortcode: "wave",
        url: await picture(did),
        mime_type: "image/png",
        size: BYTES.size,
      };
      await addEmoji(ctx, did, entry);
      await expect(
        addEmoji(ctx, did, { ...entry, url: await picture(did) }),
      ).rejects.toThrow();
    });

    it("is nobody else's to remove", async () => {
      const [one, two] = [await someone(), await someone()];
      const entry = await addEmoji(ctx, one, {
        shortcode: "wave",
        url: await picture(one),
        mime_type: "image/png",
        size: BYTES.size,
      });
      await expect(removeEmoji(ctx, two, entry.local_id)).rejects.toThrow();
    });
  });

  describe("a profile", () => {
    it("changes only what the patch names, and clears what it nulls", async () => {
      const did = await someone();
      await updateProfile(ctx, did, {
        display_name: "Ada",
        bio: "counts things",
        avatar_url: `${BASE}/a.png`,
      });
      expect(await profileOf(ctx, did)).toMatchObject({
        display_name: "Ada",
        bio: "counts things",
        avatar_url: `${BASE}/a.png`,
        banner_url: null,
      });

      await updateProfile(ctx, did, { bio: null });
      expect(await profileOf(ctx, did)).toMatchObject({
        display_name: "Ada",
        bio: null,
        avatar_url: `${BASE}/a.png`,
      });

      await updateProfile(ctx, did, {});
      expect(await profileOf(ctx, did)).toMatchObject({ display_name: "Ada" });
    });
  });

  it("takes the files and the emoji with the identity they belong to", async () => {
    const did = await someone();
    const ticket = await openUpload(ctx, did, {
      filename: "a.png",
      mime_type: "image/png",
      size: BYTES.size,
      folder_id: await publicFolder(did, "emoji"),
    });
    await acceptUpload(
      ctx,
      await requireUpload(ctx, did, ticket.uploadLocalId),
      BYTES,
    );
    await addEmoji(ctx, did, {
      shortcode: "wave",
      url: ticket.finalUrl,
      mime_type: "image/png",
      size: BYTES.size,
    });

    await purgeIdentity(ctx.db, did);

    for (const table of IDENTITY_TABLES) {
      const [rows] = await ctx.db.query<[unknown[]]>(
        `SELECT * FROM ${table} WHERE did = $did;`,
        { did },
      );
      expect(rows).toEqual([]);
    }
  });
});
