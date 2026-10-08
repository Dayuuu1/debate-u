import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { defaultState, reduceCommand } from "../lib/state.mjs";
const flush = () => new Promise((r) => setImmediate(r));
async function page(search = "") {
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
  let state = defaultState(),
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
  assert.equal(doc.querySelectorAll(".link-row").length, 3);
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
