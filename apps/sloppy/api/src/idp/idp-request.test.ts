import {
  type ArgumentsHost,
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
  Module,
  UseFilters,
} from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { IdpError } from "@sloppy/idp";
import { ConnectionUnavailableError } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SloppyWordsFilter, TRY_AGAIN } from "../db/sloppy-words.filter";
import { IdpExceptionFilter, SyrExceptionFilter } from "./idp-request";

const FAILURE = new IdpError(
  400,
  "invalid_code",
  "That sign-in link has already been used or has expired. Start again.",
);

function answer(
  filter: IdpExceptionFilter | SyrExceptionFilter,
  thrown: unknown,
): { status: number; body: unknown } {
  const answered = { status: 0, body: undefined as unknown };
  const response = {
    status(code: number) {
      answered.status = code;
      return this;
    },
    json(body: unknown) {
      answered.body = body;
    },
  };
  filter.catch(thrown, {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost);
  return answered;
}

describe("the two dialects one failure is answered in", () => {
  it("gives the instance's own callers a message and a code", () => {
    expect(answer(new IdpExceptionFilter(), FAILURE)).toEqual({
      status: 400,
      body: { message: FAILURE.message, code: "invalid_code" },
    });
  });

  it("gives a syr consumer the same code under syr's names", () => {
    expect(answer(new SyrExceptionFilter(), FAILURE)).toEqual({
      status: 400,
      body: { error: "invalid_code", error_description: FAILURE.message },
    });
  });

  it("leaves anything that is not the provider's failure alone", () => {
    const other = new Error("something else");
    for (const filter of [new IdpExceptionFilter(), new SyrExceptionFilter()]) {
      expect(() => answer(filter, other)).toThrow(other);
    }
  });
});

// Booted, because what these routes answer for a failure the provider does not
// own is not decided here: Nest calls one filter per route, and the throw above
// travels the framework's own way to the global one. Calling the filter can
// only show the throw; a route shows what a person is told.

@Controller("idp")
@UseFilters(IdpExceptionFilter)
class OwnDialectController {
  @Get("refused")
  refused(): never {
    throw FAILURE;
  }

  @Get("unopened")
  unopened(): never {
    throw new ConnectionUnavailableError();
  }

  @Get("broken")
  broken(): never {
    throw new Error("something else entirely");
  }

  @Get("closed")
  closed(): never {
    throw new ForbiddenException("Ask the person who keeps this graph.");
  }
}

@Controller("syr")
@UseFilters(SyrExceptionFilter)
class SyrDialectController {
  @Get("refused")
  refused(): never {
    throw FAILURE;
  }

  @Get("unopened")
  unopened(): never {
    throw new ConnectionUnavailableError();
  }

  @Get("broken")
  broken(): never {
    throw new Error("something else entirely");
  }

  @Get("closed")
  closed(): never {
    throw new ForbiddenException("Ask the person who keeps this graph.");
  }
}

@Module({
  controllers: [OwnDialectController, SyrDialectController],
  providers: [{ provide: APP_FILTER, useClass: SloppyWordsFilter }],
})
class ProviderModule {}

describe("a failure on its way out of an identity-provider route", () => {
  let app: INestApplication | undefined;
  let origin = "";

  beforeAll(async () => {
    app = await NestFactory.create(ProviderModule, { logger: false });
    await app.listen(0);
    origin = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  for (const route of ["idp", "syr"] as const) {
    it(`is answered as unavailable, in words meant for a person, on /${route}`, async () => {
      const answered = await fetch(`${origin}/${route}/unopened`);

      expect(answered.status).toBe(503);
      expect(((await answered.json()) as { message: string }).message).toBe(
        TRY_AGAIN,
      );
    });

    it(`is answered in Sloppy's own words when nobody expected it, on /${route}`, async () => {
      const answered = await fetch(`${origin}/${route}/broken`);

      expect(answered.status).toBe(500);
      const said = (await answered.json()) as { message: string };
      expect(said.message).toBe(TRY_AGAIN);
      expect(said.message).not.toMatch(/internal server error/i);
    });

    it(`keeps a refusal somebody already wrote words for, on /${route}`, async () => {
      const answered = await fetch(`${origin}/${route}/closed`);

      expect(answered.status).toBe(403);
      expect(((await answered.json()) as { message: string }).message).toBe(
        "Ask the person who keeps this graph.",
      );
    });
  }

  it("still answers the provider's own failure in the caller's dialect", async () => {
    const own = await fetch(`${origin}/idp/refused`);
    const syr = await fetch(`${origin}/syr/refused`);

    expect(own.status).toBe(400);
    expect(await own.json()).toEqual({
      message: FAILURE.message,
      code: "invalid_code",
    });
    expect(syr.status).toBe(400);
    expect(await syr.json()).toEqual({
      error: "invalid_code",
      error_description: FAILURE.message,
    });
  });
});
