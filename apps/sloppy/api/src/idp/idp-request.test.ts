import type { ArgumentsHost } from "@nestjs/common";
import { IdpError } from "@sloppy/idp";
import { describe, expect, it } from "vitest";
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
