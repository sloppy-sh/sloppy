import { Module } from "@nestjs/common";
import { BlockModule } from "../block/block.module";
import { AppConfigModule } from "../config/config.module";
import { DbModule } from "../db/db.module";
import { NodeModule } from "../node/node.module";

/** What the seed command needs and nothing else: the store and the two domain
 *  modules. Identity is not among them — the seed is handed a DID. */
@Module({ imports: [AppConfigModule, DbModule, NodeModule, BlockModule] })
export class SeedModule {}
