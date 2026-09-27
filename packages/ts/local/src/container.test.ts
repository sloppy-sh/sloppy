import { ProjectPathSchema } from "@sloppy/types";
import {
  encodeText,
  GRAPH_FILE,
  graphFile,
  VAULT_FORMAT,
  type VaultGraph,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import {
  ATTACHED_DIR,
  attachedAt,
  CONTAINER_DIR,
  containerOf,
  projectRootOf,
} from "./container.js";
import { MemoryFiles } from "./files.js";

const OWNER = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const GRAPH = "01J000000000000000000000GG";

function graph(project?: string): VaultGraph {
  return {
    format: VAULT_FORMAT,
    graph: GRAPH,
    name: "The compiler",
    owner: OWNER,
    ...(project === undefined ? {} : { project }),
  };
}

async function project(): Promise<MemoryFiles> {
  const root = new MemoryFiles({ root: "/work/compiler" });
  await root.write("src/parser.ts", encodeText("export const parse = 1;\n"));
  return root;
}

async function withContainer(): Promise<MemoryFiles> {
  const root = await project();
  await root.write(`${CONTAINER_DIR}/${GRAPH_FILE}`, graphFile(graph("..")));
  return root;
}

describe("a project's container", () => {
  it("is the vault inside the folder somebody picked", async () => {
    const root = await withContainer();
    const vault = await containerOf(root);
    expect(vault?.root).toBe("/work/compiler/.sloppy");
    expect(await vault?.read(GRAPH_FILE)).toEqual(graphFile(graph("..")));
  });

  it("is absent from a folder holding no graph", async () => {
    expect(await containerOf(await project())).toBeUndefined();
    const started = await project();
    await started.write(`${CONTAINER_DIR}/notes/README.md`, encodeText("x"));
    expect(await containerOf(started)).toBeUndefined();
  });

  it("reaches the code from the container the ordinary way round", async () => {
    const root = await withContainer();
    const vault = (await containerOf(root)) as MemoryFiles;
    const code = projectRootOf(vault, graph(".."));
    expect(code?.root).toBe("/work/compiler");
    expect(await code?.read("src/parser.ts")).toEqual(
      encodeText("export const parse = 1;\n"),
    );
  });

  it("reaches a folder the project names below the one picked", async () => {
    const root = await withContainer();
    const vault = (await containerOf(root)) as MemoryFiles;
    expect(projectRootOf(vault, graph("../src"))?.root).toBe(
      "/work/compiler/src",
    );
    expect(projectRootOf(vault, graph("."))?.root).toBe(
      "/work/compiler/.sloppy",
    );
  });

  it("names nothing where the graph is nobody's project", async () => {
    const root = await withContainer();
    const vault = (await containerOf(root)) as MemoryFiles;
    expect(projectRootOf(vault, graph())).toBeUndefined();
  });

  it("refuses a path that leaves the folder somebody picked", async () => {
    const root = await withContainer();
    const vault = (await containerOf(root)) as MemoryFiles;
    for (const leaving of [
      "../..",
      "../../other",
      "../src/../..",
      "/etc",
      "C:/work",
      "..\\..",
    ]) {
      expect(projectRootOf(vault, graph(leaving))).toBeUndefined();
    }
  });

  it("names nothing from a vault that is not a container", async () => {
    const notes = new MemoryFiles({ root: "/Users/me/notes" });
    expect(projectRootOf(notes, graph(".."))).toBeUndefined();
    expect(projectRootOf(notes, graph("."))).toBeUndefined();
    const relative = new MemoryFiles({ root: "compiler/.sloppy" });
    expect(projectRootOf(relative, graph(".."))).toBeUndefined();
  });

  it("reads a root spelled with a trailing separator the same way", () => {
    const vault = new MemoryFiles({ root: "/work/compiler/.sloppy/" });
    expect(projectRootOf(vault, graph(".."))?.root).toBe("/work/compiler");
    expect(projectRootOf(vault, graph("../.."))).toBeUndefined();
  });
});

describe("where a file somebody puts in front of an agent goes", () => {
  it("keeps what they called it, extension and all", () => {
    expect(attachedAt("photo.jpg").endsWith("-photo.jpg")).toBe(true);
    expect(attachedAt("写真.png").endsWith("-写真.png")).toBe(true);
    expect(
      attachedAt("Q3 notes (final).pdf").endsWith("-Q3 notes (final).pdf"),
    ).toBe(true);
  });

  it("goes in the container's own folder and names nowhere else", () => {
    for (const named of [
      "photo.jpg",
      "../../../etc/passwd",
      "..\\..\\secrets.env",
      "/etc/passwd",
      "",
      "..",
      ".",
    ]) {
      const at = attachedAt(named);
      expect(at.startsWith(`${ATTACHED_DIR}/`)).toBe(true);
      expect(at.split("/").length).toBe(ATTACHED_DIR.split("/").length + 1);
      expect(ProjectPathSchema.safeParse(at).success, at).toBe(true);
    }
  });

  it("lands two files called the same thing apart", () => {
    expect(attachedAt("photo.jpg")).not.toBe(attachedAt("photo.jpg"));
  });
});
