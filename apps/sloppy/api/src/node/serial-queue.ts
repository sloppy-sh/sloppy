/**
 * Runs the tasks sharing a key one at a time, in arrival order. Tasks under
 * different keys run concurrently.
 *
 * Assigning an address reads the ones already in use and then writes the next,
 * and two creations under one parent that interleave those steps read the same
 * answer. The unique index refuses the second write; this is what turns that
 * refusal into a wait.
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) ?? Promise.resolve();
    const result = tail.then(task, task);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return result;
  }
}
