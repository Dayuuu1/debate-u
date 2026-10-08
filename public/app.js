"use strict";
const { format } = TimerCore;
const remaining = (c) => TimerCore.remaining(c, Cloud.now());
const params = new URLSearchParams(location.search),
  displayId = Number(params.get("pantalla"));
const isDisplay = params.has("pantalla"),
  validDisplay = [1, 2, 3].includes(displayId);
const accents = ["#d60050", "#d60050", "#d60050"];
const $ = (id) => document.getElementById(id);
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const defaults = () => ({
  event: "Debate al Rectorado · UNAMAD",
  warning: 30,
  sound: false,
  updated: Date.now(),
  candidates: [1, 2, 3].map((id) => ({
    id,
    name: "Candidato " + id,
    duration: 120000,
    remaining: 120000,
    running: false,
    deadline: null,
  })),
});
const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
let state = defaults();
let audioCtx,
  toastTimeout,
  pendingConfirm,
  selected = 1;
let designCandidate = 1,
  designDraft = null,
  designPreviewMood = "normal",
  uploadVersion = 0,
  imageBusy = false;
function toast(message) {
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
function status(c) {
  const ms = remaining(c);
  return ms <= 0
    ? "TIEMPO AGOTADO"
    : c.running
      ? ms <= state.warning * 1000
        ? "ÚLTIMOS SEGUNDOS"
        : "EN USO DE LA PALABRA"
      : ms < c.duration
        ? "EN PAUSA"
        : "LISTO PARA INICIAR";
}
function mood(c) {
  return remaining(c) <= 0
    ? "expired"
    : remaining(c) <= state.warning * 1000
      ? "warning"
      : c.running
        ? "active"
        : "";
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
function ask(title, description, action) {
  $("confirm-title").textContent = title;
  $("confirm-description").textContent = description;
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
  selected = id;
  unlockAudio();
  send({ type: "toggle", id });
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
  );
}
function resetAll(duration) {
  ask(
    duration
      ? "¿Asignar " + format(duration) + " a todos?"
      : "¿Reiniciar los tres tiempos?",
    "Se detendrán los turnos y se restaurará el tiempo de cada candidato.",
    () => send({ type: "resetAll", ...(duration ? { duration } : {}) }),
  );
}
function addTime(id, ms) {
  send({ type: "adjust", id, ms });
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
async function showLinks() {
  try {
    await Cloud.getLinks();
    $("screen-link-list").innerHTML = Cloud.links
      .map(
        (x) =>
          `<div class="link-row"><label>Tótem ${x.screen}<input id="share-link-${x.screen}" readonly value="${escapeHTML(x.url)}"></label><button class="secondary" data-copy-link="${x.screen}">Copiar enlace</button></div>`,
      )
      .join("");
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
function setupForm() {
  if (!ensureOwner()) return;
  $("event-name").value = state.event;
  $("warning-seconds").value = state.warning;
  $("settings-fields").innerHTML = state.candidates
    .map(
      (c) =>
        `<div class="field-row"><label class="field">Candidato ${c.id}<input name="name-${c.id}" maxlength="50" value="${escapeHTML(c.name)}" required></label><label class="field">Tiempo (seg.)<input name="duration-${c.id}" type="number" min="1" max="3600" value="${Math.round(c.duration / 1000)}" required></label></div>`,
    )
    .join("");
  $("settings").showModal();
}
$("settings-form").onsubmit = async (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const command = {
    type: "settings",
    event: $("event-name").value.trim() || "Debate al Rectorado · UNAMAD",
    warning: Number($("warning-seconds").value),
    candidates: state.candidates.map((c) => ({
      name: String(data.get("name-" + c.id)).trim() || "Candidato " + c.id,
      duration: Number(data.get("duration-" + c.id)) * 1000,
    })),
  };
  if (await send(command)) {
    $("settings").close();
    toast("Configuración guardada. Los cronómetros están listos.");
  }
};
function renderPanel() {
  $("app").innerHTML =
    `<header><div class="brand"><div class="official-logo-plate"><img src="assets/unamad-logo-oficial.png" alt="UNAMAD · Universidad Nacional Amazónica de Madre de Dios" width="262" height="70"></div><div class="brand-separator"></div><div class="brand-program">DEBATE AL RECTORADO<span>CENTRAL DE MODERACIÓN</span></div></div><div class="header-right"><div class="pill"><span class="dot"></span> Panel del moderador</div><span class="header-clock" id="clock"></span><button class="panel-theme" id="panel-theme" title="Cambiar apariencia del panel">☾ Oscuro</button><button class="header-help" id="help-top">ⓘ &nbsp; Cómo conectar</button></div></header><main><div id="owner-warning" class="owner-warning" hidden><span id="owner-warning-text"></span><button id="take-control" class="secondary">Reintentar</button></div><section class="institutional-hero"><div class="institutional-hero-copy"><span class="hero-eyebrow"><i></i> ENCUENTRO UNIVERSITARIO</span><h1 id="event-title"></h1><p>Ideas para el futuro de nuestra universidad.</p><div class="hero-tags"><span>03 CANDIDATOS</span><span>TÓTEMS VERTICALES 9:16</span></div></div><div class="institutional-hero-visual"><div class="hero-identity"><img class="hero-crest" src="assets/unamad-escudo-oficial.png" alt="Escudo de la UNAMAD"><div class="hero-wordmark">UNAMAD<span>Universidad Nacional Amazónica<br>de Madre de Dios</span></div></div><div class="hero-identity-line"></div><span class="hero-location">PUERTO MALDONADO · MADRE DE DIOS</span></div></section><div class="workspace-heading"><div><span class="eyebrow">DIRECCIÓN DEL DEBATE</span><h2>Panel de moderación</h2></div><button class="secondary" id="settings-btn"><span aria-hidden="true">⚙</span> Configurar debate</button></div><div class="cloud-tools"><span class="cloud-state" id="cloud-status">Conectado al debate</span><button class="secondary" id="share-links">Enlaces de tótems</button><button class="secondary" id="logout">Cerrar sesión</button></div><section class="toolbar" aria-label="Controles generales"><div class="toolbar-group"><span class="toolbar-label">Tiempo por intervención</span><div class="presets"><button class="preset" data-preset="60">1 min</button><button class="preset" data-preset="120">2 min</button><button class="preset" data-preset="180">3 min</button><button class="preset" id="custom-time">Personalizar</button></div><span class="divider"></span><label class="sound-label"><input id="sound" type="checkbox"> Aviso sonoro</label></div><div class="toolbar-group"><button class="secondary" id="pause-all">Ⅱ &nbsp; Pausar todos</button><button class="subtle" id="reset-all" title="Reiniciar los tres cronómetros">↺ &nbsp; Reiniciar</button></div></section><div class="status-line"><strong>Participantes <span style="color:#97a3b0;font-weight:400">/ 03</span></strong><span id="live-status">● &nbsp; Listos para comenzar</span></div><section class="cards" aria-label="Cronómetros de los candidatos">${state.candidates.map((c) => `<article class="candidate-card" id="card-${c.id}" style="--accent:${accents[c.id - 1]}"><div class="card-heading"><div class="avatar" id="avatar-${c.id}">${String(c.id).padStart(2, "0")}</div><div><div class="candidate-label">CANDIDATO ${String(c.id).padStart(2, "0")}</div><h2 class="candidate-name" id="name-${c.id}"></h2></div><span class="screen-badge">P${c.id} ↗</span></div><div class="timer-box"><div class="timer-status"><i></i><span id="status-${c.id}"></span></div><div class="timer" id="time-${c.id}" aria-label="Tiempo restante"></div><div class="track"><div class="track-fill" id="progress-${c.id}"></div></div><div class="assigned"><span>TIEMPO RESTANTE</span><span id="assigned-${c.id}"></span></div></div><div class="controls"><div class="main-controls"><button class="primary" id="toggle-${c.id}" data-toggle="${c.id}">▶ &nbsp; Iniciar turno</button><button class="icon-btn" data-reset="${c.id}" aria-label="Reiniciar candidato ${c.id}" title="Reiniciar cronómetro">↺</button></div><div class="adjust-controls"><button data-adjust="${c.id}" data-ms="-15000" aria-label="Restar 15 segundos al candidato ${c.id}">−15 s</button><button data-adjust="${c.id}" data-ms="15000" aria-label="Agregar 15 segundos al candidato ${c.id}">+15 s</button><button data-adjust="${c.id}" data-ms="30000" aria-label="Agregar 30 segundos al candidato ${c.id}">+30 s</button></div></div><button class="totem-customize" data-design="${c.id}"><span>✦ &nbsp; Personalizar tótem</span><span id="design-badge-${c.id}">9:16 · Oscuro</span></button><button class="open-screen" data-open="${c.id}"><span>▣ &nbsp; Abrir pantalla ${c.id}</span><span class="opened" id="screen-status-${c.id}">↗</span></button></article>`).join("")}</section><section class="bottom-row"><div class="guide-card"><div class="guide-symbol" aria-hidden="true">▣</div><div><h3>Identidad UNAMAD en cada tótem</h3><p>Añade la foto o el flyer de cada candidato y revisa su pantalla antes de proyectar.</p><button class="text-btn" id="help-bottom">Ver guía de conexión &nbsp; →</button></div></div><div class="shortcuts"><h3>El control, al alcance de tu teclado</h3><div class="shortcut-row"><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> Iniciar / pausar candidato</span><span><kbd>Espacio</kbd> Pausar / continuar</span></div></div></section><footer class="footer"><span><strong>● Un turno activo a la vez.</strong> Al cambiar de candidato, el anterior queda en pausa.</span><span id="footer-note">UNAMAD · Tótems en equipos independientes</span></footer></main>`;
  $("share-links").onclick = showLinks;
  $("logout").onclick = () => Cloud.logout().catch((e) => toast(e.message));
  applyPanelTheme();
  $("panel-theme").onclick = () => {
    const theme = document.body.classList.contains("dark-panel")
      ? "light"
      : "dark";
    write("debate-panel-theme", theme);
    applyPanelTheme();
  };
  document
    .querySelectorAll("[data-design]")
    .forEach((b) => (b.onclick = () => openDesign(Number(b.dataset.design))));
  $("help-top").onclick = $("help-bottom").onclick = () =>
    $("help").showModal();
  $("settings-btn").onclick = $("custom-time").onclick = setupForm;
  $("pause-all").onclick = pauseAll;
  $("reset-all").onclick = () => resetAll();
  $("take-control").onclick = takeControl;
  document
    .querySelectorAll("[data-toggle]")
    .forEach((b) => (b.onclick = () => toggle(Number(b.dataset.toggle))));
  document
    .querySelectorAll("[data-reset]")
    .forEach((b) => (b.onclick = () => reset(Number(b.dataset.reset))));
  document
    .querySelectorAll("[data-adjust]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          addTime(Number(b.dataset.adjust), Number(b.dataset.ms))),
    );
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openScreen(Number(b.dataset.open))));
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
}
function renderDisplay() {
  document.body.classList.add("display-body");
  if (!validDisplay) {
    $("app").innerHTML =
      '<div class="empty-state"><h1>Pantalla no encontrada</h1><p>Elige uno de los tres tótems desde el panel del moderador.</p><a href="./">Volver al panel</a></div>';
    return;
  }
  document.title = "Tótem " + displayId + " — Rectorado UNAMAD";
  $("app").innerHTML =
    `<section class="signage-screen" id="projection">${Totem.stageHTML()}<div class="display-tools show-tools" id="display-tools"><span id="connection">● Conectando con el moderador…</span><button id="fullscreen">⛶ Pantalla completa</button></div></section>`;
  $("fullscreen").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("projection").requestFullscreen();
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
    clearTimeout(hideTools);
    hideTools = setTimeout(
      () => $("display-tools").classList.remove("show-tools"),
      3500,
    );
  };
  $("projection").addEventListener("pointermove", showTools);
  $("projection").addEventListener("pointerdown", showTools);
  showTools();
}
function refreshOwner() {
  if (isDisplay) return;
  const owner = isOwner();
  $("owner-warning").hidden = Cloud.connected;
  $("owner-warning-text").textContent = Cloud.resting
    ? "Panel en reposo por inactividad. Mueve el mouse o pulsa una tecla para reanudar."
    : "Sin conexión con el servidor. Los controles se habilitarán al reconectar.";
  $("take-control").textContent = Cloud.resting ? "Reanudar" : "Reintentar";
  document
    .querySelectorAll(
      "[data-toggle],[data-reset],[data-adjust],[data-preset],[data-design],#custom-time,#settings-btn,#pause-all,#reset-all,#sound",
    )
    .forEach((b) => (b.disabled = !owner));
}
function paint() {
  if (isDisplay) {
    if (!validDisplay) return;
    const c = state.candidates[displayId - 1];
    Totem.paintStage(
      $("projection").querySelector(".totem-stage"),
      c,
      state.event,
      remaining(c),
      status(c),
      mood(c),
    );
    $("projection").classList.toggle(
      "light-surround",
      Totem.normalize(c.design, c.id).theme === "light",
    );
    const connected = Cloud.connected;
    $("connection").textContent = !connected
      ? "⚠ Sin conexión: mostrando el último tiempo recibido"
      : Cloud.waiting
        ? "● Conectado · esperando el panel del moderador"
        : "● Sincronizado con el debate";
    $("connection").classList.toggle("connection-lost", !connected);
    return;
  }
  $("event-title").textContent = state.event;
  $("clock").textContent = new Date().toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  $("sound").checked = state.sound;
  state.candidates.forEach((c) => {
    const id = c.id;
    const design = Totem.normalize(c.design, id);
    $("card-" + id).style.setProperty("--accent", design.accent);
    $("design-badge-" + id).textContent =
      "9:16 · " + (design.theme === "light" ? "Claro" : "Oscuro");
    $("name-" + id).textContent = c.name;
    $("time-" + id).textContent = format(remaining(c));
    $("status-" + id).textContent = status(c);
    $("card-" + id).className = "candidate-card " + mood(c);
    $("progress-" + id).style.width = progress(c) + "%";
    $("assigned-" + id).textContent = "DE " + format(c.duration);
    $("toggle-" + id).textContent = c.running
      ? "Ⅱ  Pausar turno"
      : remaining(c) <= 0
        ? "Tiempo agotado"
        : remaining(c) < c.duration
          ? "▶  Continuar turno"
          : "▶  Iniciar turno";
    $("toggle-" + id).disabled = !isOwner() || remaining(c) <= 0;
    const connected = Cloud.presence.find((x) => x.screen === id);
    $("screen-status-" + id).textContent =
      connected && Cloud.now() - connected.at < 12000 ? "● Conectada" : "↗";
  });
  const active = state.candidates.find((c) => c.running && remaining(c) > 0);
  $("live-status").textContent = active
    ? "● Turno de " + active.name
    : "● Ningún turno activo";
  $("live-status").classList.toggle("live-note", Boolean(active));
  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.classList.toggle(
      "selected",
      state.candidates.every(
        (c) => c.duration === Number(b.dataset.preset) * 1000,
      ),
    ),
  );
  $("cloud-status").textContent = Cloud.busy
    ? "Guardando cambios…"
    : Cloud.resting
      ? "Panel en reposo"
      : Cloud.connected
      ? "● Conectado al debate"
      : "⚠ Sin conexión · reintentando";
  $("cloud-status").classList.toggle("connection-lost", !Cloud.connected);
}
window.addEventListener("storage", (e) => {
  if (e.key === "debate-panel-theme" && !isDisplay) applyPanelTheme();
});
window.addEventListener("keydown", (e) => {
  if (
    isDisplay ||
    e.repeat ||
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    document.querySelector("dialog[open]") ||
    /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)
  )
    return;
  if (["1", "2", "3"].includes(e.key)) {
    e.preventDefault();
    toggle(Number(e.key));
  } else if (e.code === "Space") {
    e.preventDefault();
    const active = state.candidates.find((c) => c.running);
    toggle(active?.id || selected);
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
  if (isDisplay) renderDisplay();
  else renderPanel();
  const previous = new Map(state.candidates.map((c) => [c.id, remaining(c)]));
  Cloud.setCallbacks(
    (next) => {
      state = next;
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
    if (Cloud.role === "admin" && !isDisplay) {
      for (const c of state.candidates) {
        const value = remaining(c);
        if ((previous.get(c.id) || 0) > 0 && value === 0 && c.running) beep();
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
