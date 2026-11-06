// Stands in for an installed agent: logs how it was started, and prints a recorded stream.
import fs from "node:fs";
import path from "node:path";

const env = process.env;
if (env.FAKE_AGENT_LOG)
  fs.writeFileSync(
    env.FAKE_AGENT_LOG,
    JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }),
  );
if (env.FAKE_AGENT_TOUCH)
  fs.writeFileSync(path.join(process.cwd(), env.FAKE_AGENT_TOUCH), "touched\n");
if (env.FAKE_AGENT_SLEEP_MS)
  await new Promise((r) => setTimeout(r, Number(env.FAKE_AGENT_SLEEP_MS)));
if (env.FAKE_AGENT_STREAM)
  process.stdout.write(fs.readFileSync(env.FAKE_AGENT_STREAM, "utf8"));
