import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { PublicationModule } from "../publication/publication.module";
import { DeletedSweep } from "./deleted-sweep";
import { FindRepository } from "./find.repository";
import { GraphController } from "./graph.controller";
import { GraphService } from "./graph.service";
import { NodeController } from "./node.controller";
import { NodeRepositoryModule } from "./node-repository.module";
import { NodeService } from "./node.service";

/** Nodes: the address protocol, the graphs that scope it, the genealogical
 *  reads, the tags over them, and the two reads a note is found again by. */
@Module({
  imports: [MediaModule, NodeRepositoryModule, PublicationModule],
  controllers: [NodeController, GraphController],
  providers: [NodeService, GraphService, FindRepository, DeletedSweep],
  exports: [NodeRepositoryModule, NodeService, GraphService],
})
export class NodeModule {}
