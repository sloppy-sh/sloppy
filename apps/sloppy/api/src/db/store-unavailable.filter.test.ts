// Booted rather than called, because the part worth holding is the match: the
// filter has to name the errors the driver actually throws, and a client has to
// read words out of what comes back.

import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  type INestApplication,
  Module,
} from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { CallTerminatedError, ConnectionUnavailableError } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StoreUnavailableFilter, TRY_AGAIN } from "./store-unavailable.filter";

@Controller("kept")
class KeptController {
  @Get("unopened")
  unopened(): never {
    throw new ConnectionUnavailableError();
  }

  @Get("cut-off")
  cutOff(): never {
    throw new CallTerminatedError();
  }

  @Get("broken")
  broken(): never {
    throw new Error("something else entirely");
  }

  @Get("refused")
  refused(): never {
    throw new ForbiddenException("Ask the person who keeps this graph.");
  }

  @Get("coded")
  coded(): never {
    throw new HttpException(
      { statusCode: 409, message: "That address is taken.", code: "TAKEN" },
      409,
    );
  }
}

@Module({
  controllers: [KeptController],
  providers: [{ provide: APP_FILTER, useClass: StoreUnavailableFilter }],
})
class KeptModule {}

describe("a request the store was not there to serve", () => {
  let app: INestApplication | undefined;
  let origin = "";

  beforeAll(async () => {
    app = await NestFactory.create(KeptModule, { logger: false });
    await app.listen(0);
    origin = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it("is answered as unavailable, in words meant for a person", async () => {
    const answer = await fetch(`${origin}/kept/unopened`);

    expect(answer.status).toBe(503);
    expect(((await answer.json()) as { message: string }).message).toBe(
      TRY_AGAIN,
    );
  });

  it("is answered the same way when the store went while it was serving", async () => {
    const answer = await fetch(`${origin}/kept/cut-off`);

    expect(answer.status).toBe(503);
    expect(((await answer.json()) as { message: string }).message).toBe(
      TRY_AGAIN,
    );
  });

  it("answers a failure nobody expected in Sloppy's own words", async () => {
    const answer = await fetch(`${origin}/kept/broken`);

    expect(answer.status).toBe(500);
    const said = (await answer.json()) as { message: string };
    expect(said.message).toBe(TRY_AGAIN);
    expect(said.message).not.toMatch(/internal server error/i);
  });

  it("leaves a refusal somebody already wrote words for alone", async () => {
    const answer = await fetch(`${origin}/kept/refused`);

    expect(answer.status).toBe(403);
    expect(((await answer.json()) as { message: string }).message).toBe(
      "Ask the person who keeps this graph.",
    );
  });

  it("keeps the code a caller branches on", async () => {
    const answer = await fetch(`${origin}/kept/coded`);

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({
      message: "That address is taken.",
      code: "TAKEN",
    });
  });
});
