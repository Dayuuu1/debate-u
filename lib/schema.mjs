import { readdir, readFile } from "node:fs/promises";
const dir = new URL("../db/", import.meta.url);
// Une los archivos db/*.sql en orden; cada uno se puede ejecutar varias veces.
export async function readSchema() {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const parts = await Promise.all(
    files.map((f) => readFile(new URL(f, dir), "utf8")),
  );
  return parts.map((sql) => sql.replace(/^--.*$/gm, "")).join(";\n");
}
