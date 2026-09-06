import { Module } from "@nestjs/common";
import { NodeModule } from "../node/node.module";
import { ExportController } from "./export.controller";
import { ExportRepository } from "./export.repository";
import { ExportService } from "./export.service";

/** A copy of somebody's own graphs, notes and sections, for them to keep.
 *  Imports {@link NodeModule} for the graph listing that names them, which is
 *  also what writes the home graph's row before it is read. */
@Module({
  imports: [NodeModule],
  controllers: [ExportController],
  providers: [ExportService, ExportRepository],
})
export class ExportModule {}
