import { Module } from "@nestjs/common";
import { NodeRepository } from "./node.repository";

/**
 * The `node` table on its own. What reads notes — publishing a branch, a
 * block's stack — imports this rather than {@link NodeModule}, whose service
 * publishes and so reads back the other way.
 */
@Module({
  providers: [NodeRepository],
  exports: [NodeRepository],
})
export class NodeRepositoryModule {}
