import { Module } from "@nestjs/common";
import { GraphRepository } from "./graph.repository";
import { NodeRepository } from "./node.repository";

/**
 * The tables a note is filed by, on their own. What reads notes — publishing a
 * branch, a block's stack — imports this rather than {@link NodeModule}, whose
 * service publishes and so reads back the other way.
 */
@Module({
  providers: [NodeRepository, GraphRepository],
  exports: [NodeRepository, GraphRepository],
})
export class NodeRepositoryModule {}
