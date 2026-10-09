import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { repository } from "../lib/repository.mjs";
import {
  defaultState,
  normalizeState,
  reduceCommand,
  remaining,
} from "../lib/state.mjs";
import { readSchema } from "../lib/schema.mjs";
import { createHandler } from "../lib/handler.mjs";
import { signToken, verifyToken } from "../lib/auth.mjs";
let pg, db, server, url, cookie;
process.env.DATABASE_URL = "postgresql://test";
process.env.ADMIN_PASSWORD = "test-password-not-for-production";
process.env.SESSION_SECRET = "a-test-secret-longer-than-thirty-two-characters";
delete process.env.VERCEL;
before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  db = repository(async (q, p = []) => (await pg.query(q, p)).rows);
  await db.initialize(await readSchema());
  server = http.createServer(createHandler(() => db));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((r) => server.close(r));
  await pg?.close();
});
async function api(
  op,
  { method = "GET", data, auth = cookie, origin = url, bearer } = {},
) {
  const headers = {
    ...(origin ? { Origin: origin } : {}),
    ...(auth ? { Cookie: auth } : {}),
    ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
    ...(data ? { "Content-Type": "application/json" } : {}),
  };
  const response = await fetch(url + "/api/debate?op=" + op, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  const type = response.headers.get("content-type") || "";
  return {
    response,
    data: type.includes("json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
}
test("Server clock, exclusive turns, pauses, expiration and design persistence", () => {
  let s = reduceCommand(defaultState(), { type: "toggle", id: 1 }, 1000);
  assert.equal(s.candidates[0].deadline, 121000);
  s = reduceCommand(s, { type: "toggle", id: 2 }, 31000);
  assert.equal(s.candidates[0].remaining, 90000);
  assert.equal(s.candidates[0].running, false);
  assert.equal(s.candidates.filter((c) => c.running).length, 1);
  const deadline = s.candidates[1].deadline;
  s = reduceCommand(
    s,
    {
      type: "design",
      id: 2,
      name: "Ana",
      design: { theme: "light", position: 50 },
    },
    32000,
  );
  assert.equal(s.candidates[1].deadline, deadline);
  // Con tiempo excedido (por defecto) el turno sigue corriendo después de 00:00.
  assert.equal(remaining(s.candidates[1], deadline + 1000), -1000);
  const over = reduceCommand(
    s,
    { type: "adjust", id: 2, ms: 15000 },
    deadline + 1000,
  );
  assert.equal(over.candidates[1].running, true);
  assert.equal(remaining(over.candidates[1], deadline + 1000), 14000);
  // Sin tiempo excedido, el turno se detiene en 00:00 como antes.
  const strict = { ...s, overtime: false };
  s = reduceCommand(strict, { type: "adjust", id: 2, ms: 15000 }, deadline + 1000);
  assert.equal(s.candidates[1].remaining, 15000);
  assert.equal(s.candidates[1].running, false);
  assert.equal(s.candidates[1].spoken.libre, deadline - 31000);
  assert.throws(() =>
    reduceCommand(s, { type: "adjust", id: 2, ms: Infinity }, 1),
  );
  assert.throws(() =>
    reduceCommand(
      s,
      {
        type: "design",
        id: 2,
        name: "Ana",
        design: { photo: "javascript:evil" },
      },
      1,
    ),
  );
});
test("Authentication, read-only displays, atomic revisions and image persistence", async () => {
  assert.equal((await api("state")).response.status, 401);
  const malformed = await fetch(url + "/api/debate?op=login", {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: "{no-json",
  });
  assert.equal(malformed.status, 400);
  const login = await api("login", {
    method: "POST",
    data: { password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  assert.match(login.response.headers.get("set-cookie"), /HttpOnly/);
  const first = await api("state");
  assert.equal(first.response.status, 200);
  assert.equal(first.data.state.candidates.length, 3);
  const version = first.data.version;
  const [a, b] = await Promise.all([
    api("command", {
      method: "POST",
      data: { version, command: { type: "toggle", id: 1 } },
    }),
    api("command", {
      method: "POST",
      data: { version, command: { type: "toggle", id: 2 } },
    }),
  ]);
  assert.deepEqual([a.response.status, b.response.status].sort(), [200, 409]);
  const snap = (await api("state")).data;
  assert.equal(snap.version, version + 1);
  const moderator = snap.presence.find((p) => p.screen === 0);
  assert.ok(Number.isFinite(moderator?.at));
  assert.ok(Math.abs(snap.serverNow - moderator.at) < 60000);
  assert.equal(snap.state.candidates.filter((c) => c.running).length, 1);
  const links = await api("links", { method: "POST", data: {} });
  const token = links.data.links[0].token;
  assert.equal(
    (await api("state", { auth: null, bearer: token })).data.role,
    "display",
  );
  assert.equal(
    (
      await api("command", {
        method: "POST",
        auth: null,
        bearer: token,
        data: { version: snap.version, command: { type: "resetAll" } },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await api("command", {
        method: "POST",
        origin: "https://attacker.example",
        data: { version: snap.version, command: { type: "resetAll" } },
      })
    ).response.status,
    403,
  );
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const uploaded = await api("upload", {
    method: "POST",
    data: { mime: "image/png", data: pixel },
  });
  assert.equal(uploaded.response.status, 200);
  const missing = await api("command", {
    method: "POST",
    data: {
      version: snap.version,
      command: {
        type: "design",
        id: 1,
        name: "Sin imagen",
        design: { photo: "00000000-0000-4000-8000-000000000000" },
      },
    },
  });
  assert.equal(missing.response.status, 400);
  const saved = await api("command", {
    method: "POST",
    data: {
      version: snap.version,
      command: {
        type: "design",
        id: 1,
        name: "Candidato con foto",
        design: { photo: uploaded.data.id, theme: "light" },
      },
    },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.state.candidates[0].design.photo, uploaded.data.id);
  const image = await api("image&id=" + uploaded.data.id, {
    auth: null,
    bearer: token,
  });
  assert.equal(image.response.status, 200);
  assert.deepEqual(image.data, Buffer.from(pixel, "base64"));
  assert.equal(
    (
      await api("upload", {
        method: "POST",
        data: {
          mime: "image/png",
          data: Buffer.from("<svg></svg>").toString("base64"),
        },
      })
    ).response.status,
    400,
  );
  await db.initialize(await readSchema());
  assert.equal(
    (await db.snapshot()).state.candidates[0].name,
    "Candidato con foto",
  );
  assert.equal(
    (await api("logout", { method: "POST", data: {} })).response.status,
    200,
  );
});
test("Signed tokens reject altered signatures and expired access", () => {
  const token = signToken({ role: "display", screen: 3 }, 1000, 1000);
  assert.equal(verifyToken(token, 1500).screen, 3);
  assert.equal(verifyToken(token, 2000), null);
  assert.equal(verifyToken(token + "x", 1500), null);
  assert.equal(
    verifyToken(signToken({ role: "display", screen: 9 }, 1000, 1000), 1500),
    null,
  );
});
test("Repeated failed login is limited by the database", async () => {
  await db.clearLogin("limit-test");
  for (let i = 0; i < 10; i++)
    assert.equal(await db.allowLogin("limit-test"), true);
  assert.equal(await db.allowLogin("limit-test"), false);
});
test("Rounds, variable candidates and the speaking-time report", () => {
  let s = reduceCommand(defaultState(), { type: "round", id: "r2" }, 0);
  assert.equal(s.round, "r2");
  assert.ok(s.candidates.every((c) => c.remaining === 120000));
  s = reduceCommand(s, { type: "toggle", id: 1 }, 1000);
  s = reduceCommand(s, { type: "toggle", id: 2 }, 31000);
  s = reduceCommand(s, { type: "round", id: "r3" }, 41000);
  assert.equal(s.candidates[0].spoken.r2, 30000);
  assert.equal(s.candidates[1].spoken.r2, 10000);
  assert.ok(s.candidates.every((c) => !c.running && c.remaining === 60000));
  s = reduceCommand(
    s,
    {
      type: "settings",
      event: "Debate de prueba",
      warning: 20,
      overtime: true,
      candidates: [
        { id: 2, name: "Beatriz", duration: 90000 },
        { name: "Nuevo", duration: 60000 },
        { id: 1, name: "Ana", duration: 90000 },
        { name: "Cuarto", duration: 60000 },
      ],
      rounds: [
        { id: "r3", name: "Cierre", duration: 45000 },
        { name: "Preguntas del público", duration: 90000 },
      ],
    },
    50000,
  );
  assert.deepEqual(
    s.candidates.map((c) => [c.id, c.name]),
    [
      [1, "Beatriz"],
      [2, "Nuevo"],
      [3, "Ana"],
      [4, "Cuarto"],
    ],
  );
  assert.equal(s.candidates[0].spoken.r2, 10000);
  assert.equal(s.candidates[2].spoken.r2, 30000);
  assert.deepEqual(
    s.rounds.map((r) => r.id),
    ["r3", "r2"],
  );
  assert.equal(s.round, "r3");
  assert.throws(() => reduceCommand(s, { type: "toggle", id: 5 }, 0));
  assert.throws(() =>
    reduceCommand(s, { type: "round", id: "no-existe" }, 0),
  );
  s = reduceCommand(s, { type: "clearReport" }, 60000);
  assert.ok(s.candidates.every((c) => Object.keys(c.spoken).length === 0));
  const legacy = normalizeState({
    event: "Antiguo",
    warning: 30,
    sound: false,
    candidates: [
      { id: 1, name: "A", duration: 1000, remaining: 1000, running: false, deadline: null },
    ],
  });
  assert.equal(legacy.overtime, true);
  assert.equal(legacy.rounds.length, 3);
  assert.deepEqual(legacy.candidates[0].spoken, {});
});
test("Overview links are read-only and extra totems report presence", async () => {
  const overview = signToken({ role: "overview" }, 60000);
  const seen = await api("state", { auth: null, bearer: overview });
  assert.equal(seen.response.status, 200);
  assert.equal(seen.data.role, "overview");
  assert.equal(
    (
      await api("command", {
        method: "POST",
        auth: null,
        bearer: overview,
        data: { version: seen.data.version, command: { type: "pauseAll" } },
      })
    ).response.status,
    403,
  );
  const fifth = signToken({ role: "display", screen: 5 }, 60000);
  await api("state", { auth: null, bearer: fifth });
  const again = await api("state", { auth: null, bearer: fifth });
  assert.ok(again.data.presence.some((p) => p.screen === 5));
  assert.ok(again.data.presence.some((p) => p.screen === 99));
  assert.equal(verifyToken(signToken({ role: "display", screen: 9 }, 1000)), null);
});
test("Single-screen mode: present a candidate, start it and keep it on stage", () => {
  let s = reduceCommand(defaultState(), { type: "toggle", id: 1 }, 1000);
  assert.equal(s.stage, 1);
  s = reduceCommand(s, { type: "present", id: 3 }, 11000);
  assert.equal(s.stage, 3);
  assert.equal(s.candidates[0].running, false);
  assert.equal(s.candidates[0].remaining, 110000);
  assert.equal(s.candidates[2].running, false);
  s = reduceCommand(s, { type: "toggle", id: 3 }, 12000);
  assert.equal(s.candidates[2].running, true);
  assert.equal(s.stage, 3);
  s = reduceCommand(
    s,
    {
      type: "settings",
      event: "Debate",
      warning: 30,
      overtime: true,
      mode: "single",
      candidates: [
        { id: 3, name: "Tercero", duration: 60000 },
        { id: 1, name: "Primero", duration: 60000 },
      ],
    },
    20000,
  );
  assert.equal(s.mode, "single");
  assert.equal(s.stage, 1);
  assert.equal(s.candidates[0].name, "Tercero");
  assert.throws(() =>
    reduceCommand(
      s,
      {
        type: "settings",
        event: "Debate",
        warning: 30,
        overtime: true,
        mode: "otro",
        candidates: [{ name: "A", duration: 60000 }],
      },
      0,
    ),
  );
  assert.throws(() => reduceCommand(s, { type: "present", id: 9 }, 0));
  assert.equal(reduceCommand(s, { type: "present", id: null }, 0).stage, null);
  assert.equal(normalizeState({ mode: "x", stage: 7 }).mode, "totems");
  assert.equal(normalizeState({ mode: "single", stage: 7 }).stage, null);
});
test("Public and speaker screens report their own presence", async () => {
  const token = signToken({ role: "overview" }, 60000);
  for (const view of ["publico", "orador", "__proto__"])
    assert.equal(
      (await api("state&view=" + view, { auth: null, bearer: token })).response
        .status,
      200,
    );
  const seen = (await api("state&view=publico", { auth: null, bearer: token }))
    .data.presence;
  assert.ok(seen.some((p) => p.screen === 98));
  assert.ok(seen.some((p) => p.screen === 97));
});
