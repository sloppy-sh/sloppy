import { Controller, Get, Res } from "@nestjs/common";
import type { HealthReport } from "@sloppy/types";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { DbService } from "../db/db.service";

/**
 * Whether this instance can actually serve. It asks the database rather than
 * answering from a flag set at boot, because the failure worth catching is the
 * connection that went away since.
 *
 * A degraded instance answers 503 with the same body a healthy one answers 200
 * with, so a load balancer reads the status and a client reads the report.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const database = (await this.db.reachable()) ? "up" : "down";
    const report: HealthReport = {
      status: database === "up" ? "ok" : "degraded",
      checks: [{ dependency: "database", status: database }],
    };
    if (report.status === "degraded") res.status(503);
    return report;
  }
}
