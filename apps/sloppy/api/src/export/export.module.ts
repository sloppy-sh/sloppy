import { Module } from "@nestjs/common";
import { ArchiveModule } from "../archive/archive.module";
import { NodeModule } from "../node/node.module";
import { ExportController } from "./export.controller";
import { ExportRepository } from "./export.repository";
import { ExportService } from "./export.service";

/** A copy of somebody's own graphs, notes and sections, for them to keep — as
 *  the one document here, and as {@link ArchiveModule}'s folder of files.
 *  Imports {@link NodeModule} for the graph listing that names them, which is
 *  also what writes the home graph's row before it is read. */
@Module({
  imports: [NodeModule, ArchiveModule],
  controllers: [ExportController],
  providers: [ExportService, ExportRepository],
})
export class ExportModule {}
