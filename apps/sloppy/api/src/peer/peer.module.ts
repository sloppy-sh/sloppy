import { Module } from "@nestjs/common";
import { SyrModule } from "../syr/syr.module";
import { FollowingController } from "./following.controller";
import { PeerController } from "./peer.controller";
import { PeerService } from "./peer.service";
import { PullController } from "./pull.controller";
import { PullRepositoryModule } from "./pull-repository.module";
import { PullService } from "./pull.service";

/** Other people's graphs: who the reader follows, what those identities
 *  publish, and the regions of them this reader holds a copy of. */
@Module({
  imports: [SyrModule, PullRepositoryModule],
  controllers: [FollowingController, PeerController, PullController],
  providers: [PeerService, PullService],
})
export class PeerModule {}
