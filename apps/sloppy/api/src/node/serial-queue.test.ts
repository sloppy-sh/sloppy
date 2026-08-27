import { describe, expect, it } from "vitest";
import { SerialQueue } from "./serial-queue";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the serial queue", () => {
  it("never runs two tasks under one key at the same time", async () => {
    const queue = new SerialQueue();
    let running = 0;
    let mostAtOnce = 0;
    const done: number[] = [];

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        queue.run("one", async () => {
          running++;
          mostAtOnce = Math.max(mostAtOnce, running);
          await tick();
          running--;
          done.push(i);
        }),
      ),
    );

    expect(mostAtOnce).toBe(1);
    expect(done).toEqual([...Array(20).keys()]);
  });

  it("lets different keys run alongside each other", async () => {
    const queue = new SerialQueue();
    let running = 0;
    let mostAtOnce = 0;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        queue.run(`key ${i}`, async () => {
          running++;
          mostAtOnce = Math.max(mostAtOnce, running);
          await tick();
          running--;
        }),
      ),
    );
    expect(mostAtOnce).toBe(8);
  });

  it("keeps going after a task throws", async () => {
    const queue = new SerialQueue();
    const failed = queue.run("one", async () => {
      throw new Error("no");
    });
    const after = queue.run("one", async () => "still here");
    await expect(failed).rejects.toThrow("no");
    await expect(after).resolves.toBe("still here");
  });

  it("forgets a key once its last task has settled", async () => {
    const queue = new SerialQueue();
    await queue.run("one", async () => undefined);
    await tick();
    expect(
      (queue as unknown as { tails: Map<string, unknown> }).tails.size,
    ).toBe(0);
  });
});
