import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  type ArchivePreview,
  type GraphView,
  type ImportResolution,
  ImportSettlementSchema,
  MAX_ARCHIVE_BYTES,
} from "@sloppy/types";
import { ARCHIVE_MIME } from "@sloppy/vault";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/authed-request";
import { requireGraphRef, viewerDelegation, viewerDid } from "../node/request";
import { readImport } from "./archive-body";
import { ArchiveExportService } from "./archive-export.service";
import { ArchiveImportService } from "./archive-import.service";

/** A graph as a folder somebody keeps, out and back —
 *  docs/ARCHITECTURE.md § "A graph on disk". */
@Controller("graphs")
export class ArchiveController {
  constructor(
    private readonly out: ArchiveExportService,
    private readonly incoming: ArchiveImportService,
  ) {}

  @Get(":did/:localId/archive")
  async download(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    const archive = await this.out.archive(
      viewerDelegation(req),
      viewerDid(req),
      requireGraphRef(did, localId),
    );
    res.setHeader("content-type", ARCHIVE_MIME);
    res.setHeader("cache-control", "no-store");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${archive.filename}"`,
    );
    res.end(Buffer.from(archive.bytes));
  }

  /** With `preview`, what the archive would bring; without it, the graph it
   *  brought. */
  @Post("import")
  async take(
    @Req() req: AuthedRequest,
    @Query("preview") preview: string | undefined,
  ): Promise<ArchivePreview | GraphView> {
    const { archive, settle } = await readImport(req, MAX_ARCHIVE_BYTES);
    const delegation = viewerDelegation(req);
    const did = viewerDid(req);
    return asked(preview)
      ? this.incoming.preview(delegation, did, archive)
      : this.incoming.write(delegation, did, archive, settled(settle));
  }
}

/** What the person chose between the two copies, or none where they were not
 *  asked. */
function settled(raw: string | null): ImportResolution[] {
  if (raw === null) return [];
  try {
    return ImportSettlementSchema.parse(JSON.parse(raw)).resolutions;
  } catch {
    throw new BadRequestException(
      "Sloppy could not read what you chose between the two copies. Bring this graph in again.",
    );
  }
}

/** `?preview` on its own is asking for one, the way a flag reads. */
function asked(value: string | undefined): boolean {
  return value !== undefined && value !== "0" && value !== "false";
}
