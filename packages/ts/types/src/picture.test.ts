import { describe, expect, it } from "vitest";
import {
  boundedTurn,
  knownTransition,
  PICTURE_TRANSITIONS,
  PICTURE_TURN_DEFAULT,
  PICTURE_TURN_MAX,
  PICTURE_TURN_MIN,
  PICTURE_TURNS,
  type PictureSeries,
  pictureTurn,
  QUIETEST_TRANSITION,
} from "./picture.js";

function series(pictures: string[], every = 60): PictureSeries {
  return { pictures, every, transition: "fade" };
}

const HOUR = 3_600_000;

describe("whose turn it is", () => {
  it("is the same answer on two devices reading the same clock", () => {
    const shown = series(["a", "b", "c"]);
    const at = Date.UTC(2026, 7, 29, 14, 37, 12);
    expect(pictureTurn(shown, at)).toBe(pictureTurn({ ...shown }, at));
  });

  it("holds one picture for the whole of its turn and then moves on", () => {
    const shown = series(["a", "b"], 60);
    expect(pictureTurn(shown, 0)).toBe("a");
    expect(pictureTurn(shown, HOUR - 1)).toBe("a");
    expect(pictureTurn(shown, HOUR)).toBe("b");
    expect(pictureTurn(shown, HOUR * 2)).toBe("a");
  });

  it("reaches every picture in the order they were put in", () => {
    const shown = series(["a", "b", "c"], 60);
    expect([0, 1, 2, 3].map((turn) => pictureTurn(shown, turn * HOUR))).toEqual(
      ["a", "b", "c", "a"],
    );
  });

  it("stays on the one picture a still series holds", () => {
    const shown = series(["only"], 5);
    expect([0, HOUR, HOUR * 1000].map((at) => pictureTurn(shown, at))).toEqual([
      "only",
      "only",
      "only",
    ]);
  });

  it("is nobody's on a series with no pictures in it", () => {
    expect(pictureTurn(series([]), Date.now())).toBeUndefined();
  });

  // A clock reading before the epoch is a device somebody set wrong, and it must
  // land on a picture rather than off the end of the series.
  it("names a picture on a clock reading before the epoch", () => {
    const shown = series(["a", "b", "c"], 60);
    for (const at of [-1, -HOUR, -HOUR * 7 - 1]) {
      expect(shown.pictures).toContain(pictureTurn(shown, at));
    }
  });

  it("names a picture whatever cadence a stored shape asks for", () => {
    for (const every of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e15]) {
      expect(pictureTurn(series(["a", "b"], every), HOUR)).toBeDefined();
    }
  });
});

describe("the cadence a stored shape asks for", () => {
  it("is held inside the range a series may take", () => {
    expect(boundedTurn(0)).toBe(PICTURE_TURN_MIN);
    expect(boundedTurn(1e15)).toBe(PICTURE_TURN_MAX);
    expect(boundedTurn(360)).toBe(360);
  });

  it("lands on the default where there is none to read", () => {
    for (const asked of [undefined, null, "hourly", Number.NaN, {}]) {
      expect(boundedTurn(asked)).toBe(PICTURE_TURN_DEFAULT);
    }
  });

  it("is one every surface offers, so two never spell the same cadence apart", () => {
    for (const { value } of PICTURE_TURNS) {
      expect(boundedTurn(value)).toBe(value);
    }
    expect(PICTURE_TURNS.map(({ value }) => value)).toContain(
      PICTURE_TURN_DEFAULT,
    );
  });
});

describe("a transition this build cannot draw", () => {
  it("settles on the quietest rather than on nothing", () => {
    for (const asked of [undefined, "dissolve", "", 3]) {
      expect(knownTransition(asked)).toBe(QUIETEST_TRANSITION);
    }
  });

  it("leaves every one it can draw alone", () => {
    for (const transition of PICTURE_TRANSITIONS) {
      expect(knownTransition(transition)).toBe(transition);
    }
  });
});
