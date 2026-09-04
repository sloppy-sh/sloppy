import { Module } from "@nestjs/common";
import { NodeRepositoryModule } from "../node/node-repository.module";
import { BlockController, NodeBlocksController } from "./block.controller";
import { BlockRepository } from "./block.repository";
import { BlockService } from "./block.service";

/** A node's interior: the block stack, its fractional ordering, and ink. */
@Module({
  imports: [NodeRepositoryModule],
  controllers: [BlockController, NodeBlocksController],
  providers: [BlockRepository, BlockService],
  exports: [BlockService, BlockRepository],
})
export class BlockModule {}
