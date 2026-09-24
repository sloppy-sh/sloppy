import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { SyrModule } from "../syr/syr.module";
import { FollowingController } from "./following.controller";
import { PeerController } from "./peer.controller";
import { PeerService } from "./peer.service";
import { PullController } from "./pull.controller";
import { PullRepositoryModule } from "./pull-repository.module";
import { PullService } from "./pull.service";
import {
  WhereaboutsController,
  WhereaboutsWellKnownController,
} from "./whereabouts.controller";
import { WhereaboutsRepository } from "./whereabouts.repository";
import { WhereaboutsService } from "./whereabouts.service";

/** Other people's graphs: who the reader follows, where somebody says theirs is
 *  served, what those identities publish, and the regions of them this reader
 *  holds a copy of. */
@Module({
  imports: [SyrModule, PullRepositoryModule, IdentityModule],
  controllers: [
    FollowingController,
    PeerController,
    PullController,
    WhereaboutsController,
    WhereaboutsWellKnownController,
  ],
  providers: [
    PeerService,
    PullService,
    WhereaboutsRepository,
    WhereaboutsService,
  ],
})
export class PeerModule {}
