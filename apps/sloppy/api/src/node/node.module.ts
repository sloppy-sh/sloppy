import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { PublicationModule } from "../publication/publication.module";
import { GraphController } from "./graph.controller";
import { GraphService } from "./graph.service";
import { NodeController } from "./node.controller";
import { NodeRepositoryModule } from "./node-repository.module";
import { NodeService } from "./node.service";

/** Nodes: the address protocol, the graphs that scope it, the genealogical
 *  reads, and the tags over them. */
@Module({
  imports: [MediaModule, NodeRepositoryModule, PublicationModule],
  controllers: [NodeController, GraphController],
  providers: [NodeService, GraphService],
  exports: [NodeRepositoryModule, NodeService, GraphService],
})
export class NodeModule {}
