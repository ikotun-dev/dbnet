import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repository, "out");
const destination = path.join(repository, "internal", "webassets", "out");

try {
  const entry = await stat(path.join(source, "index.html"));
  if (!entry.isFile()) throw new Error("out/index.html is not a file");
} catch {
  throw new Error("Frontend export not found. Run `npm run build` first.");
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await writeFile(path.join(destination, ".gitkeep"), "");
