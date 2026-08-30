import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { NodeController } from "./node.controller";
import { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

/** Nodes: the address protocol, the genealogical reads, and the tags over them. */
@Module({
  imports: [MediaModule],
  controllers: [NodeController],
  providers: [NodeRepository, NodeService],
  exports: [NodeRepository, NodeService],
})
export class NodeModule {}
