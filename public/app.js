"use strict";
const { format, elapsed, FREE_ROUND } = TimerCore;
const params = new URLSearchParams(location.search);
const vista = params.get("vista");
const isOverview = vista === "general",
  isPublic = vista === "publico",
  isSpeaker = vista === "orador",
  isScreen = isOverview || isPublic || isSpeaker;
const isDisplay = !isScreen && params.has("pantalla");
const displayId = Number(params.get("pantalla"));
const MAX_CANDIDATES = 8,
  MAX_ROUNDS = 10;
const validDisplay =
  Number.isInteger(displayId) && displayId >= 1 && displayId <= MAX_CANDIDATES;
const $ = (id) => document.getElementById(id);
const two = (n) => String(n).padStart(2, "0");
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const setText = (id, text) => {
  const el = $(id);
  if (el && el.textContent !== text) el.textContent = text;
};
const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
let state = null;
let audioCtx,
  toastTimeout,
  pendingConfirm,
  wakeLock = null;
let designCandidate = 1,
  designDraft = null,
  designPreviewMood = "normal",
  uploadVersion = 0,
  imageBusy = false;
let settingsDraft = null,
  cardsKey = "",
  roundsKey = "",
  reportHTML = "";
const remaining = (c) => TimerCore.remaining(c, Cloud.now(), state.overtime);
const activeRound = () =>
  state.rounds.find((r) => r.id === state.round) || null;
// En las pantallas compartidas aparece quien habla o, si nadie habla, el presentado.
const onStage = () =>
  state.candidates.find((c) => c.running) ||
  state.candidates[(state.stage ?? 0) - 1] ||
  null;
const singleMode = () => state.mode === "single";
// Quien aparece en la pantalla del público y en la de los candidatos (null = fondo).
const screenCandidate = () =>
  state.candidates.find((c) => c.running) ||
  (standbyOn() ? null : state.candidates[(state.stage ?? 0) - 1] || null);
// Fondo de espera en los tótems: aparece tras unos segundos sin nadie hablando,
// para no parpadear en pausas breves. Al abrir la pantalla se muestra de inmediato.
const STANDBY_DELAY = 4000;
let idleSince = 0;
function standbyOn() {
  if (state.candidates.some((c) => c.running) || state.spotlight) {
    idleSince = null;
    return false;
  }
  idleSince ??= Date.now();
  return state.standby.enabled && Date.now() - idleSince >= STANDBY_DELAY;
}
// Carga una imagen guardada en un <img>; holder recuerda cuál está puesta.
function showAsset(holder, img, asset, alt) {
  if (holder.dataset.asset === asset) return;
  holder.dataset.asset = asset;
  img.hidden = true;
  img.removeAttribute("src");
  if (!asset) return;
  Totem.getImage(asset)
    .then((url) => {
      if (holder.dataset.asset !== asset || !url) return;
      img.src = url;
      img.alt = alt;
      img.hidden = false;
    })
    .catch(() =>
      setTimeout(() => {
        if (holder.dataset.asset === asset) delete holder.dataset.asset;
      }, 3000),
    );
}
const cardsSignature = () => state.candidates.length + ":" + state.mode;
const layoutName = { portrait: "Foto", flyer: "Flyer", minimal: "Solo tiempo" };
function toast(message) {
  // Dentro de un diálogo abierto, el aviso debe quedar por encima de su fondo.
  const host =
    [...document.querySelectorAll("dialog[open]")].at(-1) || document.body;
  if ($("toast").parentNode !== host) host.append($("toast"));
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $("toast").classList.remove("show"), 3800);
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast("Este navegador no permite guardar la preferencia de apariencia.");
    return false;
  }
}
function isOwner() {
  return Cloud.role === "admin" && Cloud.connected && !Cloud.busy;
}
function takeControl() {
  Cloud.refresh().catch((e) => toast(e.message));
}
function ensureOwner() {
  if (isOwner()) return true;
  toast(
    Cloud.busy
      ? "Espera a que termine la acción anterior."
      : "Sin conexión con el servidor. Reintenta en unos segundos.",
  );
  return false;
}
async function send(command) {
  if (!ensureOwner()) return false;
  try {
    await Cloud.command(command);
    return true;
  } catch (error) {
    toast(error.message);
    paint();
    return false;
  }
}
// screen: texto para tótems y proyector (más cordial que en el panel).
function status(c, screen = false) {
  const ms = remaining(c);
  return ms <= 0
    ? c.running && state.overtime
      ? screen
        ? "POR FAVOR, CONCLUYA"
        : "TIEMPO EXCEDIDO"
      : "TIEMPO AGOTADO"
    : c.running
      ? ms <= state.warning * 1000
        ? "ÚLTIMOS SEGUNDOS"
        : "EN USO DE LA PALABRA"
      : ms < c.duration
        ? "EN PAUSA"
        : "LISTO PARA INICIAR";
}
function mood(c) {
  const ms = remaining(c);
  return ms <= 0
    ? c.running && ms < 0
      ? "expired overtime"
      : "expired"
    : ms <= state.warning * 1000
      ? "warning"
      : c.running
        ? "active"
        : "";
}
function caption(c) {
  const round = activeRound();
  return (
    (round ? round.name.toUpperCase() + " · " : "") +
    (remaining(c) < 0 ? "TIEMPO EXCEDIDO" : "TIEMPO RESTANTE")
  );
}
function progress(c) {
  return Math.max(0, Math.min(100, (remaining(c) / c.duration) * 100));
}
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  audioCtx?.resume().catch(() => {});
}
function beep() {
  if (!state.sound || !audioCtx) return;
  const oscillator = audioCtx.createOscillator(),
    gain = audioCtx.createGain();
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.65);
}
function ask(title, description, action, label = "Confirmar") {
  $("confirm-title").textContent = title;
  $("confirm-description").textContent = description;
  $("accept-confirm").textContent = label;
  pendingConfirm = action;
  $("confirm").showModal();
}
$("accept-confirm").onclick = () => {
  $("confirm").close();
  if (ensureOwner()) pendingConfirm?.();
  pendingConfirm = null;
};
$("cancel-confirm").onclick = () => {
  $("confirm").close();
  pendingConfirm = null;
};
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
function toggle(id) {
  const c = state.candidates[id - 1];
  if (!c) return;
  unlockAudio();
  send({ type: "toggle", id });
}
function nextSpeaker() {
  const count = state.candidates.length;
  const current =
    state.candidates.find((c) => c.running)?.id ?? state.stage ?? 0;
  toggle((current % count) + 1);
}
async function pauseAll() {
  if (await send({ type: "pauseAll" }))
    toast("Todos los tiempos están en pausa.");
}
function reset(id) {
  const c = state.candidates[id - 1];
  ask(
    "¿Reiniciar a " + c.name + "?",
    "Su cronómetro volverá a " + format(c.duration) + ".",
    () => send({ type: "reset", id }),
    "Reiniciar",
  );
}
function resetAll(duration) {
  ask(
    duration
      ? "¿Asignar " + format(duration) + " a todos?"
      : "¿Reiniciar todos los tiempos?",
    "Se detendrán los turnos y se restaurará el tiempo de cada candidato.",
    () => send({ type: "resetAll", ...(duration ? { duration } : {}) }),
    "Reiniciar",
  );
}
function addTime(id, ms) {
  send({ type: "adjust", id, ms });
}
function selectRound(id) {
  const round = state.rounds.find((r) => r.id === id) || null;
  const name = round ? round.name : "Tiempo libre";
  const run = async () => {
    if (await send({ type: "round", id: round?.id ?? null }))
      toast(
        round
          ? `Ronda «${name}»: ${format(round.duration)} por candidato.`
          : "Tiempo libre: se conservan los tiempos actuales.",
      );
  };
  const inUse = state.candidates.some(
    (c) => c.running || remaining(c) !== c.duration,
  );
  if (!inUse) return run();
  ask(
    `¿Pasar a «${name}»?`,
    round
      ? `Se pausará el turno en curso y todos los cronómetros pasarán a ${format(round.duration)}. Los tiempos ya usados quedan en el informe.`
      : "Se pausará el turno en curso. Los tiempos actuales se conservan.",
    run,
    "Cambiar de ronda",
  );
}
function nextRound() {
  const index = state.rounds.findIndex((r) => r.id === state.round);
  const next = state.rounds[index + 1];
  if (next) selectRound(next.id);
  else toast("Es la última ronda. Puedes editarlas en «Configurar debate».");
}
function openScreen(id) {
  const url = Cloud.link(id);
  if (!url) {
    toast("Los enlaces aún no están listos. Reabre el panel.");
    return;
  }
  const win = window.open(
    url,
    "debate-candidate-" + id,
    "popup=yes,width=450,height=800",
  );
  if (!win) toast("Permite las ventanas emergentes para abrir el tótem.");
  else win.focus();
}
function showBackground() {
  if (!onStage()) return;
  send({ type: "present", id: null }).then(
    (ok) => ok && toast("La pantalla del público muestra el fondo de espera."),
  );
}
function present(id) {
  if (!id) return showBackground();
  const c = state.candidates[id - 1];
  if (!c || onStage()?.id === id) return;
  send({ type: "present", id }).then(
    (ok) =>
      ok && toast(`${c.name} está en pantalla. Pulsa ▶ para iniciar su tiempo.`),
  );
}
function linkRow(key, title, url, hint, attr = "") {
  return `<div class="link-row" ${attr}><label>${escapeHTML(title)}<input id="share-link-${key}" readonly value="${escapeHTML(url)}"></label><div class="link-actions"><button class="secondary" data-copy-link="${key}">Copiar enlace</button><span>${escapeHTML(hint)}</span></div></div>`;
}
async function showLinks() {
  try {
    await Cloud.getLinks();
    const origin = location.origin;
    const screenRows = [
      [
        "publico",
        "Pantalla del público (16:9) · candidato presentado con su foto",
        "?vista=publico",
      ],
      [
        "orador",
        "Pantalla de los candidatos · tiempo grande para quien habla",
        "?vista=orador",
      ],
    ]
      .map(([key, title, short]) => {
        const url = Cloud.screenLink?.(key);
        return url
          ? linkRow(
              key,
              title,
              url,
              `Después, en ese equipo: ${origin}/${short}`,
              `data-link-view="${key}"`,
            )
          : "";
      })
      .join("");
    const totemRows = state.candidates
      .map((c) =>
        linkRow(
          "s" + c.id,
          `Tótem ${c.id} · ${c.name}`,
          Cloud.link(c.id),
          `Después, en ese equipo: ${origin}/?pantalla=${c.id}`,
          `data-link-screen="${c.id}"`,
        ),
      )
      .join("");
    let html = singleMode()
      ? screenRows &&
        '<div class="section-label">PANTALLAS DEL DEBATE</div>' + screenRows
      : totemRows +
        (screenRows &&
          '<div class="section-label">PANTALLA ÚNICA (OPCIONAL)</div>' +
            screenRows);
    setText(
      "links-title",
      singleMode() ? "Enlaces de las pantallas" : "Enlaces para los tótems",
    );
    if (Cloud.overviewLink) {
      const obs = new URL(Cloud.overviewLink);
      obs.searchParams.set("fondo", "transparente");
      html +=
        '<div class="section-label">PROYECTOR Y TRANSMISIÓN</div>' +
        linkRow(
          "general",
          "Vista general (16:9) · todos los candidatos",
          Cloud.overviewLink,
          `Después, en ese equipo: ${origin}/?vista=general`,
        ) +
        linkRow(
          "obs",
          "Vista general para OBS · fondo transparente",
          obs.href,
          "En OBS: Fuente → Navegador, 1920 × 1080.",
        );
    }
    $("screen-link-list").innerHTML = html;
    document.querySelectorAll("[data-copy-link]").forEach(
      (b) =>
        (b.onclick = async () => {
          const input = $("share-link-" + b.dataset.copyLink);
          try {
            await navigator.clipboard.writeText(input.value);
            toast("Enlace copiado.");
          } catch {
            input.select();
            toast("Selecciona y copia el enlace con Ctrl+C.");
          }
        }),
    );
    $("screen-links").showModal();
  } catch (e) {
    toast(e.message);
  }
}
function editRow(kind, i, item, count) {
  const candidate = kind === "candidate";
  const label = candidate ? `Candidato ${i + 1}` : `Ronda ${i + 1}`;
  return `<div class="edit-row" data-kind="${kind}" data-index="${i}"><span class="edit-index">${candidate ? two(i + 1) : "R" + (i + 1)}</span><input class="edit-name" data-field="name" maxlength="${candidate ? 50 : 30}" required value="${escapeHTML(item.name)}" aria-label="${label}: nombre"><label class="edit-seconds"><input type="number" data-field="duration" min="1" max="3600" step="1" required value="${Math.round(item.duration / 1000)}" aria-label="${label}: segundos"><span>seg</span></label><button type="button" class="row-btn" data-move="-1" aria-label="Subir ${label}" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="row-btn" data-move="1" aria-label="Bajar ${label}" ${i === count - 1 ? "disabled" : ""}>↓</button><button type="button" class="row-btn remove" data-remove aria-label="Quitar ${label}" ${candidate && count <= 1 ? "disabled" : ""}>✕</button></div>`;
}
function renderSettingsLists() {
  const d = settingsDraft;
  $("candidate-count").textContent = `${d.candidates.length} / ${MAX_CANDIDATES}`;
  $("settings-candidates").innerHTML = d.candidates
    .map((c, i) => editRow("candidate", i, c, d.candidates.length))
    .join("");
  $("settings-rounds").innerHTML = d.rounds.length
    ? d.rounds
        .map((r, i) => editRow("round", i, r, d.rounds.length))
        .join("")
    : '<p class="small muted">Sin rondas: se usará solo el tiempo libre.</p>';
  $("add-candidate").disabled = d.candidates.length >= MAX_CANDIDATES;
  $("add-round").disabled = d.rounds.length >= MAX_ROUNDS;
}
const draftList = (row) =>
  settingsDraft[row.dataset.kind === "candidate" ? "candidates" : "rounds"];
for (const id of ["settings-candidates", "settings-rounds"]) {
  $(id).addEventListener("input", (e) => {
    const row = e.target.closest(".edit-row");
    if (!row || !settingsDraft) return;
    const item = draftList(row)[Number(row.dataset.index)];
    if (e.target.dataset.field === "name") item.name = e.target.value;
    else item.duration = Math.round(Number(e.target.value) * 1000);
  });
  $(id).addEventListener("click", (e) => {
    const button = e.target.closest("button");
    const row = button?.closest(".edit-row");
    if (!row || !settingsDraft) return;
    const list = draftList(row),
      i = Number(row.dataset.index);
    if (button.hasAttribute("data-remove")) list.splice(i, 1);
    else {
      const j = i + Number(button.dataset.move);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    }
    renderSettingsLists();
  });
}
function addDraftRow(kind) {
  const list = settingsDraft[kind === "candidate" ? "candidates" : "rounds"];
  list.push(
    kind === "candidate"
      ? {
          name: "Candidato " + (list.length + 1),
          duration: list.at(-1)?.duration ?? 120000,
        }
      : { name: "Ronda " + (list.length + 1), duration: 120000 },
  );
  renderSettingsLists();
  const input = $(
    kind === "candidate" ? "settings-candidates" : "settings-rounds",
  ).querySelector(".edit-row:last-child .edit-name");
  input?.focus();
  input?.select?.();
}
$("add-candidate").onclick = () => addDraftRow("candidate");
$("add-round").onclick = () => addDraftRow("round");
function setupForm() {
  if (!ensureOwner()) return;
  $("event-name").value = state.event;
  $("warning-seconds").value = state.warning;
  $("overtime-enabled").checked = state.overtime;
  document
    .querySelectorAll('[name="screen-mode"]')
    .forEach((r) => (r.checked = r.value === state.mode));
  settingsDraft = {
    candidates: state.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      duration: c.duration,
    })),
    rounds: state.rounds.map((r) => ({ ...r })),
  };
  renderSettingsLists();
  $("settings").showModal();
}
$("settings-form").onsubmit = async (e) => {
  e.preventDefault();
  const d = settingsDraft;
  const command = {
    type: "settings",
    event: $("event-name").value.trim() || "Debate UNAMAD",
    warning: Number($("warning-seconds").value),
    overtime: $("overtime-enabled").checked,
    mode:
      document.querySelector('[name="screen-mode"]:checked')?.value ??
      state.mode,
    candidates: d.candidates.map((c, i) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name.trim() || "Candidato " + (i + 1),
      duration: c.duration,
    })),
    rounds: d.rounds.map((r, i) => ({
      ...(r.id ? { id: r.id } : {}),
      name: r.name.trim() || "Ronda " + (i + 1),
      duration: r.duration,
    })),
  };
  const save = async () => {
    if (await send(command)) {
      $("settings").close();
      toast("Configuración guardada. Los cronómetros están listos.");
    }
  };
  const removed = state.candidates.filter(
    (c) => !d.candidates.some((x) => x.id === c.id),
  );
  if (!removed.length) return save();
  ask(
    removed.length === 1
      ? `¿Quitar a ${removed[0].name}?`
      : `¿Quitar ${removed.length} candidatos?`,
    "Se eliminarán su diseño y sus tiempos del informe. Los tótems se reasignan según el nuevo orden.",
    save,
    "Guardar y quitar",
  );
};
function reportData() {
  const now = Cloud.now();
  const all = [
    ...state.rounds.map((r) => ({ key: r.id, name: r.name })),
    { key: FREE_ROUND, name: "Tiempo libre" },
  ];
  const known = new Set(all.map((c) => c.key));
  const other = (c) =>
    Object.entries(c.spoken || {})
      .filter(([k]) => !known.has(k))
      .reduce((sum, [, v]) => sum + v, 0);
  if (state.candidates.some((c) => other(c) > 0))
    all.push({ key: null, name: "Rondas eliminadas" });
  const value = (c, col) =>
    col.key === null ? other(c) : TimerCore.spoken(state, c, col.key, now);
  const used = all.filter((col) =>
    state.candidates.some((c) => value(c, col) > 0),
  );
  const columns = used.length
    ? used
    : all.filter((col) => col.key !== FREE_ROUND || !state.rounds.length);
  const rows = state.candidates.map((c) => {
    const values = columns.map((col) => value(c, col));
    return {
      id: c.id,
      name: c.name,
      values,
      total: values.reduce((a, b) => a + b, 0),
    };
  });
  return { columns, rows };
}
function renderReport() {
  const { columns, rows } = reportData();
  const totals = columns.map((_, i) =>
    rows.reduce((sum, r) => sum + r.values[i], 0),
  );
  const html =
    `<thead><tr><th>Candidato</th>${columns.map((c) => `<th>${escapeHTML(c.name)}</th>`).join("")}<th>Total</th></tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr><th scope="row"><span class="report-num">${two(r.id)}</span>${escapeHTML(r.name)}</th>${r.values.map((v) => `<td>${v ? elapsed(v) : "—"}</td>`).join("")}<td class="report-total">${elapsed(r.total)}</td></tr>`,
      )
      .join("") +
    `</tbody><tfoot><tr><th>Total del debate</th>${totals.map((v) => `<td>${elapsed(v)}</td>`).join("")}<td class="report-total">${elapsed(totals.reduce((a, b) => a + b, 0))}</td></tr></tfoot>`;
  if (html !== reportHTML) {
    reportHTML = html;
    $("report-table").innerHTML = html;
  }
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  setText(
    "report-note",
    rows.length > 1 && sorted[0].total > 0
      ? `Diferencia entre el mayor y el menor tiempo total: ${elapsed(sorted[0].total - sorted.at(-1).total)} (${sorted[0].name} y ${sorted.at(-1).name}). Incluye el tiempo excedido; el turno en curso se suma en vivo.`
      : "Tiempo real en uso de la palabra, incluido el tiempo excedido. El turno en curso se suma en vivo.",
  );
}
function openReport() {
  setText(
    "report-meta",
    state.event +
      " · " +
      new Date().toLocaleString("es-PE", {
        dateStyle: "long",
        timeStyle: "short",
      }),
  );
  reportHTML = "";
  renderReport();
  $("report").showModal();
}
function exportCSV() {
  const { columns, rows } = reportData();
  const hms = (ms) => {
    const n = Math.floor(ms / 1000);
    return `${Math.floor(n / 3600)}:${two(Math.floor(n / 60) % 60)}:${two(n % 60)}`;
  };
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ["Candidato", ...columns.map((c) => c.name), "Total", "Total (segundos)"],
    ...rows.map((r) => [
      r.name,
      ...r.values.map(hms),
      hms(r.total),
      Math.floor(r.total / 1000),
    ]),
  ].map((row) => row.map(cell).join(","));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  a.download = `informe-tiempos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("export-csv").onclick = exportCSV;
$("print-report").onclick = () => {
  renderReport();
  document.body.classList.add("printing-report");
  window.print();
};
window.addEventListener("afterprint", () =>
  document.body.classList.remove("printing-report"),
);
$("clear-report").onclick = () =>
  ask(
    "¿Reiniciar el informe de tiempos?",
    "Se borrará el tiempo acumulado de todos los candidatos. Los cronómetros no cambian.",
    async () => {
      if (await send({ type: "clearReport" }))
        toast("Informe reiniciado.");
    },
    "Reiniciar informe",
  );
let standbyDraft = null,
  standbyUploads = 0;
function paintStandbyThumb(slot) {
  const id = standbyDraft[slot],
    box = $("standby-thumb-" + slot);
  showAsset(box, box.querySelector("img"), id || "", "Vista previa del fondo");
  $("standby-clear-" + slot).disabled = !id;
}
function openStandby() {
  if (!ensureOwner()) return;
  standbyDraft = { ...state.standby };
  $("standby-enabled").checked = standbyDraft.enabled;
  for (const slot of ["vertical", "horizontal"]) {
    $("standby-file-" + slot).value = "";
    paintStandbyThumb(slot);
  }
  $("standby-dialog").showModal();
}
for (const slot of ["vertical", "horizontal"]) {
  $("standby-file-" + slot).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !standbyDraft) return;
    standbyUploads++;
    $("standby-save").disabled = true;
    toast("Preparando imagen…");
    try {
      standbyDraft[slot] = await Totem.putImage(file);
      paintStandbyThumb(slot);
      toast("Imagen lista. Pulsa «Guardar fondo» para mostrarla.");
    } catch (error) {
      toast(error.message || "No se pudo guardar la imagen.");
    } finally {
      standbyUploads--;
      $("standby-save").disabled = standbyUploads > 0;
      e.target.value = "";
    }
  };
  $("standby-clear-" + slot).onclick = () => {
    standbyDraft[slot] = null;
    paintStandbyThumb(slot);
  };
}
$("standby-save").onclick = async () => {
  if (standbyUploads || !standbyDraft) return;
  const command = {
    type: "standby",
    enabled: $("standby-enabled").checked,
    vertical: standbyDraft.vertical,
    horizontal: standbyDraft.horizontal,
  };
  if (await send(command)) {
    $("standby-dialog").close();
    toast("Fondo de espera guardado.");
  }
};
function cardHTML(c) {
  const id = c.id,
    n = two(id),
    single = singleMode();
  return `<article class="candidate-card" id="card-${id}" style="--accent:${Totem.normalize(c.design, id).accent}"><div class="card-heading"><div class="avatar" id="avatar-${id}">${n}</div><div><div class="candidate-label">CANDIDATO ${n}</div><h2 class="candidate-name" id="name-${id}"></h2></div>${single ? "" : `<span class="screen-badge">T${id} ↗</span>`}</div><div class="timer-box"><div class="timer-status"><i></i><span id="status-${id}"></span></div><div class="timer" id="time-${id}" aria-label="Tiempo restante"></div><div class="track"><div class="track-fill" id="progress-${id}"></div></div><div class="assigned"><span id="remaining-label-${id}">TIEMPO RESTANTE</span><span id="assigned-${id}"></span></div></div><div class="controls"><div class="main-controls"><button class="primary" id="toggle-${id}" data-toggle="${id}">▶ &nbsp; Iniciar turno</button><button class="icon-btn" data-reset="${id}" aria-label="Reiniciar candidato ${id}" title="Reiniciar cronómetro">↺</button></div><div class="adjust-controls"><button data-adjust="${id}" data-ms="-15000" aria-label="Restar 15 segundos al candidato ${id}">−15 s</button><button data-adjust="${id}" data-ms="15000" aria-label="Agregar 15 segundos al candidato ${id}">+15 s</button><button data-adjust="${id}" data-ms="30000" aria-label="Agregar 30 segundos al candidato ${id}">+30 s</button></div></div><button class="totem-customize" data-design="${id}"><span>✦ &nbsp; ${single ? "Personalizar imagen" : "Personalizar tótem"}</span><span id="design-badge-${id}"></span></button>${single ? `<button class="open-screen present-btn" data-present="${id}"><span id="present-label-${id}">▣ &nbsp; Presentar en pantalla</span><span class="opened" id="present-state-${id}"></span></button>` : `<button class="open-screen" data-open="${id}"><span>▣ &nbsp; Abrir tótem ${id}</span><span class="opened" id="screen-status-${id}">↗</span></button>`}</article>`;
}
function renderCards() {
  cardsKey = cardsSignature();
  const cards = $("cards");
  cards.innerHTML = state.candidates.map(cardHTML).join("");
  const each = (selector, fn) =>
    cards.querySelectorAll(selector).forEach((b) => (b.onclick = () => fn(b)));
  each("[data-toggle]", (b) => toggle(Number(b.dataset.toggle)));
  each("[data-reset]", (b) => reset(Number(b.dataset.reset)));
  each("[data-adjust]", (b) =>
    addTime(Number(b.dataset.adjust), Number(b.dataset.ms)),
  );
  each("[data-design]", (b) => openDesign(Number(b.dataset.design)));
  each("[data-open]", (b) => openScreen(Number(b.dataset.open)));
  each("[data-present]", (b) => present(Number(b.dataset.present)));
  $("stage-chips").innerHTML =
    '<button class="round-chip" data-present-chip="0" title="Pausa el turno y muestra el fondo de espera">▣ Fondo</button>' +
    state.candidates
      .map(
        (c) =>
          `<button class="round-chip" data-present-chip="${c.id}"><b>${two(c.id)}</b><span id="chip-name-${c.id}"></span></button>`,
      )
      .join("");
  $("stage-chips")
    .querySelectorAll("[data-present-chip]")
    .forEach((b) => (b.onclick = () => present(Number(b.dataset.presentChip))));
  refreshOwner();
}
function renderRounds() {
  roundsKey = JSON.stringify(state.rounds);
  $("round-chips").innerHTML = [
    '<button class="round-chip" data-round="">Tiempo libre</button>',
    ...state.rounds.map(
      (r) =>
        `<button class="round-chip" data-round="${escapeHTML(r.id)}">${escapeHTML(r.name)}<small>${format(r.duration)}</small></button>`,
    ),
  ].join("");
  $("round-chips")
    .querySelectorAll("[data-round]")
    .forEach((b) => (b.onclick = () => selectRound(b.dataset.round || null)));
  $("next-round").hidden = !state.rounds.length;
  refreshOwner();
}
function renderPanel() {
  $("app").innerHTML =
    `<header><div class="brand"><div class="official-logo-plate"><img src="assets/unamad-logo-oficial.png" alt="UNAMAD · Universidad Nacional Amazónica de Madre de Dios" width="262" height="70"></div><div class="brand-separator"></div><div class="brand-program">DEBATE UNAMAD<span>CENTRAL DE MODERACIÓN</span></div></div><div class="header-right"><div class="pill"><span class="dot"></span> Panel del moderador</div><span class="header-clock" id="clock"></span><button class="panel-theme" id="panel-theme" title="Cambiar apariencia del panel">☾ Oscuro</button><button class="header-help" id="help-top">ⓘ &nbsp; Cómo conectar</button></div></header><main><div id="owner-warning" class="owner-warning" hidden><span id="owner-warning-text"></span><button id="take-control" class="secondary">Reintentar</button></div><section class="institutional-hero"><div class="institutional-hero-copy"><span class="hero-eyebrow"><i></i> ENCUENTRO UNIVERSITARIO</span><h1 id="event-title"></h1><p>Ideas para el futuro de nuestra universidad.</p><div class="hero-tags"><span id="hero-count"></span><span id="hero-mode"></span></div></div><div class="institutional-hero-visual"><div class="hero-identity"><img class="hero-crest" src="assets/logo-unamad.webp" alt="Escudo de la UNAMAD"><div class="hero-wordmark">UNAMAD<span>Universidad Nacional Amazónica<br>de Madre de Dios</span></div></div><div class="hero-identity-line"></div><span class="hero-location">PUERTO MALDONADO · MADRE DE DIOS</span></div></section><div class="workspace-heading"><div><span class="eyebrow">DIRECCIÓN DEL DEBATE</span><h2>Panel de moderación</h2></div><button class="secondary" id="settings-btn"><span aria-hidden="true">⚙</span> Configurar debate</button></div><div class="cloud-tools"><span class="cloud-state" id="cloud-status">Conectado al debate</span><button class="secondary" id="open-report">Informe de tiempos</button><button class="secondary" id="open-standby">Fondo de espera</button><button class="secondary" id="share-links">Enlaces de tótems</button><button class="secondary" id="logout">Cerrar sesión</button></div><section class="stage-bar" id="stage-bar" hidden aria-label="Pantalla única"><div class="stage-now"><span class="eyebrow">EN PANTALLA</span><strong id="stage-name"></strong><span id="stage-status"></span></div><div class="stage-time" id="stage-time"></div><div class="stage-actions"><button class="primary stage-play" id="stage-play">▶ &nbsp; Iniciar</button><button class="secondary" id="stage-next" title="Presenta e inicia al siguiente candidato (tecla →)">Siguiente &nbsp;⏭</button></div><div class="stage-pick"><span class="toolbar-label">Presentar</span><div class="stage-chips" id="stage-chips"></div><span class="stage-screens" id="stage-screens"></span></div></section><section class="round-bar" aria-label="Rondas del debate"><span class="toolbar-label">Ronda</span><div class="round-chips" id="round-chips"></div><div class="round-actions"><button class="secondary" id="next-round">Siguiente ronda &nbsp;→</button><button class="subtle" id="edit-rounds">Editar rondas</button></div></section><section class="toolbar" aria-label="Controles generales"><div class="toolbar-group"><span class="toolbar-label">Tiempo por intervención</span><div class="presets"><button class="preset" data-preset="60">1 min</button><button class="preset" data-preset="120">2 min</button><button class="preset" data-preset="180">3 min</button><button class="preset" id="custom-time">Personalizar</button></div><span class="divider"></span><label class="sound-label"><input id="sound" type="checkbox"> Aviso sonoro</label></div><div class="toolbar-group"><button class="primary" id="next-speaker" title="Pausa el turno actual e inicia el siguiente (tecla →)">Siguiente orador &nbsp;⏭</button><button class="secondary" id="pause-all">Ⅱ &nbsp; Pausar todos</button><button class="subtle" id="reset-all" title="Reiniciar todos los cronómetros">↺ &nbsp; Reiniciar</button></div></section><div class="status-line"><strong>Participantes <span class="muted-count" id="participant-count"></span></strong><span id="live-status">● &nbsp; Listos para comenzar</span></div><section class="cards" id="cards" aria-label="Cronómetros de los candidatos"></section><section class="bottom-row"><div class="guide-card"><div class="guide-symbol" aria-hidden="true">▣</div><div><h3>Identidad UNAMAD en cada tótem</h3><p>Añade la foto o el flyer de cada candidato y revisa su pantalla antes de proyectar. Para el proyector, usa la vista general.</p><button class="text-btn" id="help-bottom">Ver guía de conexión &nbsp; →</button></div></div><div class="shortcuts"><h3>El control, al alcance de tu teclado</h3><div class="shortcut-row"><span><kbd>1</kbd>…<kbd>8</kbd> Iniciar / pausar candidato</span><span><kbd>Espacio</kbd> Pausar / continuar</span><span><kbd>→</kbd> Siguiente orador</span></div></div></section><footer class="footer"><span><strong>● Un turno activo a la vez.</strong> Al cambiar de candidato, el anterior queda en pausa.</span><span id="footer-note">UNAMAD · Tótems en equipos independientes</span></footer></main>`;
  $("share-links").onclick = showLinks;
  $("open-report").onclick = openReport;
  $("open-standby").onclick = openStandby;
  $("logout").onclick = () => Cloud.logout().catch((e) => toast(e.message));
  applyPanelTheme();
  $("panel-theme").onclick = () => {
    const theme = document.body.classList.contains("dark-panel")
      ? "light"
      : "dark";
    write("debate-panel-theme", theme);
    applyPanelTheme();
  };
  $("help-top").onclick = $("help-bottom").onclick = () =>
    $("help").showModal();
  $("settings-btn").onclick =
    $("custom-time").onclick =
    $("edit-rounds").onclick =
      setupForm;
  $("pause-all").onclick = pauseAll;
  $("next-speaker").onclick = $("stage-next").onclick = nextSpeaker;
  $("stage-play").onclick = () => {
    const c = onStage();
    if (c) toggle(c.id);
    else toast("Primero elige a quién presentar.");
  };
  $("next-round").onclick = nextRound;
  $("reset-all").onclick = () => resetAll();
  $("take-control").onclick = takeControl;
  document
    .querySelectorAll("[data-preset]")
    .forEach(
      (b) => (b.onclick = () => resetAll(Number(b.dataset.preset) * 1000)),
    );
  $("sound").onchange = async (e) => {
    unlockAudio();
    if (await send({ type: "sound", value: e.target.checked })) {
      if (state.sound) beep();
    }
  };
  renderRounds();
  renderCards();
}
async function keepAwake() {
  try {
    if (!navigator.wakeLock || wakeLock) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {}
}
// Tótems y proyector: pantalla completa, herramientas que se ocultan, sin cursor ni suspensión.
function setupScreen(root) {
  $("fullscreen").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
      $("fullscreen").blur();
    } catch {
      toast("Usa F11 para activar la pantalla completa del navegador.");
    }
  };
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen").textContent = document.fullscreenElement
      ? "⛶ Salir de pantalla completa"
      : "⛶ Pantalla completa";
  });
  let hideTools;
  const showTools = () => {
    $("display-tools").classList.add("show-tools");
    document.body.classList.remove("hide-cursor");
    clearTimeout(hideTools);
    hideTools = setTimeout(() => {
      $("display-tools").classList.remove("show-tools");
      document.body.classList.add("hide-cursor");
    }, 3500);
  };
  root.addEventListener("pointermove", showTools);
  root.addEventListener("pointerdown", showTools);
  showTools();
  keepAwake();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) keepAwake();
  });
}
const screenTools =
  '<div class="display-tools show-tools" id="display-tools"><span id="connection">● Conectando con el moderador…</span><button id="fullscreen">⛶ Pantalla completa</button></div>';
function renderDisplay() {
  document.body.classList.add("display-body");
  if (!validDisplay) {
    $("app").innerHTML =
      '<div class="empty-state"><h1>Pantalla no encontrada</h1><p>Abre el enlace del tótem desde el panel del moderador («Enlaces de tótems»).</p><a href="./">Volver al panel</a></div>';
    return;
  }
  document.title = "Tótem " + displayId + " — Debate UNAMAD";
  $("app").innerHTML =
    `<section class="signage-screen" id="projection">${Totem.stageHTML()}<div class="standby-screen" id="standby" hidden><img class="standby-image" id="standby-image" alt="" hidden><div class="standby-default"><img class="standby-crest" src="assets/logo-unamad.webp" alt="Escudo de la UNAMAD"></div></div><div class="unassigned-note" id="unassigned" hidden><img src="assets/logo-unamad.webp" alt=""><strong>Tótem ${displayId}</strong><span>Sin candidato asignado</span><small>El moderador puede agregarlo en «Configurar debate».</small></div>${screenTools}</section>`;
  setupScreen($("projection"));
}
function renderOverview() {
  document.body.classList.add("display-body", "overview-body");
  if (params.get("fondo") === "transparente")
    for (const el of [document.documentElement, document.body])
      el.classList.add("overview-transparent");
  document.title = "Vista general — Debate UNAMAD";
  $("app").innerHTML =
    `<section class="overview-screen" id="overview"><div class="overview-head"><div class="overview-brand"><img src="assets/logo-unamad.webp" alt="Escudo de la UNAMAD"><div><strong id="ov-event"></strong><span>Universidad Nacional Amazónica de Madre de Dios</span></div></div><div class="overview-round"><span>RONDA</span><strong id="ov-round"></strong></div></div><div class="overview-speaker" id="ov-speaker"><div class="ov-speaker-info"><span class="ov-kicker" id="ov-kicker"></span><h1 id="ov-name"></h1><p id="ov-role"></p></div><div class="ov-speaker-clock"><div class="ov-time" id="ov-time"></div><div class="ov-track"><div id="ov-progress"></div></div></div></div><div class="overview-grid" id="ov-grid"></div>${screenTools}</section>`;
  renderOverviewGrid();
  setupScreen($("overview"));
}
const brandHead = (prefix) =>
  `<div class="overview-head"><div class="overview-brand"><img src="assets/logo-unamad.webp" alt="Escudo de la UNAMAD"><div><strong id="${prefix}-event"></strong><span>Universidad Nacional Amazónica de Madre de Dios</span></div></div><div class="overview-round"><span>RONDA</span><strong id="${prefix}-round"></strong></div></div>`;
function renderPublic() {
  document.body.classList.add("display-body", "overview-body");
  document.title = "Pantalla del público — Debate UNAMAD";
  $("app").innerHTML =
    `<section class="public-screen" id="public">${brandHead("pub")}<div class="public-body" id="pub-body"><div class="public-photo" id="pub-photo"><img id="pub-image" alt="" hidden><div class="public-placeholder"><svg viewBox="0 0 160 190" fill="none" aria-hidden="true"><circle cx="80" cy="57" r="32" fill="currentColor"/><path d="M15 182v-17a65 65 0 0 1 130 0v17" fill="currentColor"/></svg></div></div><div class="public-info"><span class="public-label" id="pub-label"></span><h1 id="pub-name"></h1><p id="pub-role"></p><div class="public-clock"><span class="public-caption" id="pub-caption"></span><div class="public-time" id="pub-time"></div><div class="public-status"><i></i><span id="pub-status"></span></div><div class="ov-track"><div id="pub-progress"></div></div></div></div></div><div class="public-empty" id="pub-empty" hidden><img class="public-empty-crest" src="assets/logo-unamad.webp" alt="Escudo de la UNAMAD"></div><img class="public-standby-image" id="pub-standby-image" alt="" hidden>${screenTools}</section>`;
  setupScreen($("public"));
}
function renderSpeaker() {
  document.body.classList.add("display-body", "speaker-body");
  document.title = "Pantalla de los candidatos — Debate UNAMAD";
  $("app").innerHTML =
    `<section class="speaker-screen" id="speaker"><div class="speaker-top"><span id="spk-round"></span><span id="spk-event"></span></div><div class="speaker-main"><h1 id="spk-name"></h1><div class="speaker-time" id="spk-time"></div><div class="speaker-status" id="spk-status"></div></div><div class="speaker-track"><div id="spk-progress"></div></div><div class="speaker-standby" id="spk-standby" hidden><img class="speaker-standby-crest" src="assets/logo-unamad.webp" alt="Escudo de la UNAMAD"><img class="speaker-standby-image" id="spk-standby-image" alt="" hidden></div>${screenTools}</section>`;
  setupScreen($("speaker"));
}
function paintPublic() {
  const c = screenCandidate(),
    round = activeRound();
  setText("pub-event", state.event);
  setText("pub-round", round ? round.name : "Tiempo libre");
  $("pub-body").hidden = !c;
  $("pub-empty").hidden = !!c;
  showAsset(
    $("pub-empty"),
    $("pub-standby-image"),
    c ? "" : state.standby.horizontal || "",
    "Fondo de espera",
  );
  $("public").classList.toggle("standby", !c);
  if (!c) {
    connectionLabel();
    return;
  }
  const d = Totem.normalize(c.design, c.id);
  $("public").style.setProperty("--ov-accent", d.accent);
  $("pub-body").className = `public-body layout-${d.layout} ${mood(c)}`;
  setText("pub-label", d.label || "CANDIDATO " + two(c.id));
  setText("pub-name", c.name);
  setText("pub-role", d.layout === "flyer" ? "" : d.role);
  setText("pub-caption", caption(c));
  setText("pub-time", format(remaining(c)));
  setText("pub-status", status(c, true));
  $("pub-progress").style.width = progress(c) + "%";
  const img = $("pub-image");
  img.style.objectFit = d.layout === "flyer" ? d.fit : "cover";
  img.style.objectPosition = "50% " + d.position + "%";
  showAsset(
    $("pub-photo"),
    img,
    d.layout === "minimal"
      ? ""
      : d[d.layout === "flyer" ? "flyer" : "photo"] || "",
    "Imagen de " + c.name,
  );
  connectionLabel();
}
function paintSpeaker() {
  const c = screenCandidate(),
    round = activeRound();
  setText("spk-event", state.event);
  setText("spk-round", round ? round.name : "Tiempo libre");
  $("speaker").className = "speaker-screen " + (c ? mood(c) : "standby");
  $("spk-standby").hidden = !!c;
  showAsset(
    $("spk-standby"),
    $("spk-standby-image"),
    c ? "" : state.standby.horizontal || "",
    "Fondo de espera",
  );
  setText("spk-name", c ? c.name : "En espera del siguiente orador");
  setText("spk-time", c ? format(remaining(c)) : "");
  setText("spk-status", c ? status(c, true) : "");
  $("spk-progress").style.width = (c ? progress(c) : 0) + "%";
  connectionLabel();
}
function renderOverviewGrid() {
  cardsKey = String(state.candidates.length);
  $("ov-grid").style.setProperty("--count", state.candidates.length);
  $("ov-grid").innerHTML = state.candidates
    .map(
      (c) =>
        `<article class="ov-tile" id="ov-tile-${c.id}"><span class="ov-num">${two(c.id)}</span><div class="ov-tile-body"><strong id="ov-tile-name-${c.id}"></strong><span id="ov-tile-status-${c.id}"></span></div><span class="ov-tile-time" id="ov-tile-time-${c.id}"></span></article>`,
    )
    .join("");
}
function refreshOwner() {
  if (isDisplay || isScreen || !$("owner-warning")) return;
  const owner = isOwner();
  $("owner-warning").hidden = Cloud.connected;
  $("owner-warning-text").textContent = Cloud.resting
    ? "Panel en reposo por inactividad. Mueve el mouse o pulsa una tecla para reanudar."
    : "Sin conexión con el servidor. Los controles se habilitarán al reconectar.";
  $("take-control").textContent = Cloud.resting ? "Reanudar" : "Reintentar";
  document
    .querySelectorAll(
      "[data-toggle],[data-reset],[data-adjust],[data-preset],[data-design],[data-round],[data-present],[data-present-chip],#stage-play,#stage-next,#open-standby,#custom-time,#settings-btn,#edit-rounds,#next-round,#next-speaker,#pause-all,#reset-all,#sound,#clear-report",
    )
    .forEach((b) => (b.disabled = !owner));
}
function connectionLabel() {
  const connected = Cloud.connected;
  $("connection").textContent = !connected
    ? "⚠ Sin conexión: mostrando el último tiempo recibido"
    : Cloud.waiting
      ? "● Conectado · esperando el panel del moderador"
      : "● Sincronizado con el debate";
  $("connection").classList.toggle("connection-lost", !connected);
}
function paintDisplay() {
  if (!validDisplay) return;
  const c = state.candidates[displayId - 1],
    standby = standbyOn();
  $("projection").classList.toggle("standby-on", standby);
  $("standby").hidden = !standby;
  $("projection").classList.toggle("unassigned", !c && !standby);
  $("unassigned").hidden = !!c || standby;
  if (standby) paintStandby(c);
  if (c) {
    Totem.paintStage(
      $("projection").querySelector(".totem-stage"),
      c,
      state.event,
      remaining(c),
      status(c, true),
      mood(c),
      caption(c),
    );
    $("projection").classList.toggle(
      "light-surround",
      Totem.normalize(c.design, c.id).theme === "light",
    );
  }
  connectionLabel();
}
function paintStandby(c) {
  const theme = c ? Totem.normalize(c.design, c.id).theme : "dark";
  $("standby").className = "standby-screen theme-" + theme;
  showAsset(
    $("standby"),
    $("standby-image"),
    state.standby.vertical || "",
    "Fondo de espera",
  );
}
function paintOverview() {
  const round = activeRound();
  setText("ov-event", state.event);
  setText("ov-round", round ? round.name : "Tiempo libre");
  const active = state.candidates.find((c) => c.running);
  const speaker = $("ov-speaker");
  if (active) {
    const d = Totem.normalize(active.design, active.id);
    speaker.style.setProperty("--ov-accent", d.accent);
    speaker.className = "overview-speaker " + mood(active);
    setText("ov-kicker", status(active, true));
    setText("ov-name", active.name);
    setText("ov-role", d.role);
    setText("ov-time", format(remaining(active)));
    $("ov-progress").style.width = progress(active) + "%";
  } else {
    const next = onStage();
    speaker.className = "overview-speaker idle";
    setText("ov-kicker", next ? "A CONTINUACIÓN" : "TURNO EN PAUSA");
    setText("ov-name", next ? next.name : round ? round.name : state.event);
    setText(
      "ov-role",
      next
        ? Totem.normalize(next.design, next.id).role
        : state.candidates.length + " candidatos",
    );
    setText("ov-time", next ? format(remaining(next)) : "");
    $("ov-progress").style.width = (next ? progress(next) : 0) + "%";
  }
  for (const c of state.candidates) {
    const tile = $("ov-tile-" + c.id);
    if (!tile) continue;
    tile.className = "ov-tile " + mood(c) + (c.running ? " speaking" : "");
    tile.style.setProperty("--ov-accent", Totem.normalize(c.design, c.id).accent);
    setText("ov-tile-name-" + c.id, c.name);
    setText("ov-tile-status-" + c.id, status(c, true));
    setText("ov-tile-time-" + c.id, format(remaining(c)));
  }
  connectionLabel();
}
function paintPanel() {
  const count = state.candidates.length;
  const round = activeRound();
  $("event-title").textContent = state.event;
  $("clock").textContent = new Date().toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  $("sound").checked = state.sound;
  const single = singleMode(),
    staged = onStage();
  setText("hero-count", `${two(count)} CANDIDATOS`);
  setText("hero-mode", single ? "PANTALLA ÚNICA" : "TÓTEMS VERTICALES 9:16");
  setText("share-links", single ? "Enlaces de pantallas" : "Enlaces de tótems");
  setText("participant-count", `/ ${two(count)}`);
  $("stage-bar").hidden = !single;
  if (single) paintStageBar(staged, round);
  state.candidates.forEach((c) => {
    const id = c.id;
    if (!$("card-" + id)) return;
    const design = Totem.normalize(c.design, id);
    const ms = remaining(c);
    $("card-" + id).style.setProperty("--accent", design.accent);
    setText(
      "design-badge-" + id,
      single
        ? layoutName[design.layout]
        : "9:16 · " + (design.theme === "light" ? "Claro" : "Oscuro"),
    );
    setText("name-" + id, c.name);
    setText("time-" + id, format(ms));
    setText("status-" + id, status(c));
    $("card-" + id).className =
      "candidate-card " +
      mood(c) +
      (single && staged?.id === id ? " on-stage" : "");
    $("progress-" + id).style.width = progress(c) + "%";
    setText("assigned-" + id, "DE " + format(c.duration));
    setText(
      "remaining-label-" + id,
      ms < 0 ? "TIEMPO EXCEDIDO" : "TIEMPO RESTANTE",
    );
    setText(
      "toggle-" + id,
      c.running
        ? "Ⅱ  Pausar turno"
        : ms <= 0 && !state.overtime
          ? "Tiempo agotado"
          : ms < c.duration
            ? "▶  Continuar turno"
            : "▶  Iniciar turno",
    );
    $("toggle-" + id).disabled =
      !isOwner() || (!c.running && ms <= 0 && !state.overtime);
    if (single) {
      const live = staged?.id === id;
      setText(
        "present-label-" + id,
        live ? "● En pantalla" : "▣  Presentar en pantalla",
      );
      setText("present-state-" + id, live && c.running ? "EN VIVO" : "");
      setText("chip-name-" + id, c.name);
    } else {
      const seen = Cloud.presence.find((x) => x.screen === id);
      setText(
        "screen-status-" + id,
        seen && Cloud.now() - seen.at < 12000 ? "● Conectado" : "↗",
      );
    }
  });
  document
    .querySelectorAll("[data-round]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.round === (state.round ?? "")),
    );
  const active = state.candidates.find((c) => c.running);
  setText(
    "live-status",
    (active ? "● Turno de " + active.name : "● Ningún turno activo") +
      (round ? " · " + round.name : "") +
      (active || state.spotlight || !state.standby.enabled
        ? ""
        : single
          ? " · pantallas con fondo de espera"
          : " · tótems con fondo de espera"),
  );
  $("live-status").classList.toggle("live-note", Boolean(active));
  document
    .querySelectorAll("[data-preset]")
    .forEach((b) =>
      b.classList.toggle(
        "selected",
        state.candidates.every(
          (c) => c.duration === Number(b.dataset.preset) * 1000,
        ),
      ),
    );
  const overview = Cloud.presence.find((x) => x.screen === 99);
  setText(
    "cloud-status",
    Cloud.busy
      ? "Guardando cambios…"
      : Cloud.resting
        ? "Panel en reposo"
        : Cloud.connected
          ? "● Conectado al debate" +
            (overview && Cloud.now() - overview.at < 12000
              ? " · Vista general conectada"
              : "")
          : "⚠ Sin conexión · reintentando",
  );
  $("cloud-status").classList.toggle("connection-lost", !Cloud.connected);
  if ($("report").hasAttribute("open")) renderReport();
}
const seenRecently = (screen) => {
  const seen = Cloud.presence.find((x) => x.screen === screen);
  return !!seen && Cloud.now() - seen.at < 12000;
};
function paintStageBar(c, round) {
  setText("stage-name", c ? c.name : "Nadie en pantalla");
  const onScreens = c && (c.running || state.spotlight || !state.standby.enabled);
  setText(
    "stage-status",
    c
      ? (onScreens ? status(c) : "EN PAUSA · LAS PANTALLAS MUESTRAN EL FONDO") +
          (round ? " · " + round.name : "")
      : "Elige a quién presentar",
  );
  setText("stage-time", c ? format(remaining(c)) : "--:--");
  $("stage-bar").className = "stage-bar " + (c ? mood(c) : "");
  setText("stage-play", c?.running ? "Ⅱ  Pausar" : "▶  Iniciar");
  $("stage-play").disabled =
    !isOwner() ||
    !c ||
    (!c.running && remaining(c) <= 0 && !state.overtime);
  document
    .querySelectorAll("[data-present-chip]")
    .forEach((b) =>
      b.classList.toggle(
        "selected",
        Number(b.dataset.presentChip) === (c?.id ?? 0),
      ),
    );
  setText(
    "stage-screens",
    `Público ${seenRecently(98) ? "●" : "○"} · Candidatos ${seenRecently(97) ? "●" : "○"}`,
  );
}
function paint() {
  if (!state) return;
  if (isOverview) paintOverview();
  else if (isPublic) paintPublic();
  else if (isSpeaker) paintSpeaker();
  else if (isDisplay) paintDisplay();
  else paintPanel();
}
window.addEventListener("storage", (e) => {
  if (e.key === "debate-panel-theme" && !isDisplay && !isScreen)
    applyPanelTheme();
});
window.addEventListener("keydown", (e) => {
  if (
    isDisplay ||
    isScreen ||
    !state ||
    e.repeat ||
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    document.querySelector("dialog[open]") ||
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
  )
    return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= state.candidates.length) {
    e.preventDefault();
    toggle(n);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    nextSpeaker();
  } else if (e.code === "Space" && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    const active = state.candidates.find((c) => c.running);
    toggle(active?.id || state.stage || 1);
  }
});
function applyPanelTheme() {
  const dark = read("debate-panel-theme") === "dark";
  document.body.classList.toggle("dark-panel", dark);
  if ($("panel-theme"))
    $("panel-theme").textContent = dark ? "☀ Claro" : "☾ Oscuro";
}
function openDesign(id) {
  if (!ensureOwner()) return;
  designCandidate = id;
  designDraft = {
    ...Totem.normalize(state.candidates[id - 1].design, id),
    name: state.candidates[id - 1].name,
  };
  designPreviewMood = "normal";
  uploadVersion++;
  imageBusy = false;
  $("design-title").textContent = "Personalizar tótem " + id;
  $("design-name").value = designDraft.name;
  $("design-label").value = designDraft.label;
  $("design-role").value = designDraft.role;
  $("design-color").value = designDraft.accent;
  $("design-fit").value = designDraft.fit;
  $("design-backdrop").value = designDraft.backdrop;
  $("design-position").value = designDraft.position;
  $("design-file").value = "";
  $("design-preview").innerHTML = Totem.stageHTML();
  syncDesignControls();
  $("design-editor").showModal();
}
function syncDesignControls() {
  if (!designDraft) return;
  const d = designDraft;
  document.querySelectorAll("[data-layout]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.layout === d.layout);
    b.setAttribute("aria-pressed", String(b.dataset.layout === d.layout));
    b.disabled = imageBusy;
  });
  document.querySelectorAll("[data-theme]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.theme === d.theme);
    b.setAttribute("aria-pressed", String(b.dataset.theme === d.theme));
  });
  document
    .querySelectorAll("[data-preview]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.preview === designPreviewMood),
    );
  $("image-options").hidden = d.layout === "minimal";
  $("fit-field").hidden = d.layout !== "flyer";
  $("identity-extras").hidden = d.layout === "flyer";
  $("design-color-value").textContent = d.accent.toUpperCase();
  $("design-color").value = d.accent;
  $("upload-label").textContent =
    d.layout === "flyer"
      ? "Subir flyer del candidato"
      : "Subir fotografía del candidato";
  $("upload-hint").textContent =
    d.layout === "flyer"
      ? "Tu diseño completo, con un cronómetro independiente debajo."
      : "Usa una foto vertical. Ajusta el encuadre para centrar el rostro.";
  const asset = d[d.layout === "flyer" ? "flyer" : "photo"];
  $("upload-status").textContent = imageBusy
    ? "Preparando imagen…"
    : asset
      ? "Imagen guardada"
      : "Sin imagen";
  $("remove-image").disabled = imageBusy || !asset;
  $("design-file").disabled = imageBusy;
  $("apply-design").disabled = imageBusy;
  paintDesignPreview();
}
function paintDesignPreview() {
  if (!designDraft) return;
  const c = {
    ...state.candidates[designCandidate - 1],
    name: designDraft.name || "Nombre del candidato",
    design: designDraft,
  };
  const ms =
    designPreviewMood === "expired"
      ? 0
      : designPreviewMood === "warning"
        ? 20000
        : c.duration;
  Totem.paintStage(
    $("design-preview").querySelector(".totem-stage"),
    c,
    state.event,
    ms,
    designPreviewMood === "expired"
      ? "TIEMPO AGOTADO"
      : designPreviewMood === "warning"
        ? "ÚLTIMOS SEGUNDOS"
        : "LISTO PARA INICIAR",
    designPreviewMood === "normal" ? "" : designPreviewMood,
    activeRound()
      ? activeRound().name.toUpperCase() + " · TIEMPO RESTANTE"
      : "TIEMPO RESTANTE",
  );
}
document.querySelectorAll("[data-layout]").forEach(
  (b) =>
    (b.onclick = () => {
      designDraft.layout = b.dataset.layout;
      syncDesignControls();
    }),
);
document.querySelectorAll("[data-theme]").forEach(
  (b) =>
    (b.onclick = () => {
      designDraft.theme = b.dataset.theme;
      syncDesignControls();
    }),
);
document.querySelectorAll("[data-color]").forEach(
  (b) =>
    (b.onclick = () => {
      designDraft.accent = b.dataset.color;
      syncDesignControls();
    }),
);
document.querySelectorAll("[data-preview]").forEach(
  (b) =>
    (b.onclick = () => {
      designPreviewMood = b.dataset.preview;
      syncDesignControls();
    }),
);
for (const [id, key] of [
  ["design-backdrop", "backdrop"],
  ["design-name", "name"],
  ["design-role", "role"],
  ["design-label", "label"],
  ["design-color", "accent"],
  ["design-fit", "fit"],
  ["design-position", "position"],
])
  $(id).addEventListener("input", (e) => {
    if (!designDraft) return;
    designDraft[key] =
      key === "position" ? Number(e.target.value) : e.target.value;
    if (key === "accent")
      $("design-color-value").textContent = e.target.value.toUpperCase();
    paintDesignPreview();
  });
$("design-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file || !designDraft) return;
  const version = ++uploadVersion,
    slot = designDraft.layout === "flyer" ? "flyer" : "photo";
  imageBusy = true;
  syncDesignControls();
  try {
    const id = await Totem.putImage(file);
    if (version !== uploadVersion) return;
    designDraft[slot] = id;
    toast("Imagen lista. Pulsa «Aplicar al tótem» para proyectarla.");
  } catch (error) {
    if (version === uploadVersion)
      toast(error.message || "No se pudo guardar la imagen.");
  } finally {
    if (version === uploadVersion) {
      imageBusy = false;
      $("design-file").value = "";
      syncDesignControls();
    }
  }
};
$("remove-image").onclick = () => {
  designDraft[designDraft.layout === "flyer" ? "flyer" : "photo"] = null;
  $("design-file").value = "";
  syncDesignControls();
};
$("design-form").onsubmit = async (e) => {
  e.preventDefault();
  if (imageBusy) return;
  const command = {
    type: "design",
    id: designCandidate,
    name: designDraft.name.trim() || "Candidato " + designCandidate,
    design: Totem.normalize(designDraft, designCandidate),
  };
  if (await send(command)) {
    $("design-editor").close();
    toast("Diseño aplicado. El tiempo se conserva.");
  }
};
$("design-editor").addEventListener("close", () => {
  uploadVersion++;
  imageBusy = false;
});
async function boot() {
  await Cloud.init();
  state = Cloud.state;
  if (isOverview) renderOverview();
  else if (isPublic) renderPublic();
  else if (isSpeaker) renderSpeaker();
  else if (isDisplay) renderDisplay();
  else renderPanel();
  const previous = new Map(state.candidates.map((c) => [c.id, remaining(c)]));
  Cloud.setCallbacks(
    (next) => {
      state = next;
      if (isOverview) {
        if (String(state.candidates.length) !== cardsKey) renderOverviewGrid();
      } else if (!isDisplay && !isScreen) {
        if (cardsSignature() !== cardsKey) renderCards();
        if (JSON.stringify(state.rounds) !== roundsKey) renderRounds();
      }
      paint();
    },
    () => {
      refreshOwner();
      paint();
    },
  );
  refreshOwner();
  paint();
  Cloud.startPolling();
  setInterval(() => {
    if (Cloud.role === "admin" && !isDisplay && !isScreen) {
      for (const c of state.candidates) {
        const value = remaining(c);
        if ((previous.get(c.id) ?? 0) > 0 && value <= 0 && c.running) beep();
        previous.set(c.id, value);
      }
    }
    paint();
  }, 100);
}
boot().catch((error) => {
  document.getElementById("cloud-gate").hidden = false;
  document.getElementById("login-error").textContent =
    error.message || "No se pudo iniciar el panel.";
});
