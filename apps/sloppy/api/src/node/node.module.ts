import { Module } from "@nestjs/common";
import { LabelController } from "../label/label.controller";
import { LabelRepository } from "../label/label.repository";
import { LabelService } from "../label/label.service";
import { NodeController } from "./node.controller";
import { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

/**
 * Nodes: the address protocol, the genealogical reads, and the label facets
 * over them.
 *
 * The facets are registered here rather than from a module of their own because
 * they are read and written together: a node's labels are checked against the
 * dimensions, and renaming a dimension carries the key across every node.
 */
@Module({
  controllers: [NodeController, LabelController],
  providers: [NodeRepository, NodeService, LabelRepository, LabelService],
  exports: [NodeRepository, NodeService, LabelService],
})
export class NodeModule {}
