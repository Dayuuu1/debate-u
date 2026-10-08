import { createHandler } from "../lib/handler.mjs";
import { getDB } from "../lib/db.mjs";
export default createHandler(getDB);
