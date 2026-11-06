// Child processes for the backends: line-by-line output with arrival times, and a hard stop.
import { execFileSync, spawn } from "node:child_process";

/**
 * Runs `command` and hands every stdout line to `onLine(line, ms)`, `ms` counted from the spawn.
 * At `timeoutMs` the whole process group is killed and `timedOut` is true.
 * @returns {Promise<{ code: number | null, signal: string | null, timedOut: boolean, stderr: string, missing: boolean }>}
 */
export function runLines({
  command,
  args,
  cwd,
  env = process.env,
  input,
  timeoutMs,
  onLine,
}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let pending = "";
    let timedOut = false;
    let missing = false;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      const ms = performance.now() - started;
      for (const line of lines) if (line.trim()) onLine(line, ms);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-20_000);
    });
    child.on("error", (err) => {
      if (err.code === "ENOENT") missing = true;
      stderr += String(err.message);
    });
    if (input !== undefined) child.stdin.end(input);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (pending.trim()) onLine(pending, performance.now() - started);
      resolve({ code, signal, timedOut, stderr, missing });
    });
  });
}

/** `git status --porcelain` as path → status line; empty where `dir` is not a repository. */
export function porcelain(dir) {
  try {
    const out = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "-z"],
      { cwd: dir, stdio: ["ignore", "pipe", "ignore"] },
    ).toString();
    const map = new Map();
    for (const entry of out.split("\0").filter(Boolean))
      map.set(entry.slice(3), entry.slice(0, 2));
    return map;
  } catch {
    return new Map();
  }
}

/** Paths whose porcelain status differs between two snapshots. */
export function porcelainChanged(before, after) {
  return [...after.entries()]
    .filter(([file, status]) => before.get(file) !== status)
    .map(([file]) => file)
    .sort();
}

export function versionOf(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    })
      .toString()
      .trim()
      .split("\n")[0];
  } catch {
    return undefined;
  }
}
