import { Module } from "@nestjs/common";
import { BlockModule } from "../block/block.module";
import { NodeRepositoryModule } from "../node/node-repository.module";
import { AmendmentController } from "./amendment.controller";
import { AmendmentRepository } from "./amendment.repository";
import { AmendmentService } from "./amendment.service";

/** Changes offered on a note somebody else gates: what a graph arriving as an
 *  archive brings with it, and how its owner settles one. */
@Module({
  imports: [BlockModule, NodeRepositoryModule],
  controllers: [AmendmentController],
  providers: [AmendmentRepository, AmendmentService],
  exports: [AmendmentRepository],
})
export class AmendmentModule {}
