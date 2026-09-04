import { Module } from "@nestjs/common";
import { BlockModule } from "../block/block.module";
import { MediaModule } from "../media/media.module";
import { NodeRepositoryModule } from "../node/node-repository.module";
import { SyrModule } from "../syr/syr.module";
import { PublicationController } from "./publication.controller";
import { PublicationRepository } from "./publication.repository";
import { PublicationService } from "./publication.service";
import { PublishedController } from "./published.controller";
import { PublishedService } from "./published.service";

/** Publishing: the snapshot a version freezes, and the routes a peer's instance
 *  reads it back through. */
@Module({
  imports: [NodeRepositoryModule, BlockModule, MediaModule, SyrModule],
  controllers: [PublicationController, PublishedController],
  providers: [PublicationRepository, PublicationService, PublishedService],
  exports: [PublicationRepository, PublicationService],
})
export class PublicationModule {}
