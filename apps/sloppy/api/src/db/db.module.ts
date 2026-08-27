import { Global, Module } from "@nestjs/common";
import { Surreal } from "surrealdb";
import { DbService } from "./db.service";

// Global: every feature module reads the same connection, and threading it
// through each one's imports would be a list to keep rather than a fact.
@Global()
@Module({
  providers: [{ provide: Surreal, useFactory: () => new Surreal() }, DbService],
  exports: [DbService],
})
export class DbModule {}
