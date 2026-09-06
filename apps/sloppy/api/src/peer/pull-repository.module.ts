import { Module } from "@nestjs/common";
import { PullRepository } from "./pull.repository";

/** The held-region tables on their own, so a module that reads what the reader
 *  holds does not take the routes that write it. */
@Module({
  providers: [PullRepository],
  exports: [PullRepository],
})
export class PullRepositoryModule {}
