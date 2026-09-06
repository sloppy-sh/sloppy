import { Controller, Get, Logger, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/authed-request";
import { viewerDid } from "../node/request";
import { ExportService } from "./export.service";

@Controller("export")
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly copies: ExportService) {}

  /**
   * A copy of everything the caller keeps — `GraphExportSchema` in
   * `@sloppy/types`. Written out as it is read, so the answer starts before the
   * whole of it has been gathered and neither end holds all of it at once.
   */
  @Get()
  async everything(
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const did = viewerDid(req);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${fileName()}"`,
    );
    try {
      for await (const piece of this.copies.everything(did)) {
        if (res.writableEnded || res.destroyed) return;
        if (!res.write(piece)) await drained(res);
      }
    } catch (error) {
      // Past the first piece the status line is already gone, so there is no
      // refusal left to send: the answer stops mid-document and the reader's
      // parse of it fails, which is the only honest end.
      if (!res.headersSent) throw error;
      this.logger.error(`Export for ${did} stopped short`, error);
      res.destroy();
      return;
    }
    res.end();
  }
}

function fileName(): string {
  return `sloppy-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Settles when the socket has room again, or when it has gone. */
function drained(res: Response): Promise<void> {
  return new Promise((settle) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      settle();
    };
    res.once("drain", done);
    res.once("close", done);
  });
}
