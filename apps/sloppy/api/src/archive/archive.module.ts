import { Module } from "@nestjs/common";
import { BlockModule } from "../block/block.module";
import { MediaModule } from "../media/media.module";
import { NodeModule } from "../node/node.module";
import { PublicationModule } from "../publication/publication.module";
import { SyrModule } from "../syr/syr.module";
import { ArchiveController } from "./archive.controller";
import { ArchiveExportService } from "./archive-export.service";
import { ArchiveImportService } from "./archive-import.service";
import { ArchiveRepository } from "./archive.repository";

/** A graph as the folder somebody could keep it in, written and read —
 *  docs/ARCHITECTURE.md § "A graph on disk". */
@Module({
  imports: [NodeModule, BlockModule, MediaModule, PublicationModule, SyrModule],
  controllers: [ArchiveController],
  providers: [ArchiveExportService, ArchiveImportService, ArchiveRepository],
})
export class ArchiveModule {}
