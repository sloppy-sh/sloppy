import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Surreal } from "surrealdb";
import { DbService } from "./db.service";
import { StoreUnavailableFilter } from "./store-unavailable.filter";

// Global: every feature module reads the same connection, and threading it
// through each one's imports would be a list to keep rather than a fact.
@Global()
@Module({
  providers: [
    { provide: Surreal, useFactory: () => new Surreal() },
    DbService,
    { provide: APP_FILTER, useClass: StoreUnavailableFilter },
  ],
  exports: [DbService],
})
export class DbModule {}
