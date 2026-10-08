import { getDB } from "../lib/db.mjs";
import { readSchema } from "../lib/schema.mjs";
try {
  await getDB().initialize(await readSchema());
  console.log("Base de datos preparada. Los datos existentes se conservan.");
} catch (e) {
  console.error(
    "No se pudo preparar la DB. Revisa DATABASE_URL y la conexión.",
    e.code ?? e.name,
  );
  process.exitCode = 1;
}
