import { describe, expect, it } from "vitest";
import { boundaryOf, fileIn } from "./archive-body";

const BOUNDARY = "----SloppyBoundary";

/** A form the way a browser sends one: the fields it was given, in order. */
function form(
  parts: readonly { name: string; filename?: string; body: string }[],
): Buffer {
  const written = parts.map(
    (part) =>
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"${
        part.filename === undefined ? "" : `; filename="${part.filename}"`
      }\r\n\r\n${part.body}\r\n`,
  );
  return Buffer.from(`${written.join("")}--${BOUNDARY}--\r\n`, "latin1");
}

describe("where a form's parts are separated", () => {
  it("is read off the request's own type, quoted or bare", () => {
    expect(boundaryOf(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(
      BOUNDARY,
    );
    expect(boundaryOf(`multipart/form-data; boundary="${BOUNDARY}"`)).toBe(
      BOUNDARY,
    );
  });

  it("is absent for a body that is not a form", () => {
    expect(boundaryOf("application/zip")).toBeNull();
    expect(boundaryOf(undefined)).toBeNull();
    expect(boundaryOf("multipart/form-data")).toBeNull();
  });
});

describe("the file on an import request", () => {
  it("is the first part carrying one, past the fields before it", () => {
    const body = form([
      { name: "replace", body: "yes" },
      { name: "archive", filename: "garden.sloppy", body: "PKzip" },
    ]);

    expect(Buffer.from(fileIn(body, BOUNDARY) ?? []).toString("latin1")).toBe(
      "PKzip",
    );
  });

  it("keeps bytes that read as the separator inside the file itself", () => {
    const held = `first\r\n--${BOUNDARY}x\r\nsecond`;
    const body = form([{ name: "archive", filename: "a.sloppy", body: held }]);

    expect(Buffer.from(fileIn(body, BOUNDARY) ?? []).toString("latin1")).toBe(
      held,
    );
  });

  it("is absent from a form that carries no file at all", () => {
    expect(
      fileIn(form([{ name: "replace", body: "yes" }]), BOUNDARY),
    ).toBeNull();
  });
});
