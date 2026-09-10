// Fills one identity's graph with something worth looking at: thousands of
// notes, deep chains and wide sibling runs, tags that cut across the genealogy,
// and interiors divided into sections with real prose in them.
//
//   pnpm --filter @sloppy/api seed [--did <did>] [--fresh] [--nodes <n>]
//
// Every note is written through the same services the API serves, so the
// addresses in the seeded graph are assigned exactly as a person's would be.

import "../config/env";

import { NestFactory } from "@nestjs/core";
import { userPurgeStatements } from "@sloppy/data";
import { DidSyrSchema, type OwnedRef } from "@sloppy/types";
import { BlockService } from "../block/block.service";
import { DbService } from "../db/db.service";
import { GraphService } from "../node/graph.service";
import { NodeRepository } from "../node/node.repository";
import { NodeService } from "../node/node.service";
import { type PlannedNode, planGraph } from "./plan";
import { SeedModule } from "./seed.module";

const DEFAULT_NODE_TARGET = 2400;

interface Options {
  did?: string;
  fresh: boolean;
  nodes: number;
}

function readOptions(argv: readonly string[]): Options {
  const options: Options = { fresh: false, nodes: DEFAULT_NODE_TARGET };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fresh") options.fresh = true;
    else if (argv[i] === "--did") options.did = argv[++i];
    else if (argv[i] === "--nodes") options.nodes = Number(argv[++i]);
  }
  if (!Number.isSafeInteger(options.nodes) || options.nodes < 1) {
    throw new Error("--nodes takes a whole number of notes");
  }
  return options;
}

/** Accounts this instance serves identity for, newest last. An instance that
 *  delegates identity elsewhere never grows the table, so it has none. */
async function localAccounts(
  db: DbService,
): Promise<{ did: string; username: string }[]> {
  const [defined] =
    await db.handle.query<[{ tables: Record<string, string> }]>("INFO FOR DB");
  if (!("idp_account" in defined.tables)) return [];
  // 3.1.3 refuses an ORDER BY over a field the projection leaves out.
  const [rows] = await db.handle.query<
    [{ did: string; username: string; created_at: string }[]]
  >("SELECT did, username, created_at FROM idp_account ORDER BY created_at");
  return rows.map(({ did, username }) => ({ did, username }));
}

async function resolveDid(db: DbService, options: Options): Promise<string> {
  const asked = options.did ?? process.env.SLOPPY_SEED_DID;
  if (asked) return DidSyrSchema.parse(asked);

  const accounts = await localAccounts(db);
  if (accounts.length === 1) {
    console.log(`Seeding the graph of ${accounts[0].username}.`);
    return DidSyrSchema.parse(accounts[0].did);
  }
  if (accounts.length === 0) {
    throw new Error(
      "Nobody to seed. Sign in once, or pass --did <did:syr:…> for the identity to fill.",
    );
  }
  throw new Error(
    `Several identities live here (${accounts
      .map((account) => account.username)
      .join(", ")}). Pass --did <did:syr:…> to say which one to fill.`,
  );
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ["warn", "error"],
  });

  try {
    const db = app.get(DbService);
    await db.whenOpen();
    const did = await resolveDid(db, options);

    const nodes = app.get(NodeService);
    const blocks = app.get(BlockService);
    const repository = app.get(NodeRepository);
    const home = await app.get(GraphService).home(did);

    const standing = await repository.roots(did, home);
    if (standing.length > 0 && !options.fresh) {
      throw new Error(
        `This identity already has ${standing.length} root notes. Re-run with --fresh to erase its graph and build a new one.`,
      );
    }
    if (options.fresh) {
      await db.handle.query(userPurgeStatements().join("\n"), { did });
      console.log("Erased the existing graph for this identity.");
    }

    const plan = planGraph(options.nodes);
    console.log(
      `Planning ${plan.nodes} notes, ${plan.blocks} blocks, ${plan.tags.length} tags.`,
    );

    const started = Date.now();
    let written = 0;
    let blocksWritten = 0;

    const write = async (
      planned: PlannedNode,
      parent: OwnedRef | undefined,
    ): Promise<void> => {
      const node = await nodes.create(did, {
        ...(parent
          ? { from: { relation: "under" as const, note: parent } }
          : {}),
        title: planned.title,
        tags: planned.tags,
      });
      written++;
      if (written % 250 === 0) {
        console.log(`  ${written} / ${plan.nodes} notes`);
      }
      let after: string | undefined;
      for (const block of planned.blocks) {
        const created = await blocks.create(did, {
          node: node.ref,
          ...(after ? { after } : {}),
          content: block,
        });
        after = created.ref;
        blocksWritten++;
      }
      for (const child of planned.children) await write(child, node.ref);
    };

    for (const root of plan.roots) await write(root, undefined);

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const roots = await repository.roots(did, home);
    console.log(
      [
        "",
        `Wrote ${written} notes and ${blocksWritten} blocks in ${seconds}s.`,
        `  roots            ${roots.map((root) => root.address).join(", ")}`,
        `  deepest branch   ${plan.deepest} levels`,
        `  widest run       ${plan.widestRun} siblings`,
        `  tags             ${plan.tags.join(", ")}`,
        "",
      ].join("\n"),
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
