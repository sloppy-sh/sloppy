import { createHash } from "node:crypto";
import {
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import {
  acceptUpload,
  IdpError,
  readUploadTicket,
  requireUpload,
  resolvePlatformToken,
  resolveSession,
  type UploadRow,
} from "@sloppy/idp";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { BlobStore } from "./blob-store";
import { IdpExceptionFilter, type IdpRequest } from "./idp-request";
import { IdpService } from "./idp.service";

/**
 * The bytes of an upload: in on a ticket, out on the address the ticket named.
 *
 * The read is the URL a note, an avatar and an emoji all carry, and a peer
 * pulling any of them arrives here holding nothing — so a blob in somebody's
 * public folder answers anyone, and one outside it answers only its owner.
 */
@Controller("idp/blob")
@Public()
@UseFilters(IdpExceptionFilter)
export class BlobController {
  constructor(
    private readonly idp: IdpService,
    private readonly blobs: BlobStore,
  ) {}

  @Put(":did/:localId")
  async receive(
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Query("ticket") ticket: string | undefined,
    @Req() req: IdpRequest,
  ): Promise<{ status: "success" }> {
    const named = ticket ? readUploadTicket(this.idp.context, ticket) : null;
    if (
      !named ||
      named.did !== decodeURIComponent(did) ||
      named.localId !== decodeURIComponent(localId)
    ) {
      throw new IdpError(
        403,
        "invalid_ticket",
        "That upload has expired. Try adding the file again.",
      );
    }

    const row = await requireUpload(this.idp.context, named.did, named.localId);
    if (row.status === "completed") {
      throw new IdpError(
        409,
        "already_uploaded",
        "That file has already been added.",
      );
    }

    const bytes = await read(req, row.size);
    await this.blobs.put(row.key, row.mime_type, bytes);
    await acceptUpload(this.idp.context, row, {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return { status: "success" };
  }

  @Get(":did/:localId")
  async serve(
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Req() req: IdpRequest,
    @Res() res: Response,
  ): Promise<void> {
    const row = await requireUpload(
      this.idp.context,
      decodeURIComponent(did),
      decodeURIComponent(localId),
    );
    if (row.status !== "completed") throw missing();
    if (!row.is_public && !(await this.isOwner(req, row))) throw missing();

    const stored = await this.blobs.open(row.key);
    if (!stored) throw missing();

    res.status(200);
    res.setHeader("content-type", stored.contentType ?? row.mime_type);
    if (stored.size !== undefined) {
      res.setHeader("content-length", String(stored.size));
    }
    // Served from this origin, so a document type would run as this origin.
    res.setHeader("content-security-policy", "sandbox; default-src 'none'");
    res.setHeader("x-content-type-options", "nosniff");
    // The address names one upload for its life, and an upload's bytes never
    // change — a second version is a second upload.
    res.setHeader(
      "cache-control",
      row.is_public
        ? "public, max-age=31536000, immutable"
        : "private, max-age=300",
    );
    stored.body.on("error", () => res.end());
    stored.body.pipe(res);
  }

  private async isOwner(req: IdpRequest, row: UploadRow): Promise<boolean> {
    const header = req.headers.authorization;
    if (!header || !/^Bearer\s+/i.test(header)) return false;
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!token) return false;
    const ctx = this.idp.context;
    const session = await resolveSession(ctx, token);
    if (session) return session.did === row.did;
    const platform = await resolvePlatformToken(ctx, token);
    return platform?.did === row.did;
  }
}

/**
 * The bytes, refused the moment more arrive than the upload said were coming.
 * The declared size is what the store already promised to hold, so it is also
 * the ceiling: nothing here has to trust a length header.
 */
async function read(req: IdpRequest, declared: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > declared) {
      req.destroy();
      throw new IdpError(
        413,
        "file_too_large",
        "That file is bigger than expected. Try adding it again.",
      );
    }
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function missing(): IdpError {
  return new IdpError(404, "not_found", "That file is not there.");
}
