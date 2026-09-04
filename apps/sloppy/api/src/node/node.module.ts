import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { PublicationModule } from "../publication/publication.module";
import { NodeController } from "./node.controller";
import { NodeRepositoryModule } from "./node-repository.module";
import { NodeService } from "./node.service";

/** Nodes: the address protocol, the genealogical reads, and the tags over them. */
@Module({
  imports: [MediaModule, NodeRepositoryModule, PublicationModule],
  controllers: [NodeController],
  providers: [NodeService],
  exports: [NodeRepositoryModule, NodeService],
})
export class NodeModule {}
