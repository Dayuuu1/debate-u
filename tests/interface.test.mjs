import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { defaultState, reduceCommand } from "../lib/state.mjs";
const flush = () => new Promise((r) => setImmediate(r));
async function page(search = "", initial = defaultState()) {
  const { window } = parseHTML(
    await readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  );
  for (const d of window.document.querySelectorAll("dialog")) {
    d.showModal = () => d.setAttribute("open", "");
    d.close = () => {
      d.removeAttribute("open");
      d.dispatchEvent(new window.Event("close"));
    };
  }
  // LinkeDOM has a read-only select value unlike browsers. Supply its browser equivalent.
  for (const select of window.document.querySelectorAll("select"))
    Object.defineProperty(select, "value", {
      get() {
        return (
          this.querySelector("option[selected]")?.value ||
          this.querySelector("option")?.value
        );
      },
      set(v) {
        for (const o of this.querySelectorAll("option")) {
          if (o.value === String(v)) o.setAttribute("selected", "");
          else o.removeAttribute("selected");
        }
      },
    });
  const storage = new Map();
  let state = initial,
    stateFn = () => {},
    connectionFn = () => {};
  const cloud = {
    role: search ? "display" : "admin",
    connected: true,
    busy: false,
    presence: [],
    links: [1, 2, 3].map((screen) => ({
      screen,
      url: "https://test.example/?pantalla=" + screen + "#token=test",
    })),
    now: () => Date.now(),
    get state() {
      return state;
    },
    async init() {
      window.document.getElementById("cloud-gate").hidden = true;
    },
    startPolling() {},
    setCallbacks(s, c) {
      stateFn = s;
      connectionFn = c;
    },
    async command(c) {
      state = reduceCommand(state, c, Date.now());
      stateFn(state);
      connectionFn();
    },
    link(id) {
      return this.links.find((x) => x.screen === id).url;
    },
    getLinks: async () => {},
    logout: async () => {},
    refresh: async () => {},
    image: async () => null,
  };
  window.Cloud = cloud;
  const context = vm.createContext({
    window,
    document: window.document,
    Cloud: cloud,
    location: new URL("https://test.example/" + search),
    URL,
    URLSearchParams,
    Date,
    Map,
    Set,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Promise,
    console,
    globalThis: { crypto: { randomUUID: () => "test" } },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
    navigator: { clipboard: { writeText: async () => {} } },
    setInterval: () => 1,
    setTimeout: () => 1,
    clearTimeout: () => {},
    FormData: globalThis.FormData,
  });
  for (const file of ["timer-core.js", "totem.js"]) {
    vm.runInContext(
      await readFile(new URL("../public/" + file, import.meta.url), "utf8"),
      context,
    );
    context.TimerCore = window.TimerCore;
    context.Totem = window.Totem;
  }
  vm.runInContext(
    await readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    context,
  );
  await flush();
  return { context, window, cloud };
}
test("Moderator UI starts, controls a turn and applies a design without resetting time", async () => {
  const { window, context, cloud } = await page();
  const doc = window.document;
  assert.equal(
    doc.getElementById("cloud-gate").hidden,
    true,
    doc.getElementById("login-error").textContent,
  );
  assert.equal(doc.querySelectorAll(".candidate-card").length, 3);
  doc.getElementById("toggle-1").onclick();
  await flush();
  assert.equal(cloud.state.candidates[0].running, true);
  const deadline = cloud.state.candidates[0].deadline;
  vm.runInContext("openDesign(1)", context);
  doc.querySelector('[data-theme="light"]').onclick();
  doc.querySelector('[data-layout="minimal"]').onclick();
  const name = doc.getElementById("design-name");
  name.value = "Nombre de prueba";
  name.dispatchEvent(new window.Event("input"));
  await doc.getElementById("design-form").onsubmit({ preventDefault() {} });
  assert.equal(cloud.state.candidates[0].name, "Nombre de prueba");
  assert.equal(cloud.state.candidates[0].design.theme, "light");
  assert.equal(cloud.state.candidates[0].deadline, deadline);
  await doc.getElementById("share-links").onclick();
  assert.equal(doc.querySelectorAll("[data-link-screen]").length, 3);
});
test("Display UI renders the requested candidate and hides all moderator controls", async () => {
  const { window, cloud } = await page("?pantalla=2");
  const doc = window.document;
  assert.equal(
    doc.getElementById("cloud-gate").hidden,
    true,
    doc.getElementById("login-error").textContent,
  );
  assert.equal(doc.querySelector(".totem-name").textContent, "Candidato 2");
  assert.equal(doc.querySelector(".totem-time").textContent, "02:00");
  assert.equal(doc.querySelectorAll(".candidate-card").length, 0);
  assert.match(doc.getElementById("connection").textContent, /Sincronizado/);
});
test("Moderator adds a candidate, picks a round and reads the time report", async () => {
  const { window, cloud } = await page();
  const doc = window.document;
  doc.getElementById("settings-btn").onclick();
  assert.ok(doc.getElementById("settings").hasAttribute("open"));
  doc.getElementById("add-candidate").onclick();
  const rows = doc.querySelectorAll("#settings-candidates .edit-row");
  assert.equal(rows.length, 4);
  const name = rows[3].querySelector(".edit-name");
  name.value = "Diana";
  name.dispatchEvent(new window.Event("input", { bubbles: true }));
  await doc.getElementById("settings-form").onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(cloud.state.candidates.length, 4);
  assert.equal(cloud.state.candidates[3].name, "Diana");
  assert.equal(doc.querySelectorAll(".candidate-card").length, 4);
  assert.match(doc.getElementById("hero-count").textContent, /04 CANDIDATOS/);
  doc.querySelector('[data-round="r2"]').onclick();
  await flush();
  assert.equal(cloud.state.round, "r2");
  assert.ok(
    doc.querySelector('[data-round="r2"]').classList.contains("selected"),
  );
  doc.getElementById("toggle-4").onclick();
  await flush();
  assert.equal(cloud.state.candidates[3].running, true);
  doc.getElementById("open-report").onclick();
  assert.equal(doc.querySelectorAll("#report-table tbody tr").length, 4);
  assert.match(doc.getElementById("report-table").textContent, /Diana/);
  assert.match(doc.getElementById("live-status").textContent, /Diana · Réplica/);
});
test("Overview screen lists every candidate and the active round", async () => {
  const { window } = await page("?vista=general");
  const doc = window.document;
  assert.equal(doc.querySelectorAll(".ov-tile").length, 3);
  assert.equal(doc.getElementById("ov-round").textContent, "Tiempo libre");
  assert.equal(doc.getElementById("ov-tile-time-2").textContent, "02:00");
  assert.equal(doc.querySelectorAll(".candidate-card").length, 0);
});
const singleState = () => ({ ...defaultState(), mode: "single" });
test("Single-screen panel presents a candidate and starts the timer from the stage bar", async () => {
  const { window, cloud } = await page("", singleState());
  const doc = window.document;
  assert.equal(doc.getElementById("stage-bar").hidden, false);
  assert.equal(doc.querySelectorAll("[data-present]").length, 3);
  assert.equal(doc.querySelectorAll("[data-open]").length, 0);
  assert.equal(doc.getElementById("stage-name").textContent, "Nadie en pantalla");
  doc.querySelector('[data-present-chip="2"]').onclick();
  await flush();
  assert.equal(cloud.state.stage, 2);
  assert.equal(doc.getElementById("stage-name").textContent, "Candidato 2");
  assert.ok(doc.getElementById("card-2").classList.contains("on-stage"));
  assert.match(doc.getElementById("present-label-2").textContent, /En pantalla/);
  doc.getElementById("stage-play").onclick();
  await flush();
  assert.equal(cloud.state.candidates[1].running, true);
  assert.match(doc.getElementById("stage-play").textContent, /Pausar/);
  doc.getElementById("stage-next").onclick();
  await flush();
  assert.equal(cloud.state.stage, 3);
  assert.equal(cloud.state.candidates[2].running, true);
  assert.equal(cloud.state.candidates[1].running, false);
  assert.equal(doc.getElementById("share-links").textContent, "Enlaces de pantallas");
});
test("Public and speaker screens show the presented candidate", async () => {
  const staged = { ...singleState(), stage: 2 };
  const pub = (await page("?vista=publico", staged)).window.document;
  assert.equal(pub.getElementById("pub-name").textContent, "Candidato 2");
  assert.equal(pub.getElementById("pub-time").textContent, "02:00");
  assert.equal(pub.getElementById("pub-status").textContent, "LISTO PARA INICIAR");
  assert.equal(pub.getElementById("pub-empty").hidden, true);
  const spk = (await page("?vista=orador", staged)).window.document;
  assert.equal(spk.getElementById("spk-name").textContent, "Candidato 2");
  assert.equal(spk.getElementById("spk-time").textContent, "02:00");
  const empty = (await page("?vista=publico", singleState())).window.document;
  assert.equal(empty.getElementById("pub-body").hidden, true);
  assert.equal(empty.getElementById("pub-empty").hidden, false);
  assert.equal(empty.querySelectorAll(".candidate-card").length, 0);
});
