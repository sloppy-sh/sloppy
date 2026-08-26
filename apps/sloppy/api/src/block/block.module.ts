import { Module } from "@nestjs/common";

/**
 * A node's interior: the block stack, its fractional ordering, and ink. Empty
 * until M3 — `app.module.ts` imports it now so that milestone adds controllers
 * and providers here and nowhere else.
 */
@Module({})
export class BlockModule {}
