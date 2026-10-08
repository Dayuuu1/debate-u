import { neon } from "@neondatabase/serverless";
import { repository } from "./repository.mjs";
let db;
export function getDB() {
  if (!process.env.DATABASE_URL) throw new Error("CONFIG_MISSING");
  if (!db) {
    const sql = neon(process.env.DATABASE_URL);
    db = repository((query, values = []) => sql.query(query, values));
  }
  return db;
}
