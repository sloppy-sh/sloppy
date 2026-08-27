import { Module } from "@nestjs/common";
import { SyrModule } from "../syr/syr.module";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";

/** Who somebody is, read from the store that holds them. */
@Module({
  imports: [SyrModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
