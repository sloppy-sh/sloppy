import { Module } from "@nestjs/common";
import { NodeRepositoryModule } from "../node/node-repository.module";
import { BlockController, NodeBlocksController } from "./block.controller";
import { BlockRepository } from "./block.repository";
import { BlockService } from "./block.service";
import { ReferenceBackfill } from "./reference-backfill";

/** A node's interior: the block stack, its fractional ordering, ink, and the
 *  notes the writing in it names. */
@Module({
  imports: [NodeRepositoryModule],
  controllers: [BlockController, NodeBlocksController],
  providers: [BlockRepository, BlockService, ReferenceBackfill],
  exports: [BlockService, BlockRepository],
})
export class BlockModule {}
