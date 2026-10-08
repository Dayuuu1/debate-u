import { readFile } from "node:fs/promises";
import { getDB } from "../lib/db.mjs";
try {
  await getDB().initialize(
    await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
  );
  console.log("Base de datos preparada. Los datos existentes se conservan.");
} catch (e) {
  console.error(
    "No se pudo preparar la DB. Revisa DATABASE_URL y la conexión.",
    e.code ?? e.name,
  );
  process.exitCode = 1;
}
