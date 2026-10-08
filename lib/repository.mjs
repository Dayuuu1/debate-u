import { defaultState } from "./state.mjs";
export function repository(query) {
  return {
    async initialize(schema) {
      for (const statement of schema
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await query(statement);
      await query(
        "INSERT INTO debate_state(id,data) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING",
        [JSON.stringify(defaultState())],
      );
    },
    async snapshot() {
      const rows = await query(
        "SELECT version,data,(extract(epoch from clock_timestamp())*1000)::double precision AS now FROM debate_state WHERE id=1",
      );
      if (!rows[0]) throw new Error("DB_NOT_INITIALIZED");
      return {
        version: rows[0].version,
        state: rows[0].data,
        serverNow: rows[0].now,
      };
    },
    async compareAndSet(version, data) {
      const rows = await query(
        "UPDATE debate_state SET data=$1::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=1 AND version=$2 RETURNING version,data,(extract(epoch from clock_timestamp())*1000)::double precision AS now",
        [JSON.stringify(data), version],
      );
      return rows[0]
        ? {
            version: rows[0].version,
            state: rows[0].data,
            serverNow: rows[0].now,
          }
        : null;
    },
    async poll(screen) {
      const rows = await query(
        `WITH seen AS (INSERT INTO debate_presence(screen) VALUES($1) ON CONFLICT(screen) DO UPDATE SET seen_at=clock_timestamp() WHERE debate_presence.seen_at < clock_timestamp()-interval '4 seconds')
SELECT version,data,(extract(epoch from clock_timestamp())*1000)::double precision AS now,(SELECT coalesce(json_agg(json_build_object('screen',screen,'at',(extract(epoch from seen_at)*1000)::double precision)),'[]'::json) FROM debate_presence) AS presence FROM debate_state WHERE id=1`,
        [screen],
      );
      if (!rows[0]) throw new Error("DB_NOT_INITIALIZED");
      return {
        version: rows[0].version,
        state: rows[0].data,
        serverNow: rows[0].now,
        presence: rows[0].presence,
      };
    },
    async image(id) {
      return (
        (
          await query("SELECT mime,data FROM debate_images WHERE id=$1", [id])
        )[0] ?? null
      );
    },
    async imageExists(id) {
      return (
        (await query("SELECT 1 FROM debate_images WHERE id=$1", [id])).length > 0
      );
    },
    // Borra imágenes que ningún candidato usa, con margen para cargas aún no aplicadas.
    async cleanupImages() {
      await query(
        `DELETE FROM debate_images i WHERE i.created_at < clock_timestamp()-interval '6 hours' AND NOT EXISTS (SELECT 1 FROM debate_state s, jsonb_array_elements(s.data->'candidates') c WHERE c->'design'->>'photo'=i.id::text OR c->'design'->>'flyer'=i.id::text)`,
      );
    },
    async storeImage(id, mime, data) {
      await query("INSERT INTO debate_images(id,mime,data) VALUES($1,$2,$3)", [
        id,
        mime,
        data,
      ]);
    },
    async allowLogin(key) {
      const rows = await query(
        `INSERT INTO debate_login_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN debate_login_limits.window_start < clock_timestamp()-interval '10 minutes' THEN 1 ELSE debate_login_limits.attempts+1 END,window_start=CASE WHEN debate_login_limits.window_start < clock_timestamp()-interval '10 minutes' THEN clock_timestamp() ELSE debate_login_limits.window_start END RETURNING attempts`,
        [key],
      );
      return rows[0].attempts <= 10;
    },
    async clearLogin(key) {
      await query("DELETE FROM debate_login_limits WHERE key=$1", [key]);
    },
  };
}
