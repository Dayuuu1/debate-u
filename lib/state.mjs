export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const MAX_CANDIDATES = 8;
export const MAX_ROUNDS = 10;
export const OVERVIEW_SCREEN = 99;
// Presencia de las pantallas compartidas (todas usan el enlace de solo lectura).
export const VIEW_SCREENS = { general: 99, publico: 98, orador: 97 };
export const FREE_ROUND = "libre";
// "totems": un tótem por candidato. "single": una pantalla para el público y otra
// para los candidatos, donde el moderador presenta a quien tiene la palabra.
export const SCREEN_MODES = ["totems", "single"];
const int = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AppError(`${label}: valor no válido.`);
  return value;
};
const text = (value, max, label, empty = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw new AppError(`${label}: texto no válido.`);
  return value.trim();
};
const enumValue = (v, options, fallback) =>
  options.includes(v) ? v : fallback;
const newCandidate = (id) => ({
  id,
  name: `Candidato ${id}`,
  duration: 120000,
  remaining: 120000,
  running: false,
  deadline: null,
  startedAt: null,
  spoken: {},
});
export const defaultRounds = () => [
  { id: "r1", name: "Presentación", duration: 180000 },
  { id: "r2", name: "Réplica", duration: 120000 },
  { id: "r3", name: "Cierre", duration: 60000 },
];
export const defaultState = () => ({
  event: "Debate al Rectorado · UNAMAD",
  warning: 30,
  sound: false,
  overtime: true,
  mode: "totems",
  stage: null,
  round: null,
  rounds: defaultRounds(),
  candidates: [1, 2, 3].map(newCandidate),
});
// Completa estados guardados por versiones anteriores (3 candidatos, sin rondas).
export function normalizeState(saved) {
  const base = defaultState();
  const s = { ...base, ...(saved && typeof saved === "object" ? saved : {}) };
  if (typeof s.overtime !== "boolean") s.overtime = base.overtime;
  if (!Array.isArray(s.rounds)) s.rounds = base.rounds;
  if (!s.rounds.some((r) => r.id === s.round)) s.round = null;
  const list =
    Array.isArray(s.candidates) && s.candidates.length
      ? s.candidates.slice(0, MAX_CANDIDATES)
      : base.candidates;
  s.candidates = list.map((c, i) => ({
    ...newCandidate(i + 1),
    ...c,
    id: i + 1,
    startedAt: c.running ? (c.startedAt ?? null) : null,
    spoken: c.spoken && typeof c.spoken === "object" ? c.spoken : {},
  }));
  if (!SCREEN_MODES.includes(s.mode)) s.mode = base.mode;
  if (
    !Number.isInteger(s.stage) ||
    s.stage < 1 ||
    s.stage > s.candidates.length
  )
    s.stage = null;
  return s;
}
export const remaining = (c, now) =>
  c.running ? c.deadline - now : c.remaining;
const roundKey = (s) => s.round ?? FREE_ROUND;
export function pause(c, now, s) {
  if (!c.running) return c;
  const end = s.overtime ? now : Math.min(now, c.deadline);
  const key = roundKey(s);
  const spoken = { ...c.spoken };
  spoken[key] = (spoken[key] || 0) + Math.max(0, end - (c.startedAt ?? end));
  const left = c.deadline - now;
  return {
    ...c,
    remaining: s.overtime ? left : Math.max(0, left),
    running: false,
    deadline: null,
    startedAt: null,
    spoken,
  };
}
export function cleanDesign(d = {}) {
  if (!d || typeof d !== "object" || Array.isArray(d))
    throw new AppError("Diseño no válido.");
  const image = (id) => {
    if (id === null || id === undefined || id === "") return null;
    if (typeof id !== "string" || !/^[-\da-f]{36}$/i.test(id))
      throw new AppError("Imagen no válida.");
    return id;
  };
  return {
    theme: enumValue(d.theme, ["light", "dark"], "dark"),
    layout: enumValue(d.layout, ["portrait", "flyer", "minimal"], "portrait"),
    backdrop: enumValue(
      d.backdrop,
      ["institutional", "solid"],
      "institutional",
    ),
    accent: /^#[\da-f]{6}$/i.test(d.accent) ? d.accent : "#d60050",
    role: text(d.role ?? "Postulante al Rectorado", 70, "Cargo", true),
    label: text(d.label ?? "CANDIDATO", 35, "Etiqueta", true),
    fit: enumValue(d.fit, ["cover", "contain"], "contain"),
    position: int(Number(d.position ?? 50), 0, 100, "Encuadre"),
    photo: image(d.photo),
    flyer: image(d.flyer),
  };
}
function cleanRounds(items) {
  if (!Array.isArray(items) || items.length > MAX_ROUNDS)
    throw new AppError(`Se permiten hasta ${MAX_ROUNDS} rondas.`);
  const used = new Set();
  return items.map((item, i) => {
    if (!item || typeof item !== "object") throw new AppError("Ronda no válida.");
    let id =
      typeof item.id === "string" && /^[a-z0-9]{1,12}$/.test(item.id)
        ? item.id
        : null;
    if (!id || id === FREE_ROUND || used.has(id)) {
      let n = i + 1;
      while (used.has("r" + n) || items.some((x) => x?.id === "r" + n)) n++;
      id = "r" + n;
    }
    used.add(id);
    return {
      id,
      name: text(item.name, 30, "Nombre de la ronda"),
      duration: int(item.duration, 1000, 3600000, "Duración de la ronda"),
    };
  });
}
export function reduceCommand(current, command, now) {
  if (!command || typeof command !== "object")
    throw new AppError("Comando no válido.");
  const s = normalizeState(structuredClone(current));
  const stopAll = () => {
    s.candidates = s.candidates.map((x) => pause(x, now, s));
  };
  if (!s.overtime)
    s.candidates = s.candidates.map((c) =>
      c.running && remaining(c, now) <= 0 ? pause(c, now, s) : c,
    );
  let c;
  if (["toggle", "reset", "adjust", "design"].includes(command.type)) {
    const id = int(command.id, 1, s.candidates.length, "Candidato");
    c = s.candidates[id - 1];
  }
  switch (command.type) {
    case "toggle":
      if (c.running) s.candidates[c.id - 1] = pause(c, now, s);
      else {
        if (!s.overtime && remaining(c, now) <= 0)
          throw new AppError("El tiempo terminó. Reinicia o agrega segundos.");
        s.candidates = s.candidates.map((x) =>
          x.id === c.id
            ? {
                ...x,
                running: true,
                deadline: now + x.remaining,
                startedAt: now,
              }
            : pause(x, now, s),
        );
        s.stage = c.id;
      }
      break;
    case "present": {
      const id =
        command.id === null
          ? null
          : int(command.id, 1, s.candidates.length, "Candidato");
      s.candidates = s.candidates.map((x) =>
        x.id === id ? x : pause(x, now, s),
      );
      s.stage = id;
      break;
    }
    case "pauseAll":
      stopAll();
      break;
    case "reset":
      s.candidates[c.id - 1] = {
        ...pause(c, now, s),
        remaining: c.duration,
      };
      break;
    case "resetAll": {
      const duration =
        command.duration === undefined
          ? null
          : int(command.duration, 1000, 3600000, "Duración");
      stopAll();
      s.candidates = s.candidates.map((x) => ({
        ...x,
        duration: duration ?? x.duration,
        remaining: duration ?? x.duration,
      }));
      break;
    }
    case "adjust": {
      const amount = int(command.ms, -300000, 300000, "Ajuste");
      const value = Math.max(
        s.overtime ? -7200000 : 0,
        Math.min(7200000, remaining(c, now) + amount),
      );
      s.candidates[c.id - 1] =
        c.running && value <= 0 && !s.overtime
          ? { ...pause(c, now, s), remaining: 0 }
          : {
              ...c,
              remaining: value,
              deadline: c.running ? now + value : null,
            };
      break;
    }
    case "sound":
      if (typeof command.value !== "boolean")
        throw new AppError("Sonido no válido.");
      s.sound = command.value;
      break;
    case "round": {
      const round =
        command.id === null ? null : s.rounds.find((r) => r.id === command.id);
      if (command.id !== null && !round)
        throw new AppError("La ronda no existe. Revisa la configuración.");
      stopAll();
      s.round = round?.id ?? null;
      if (round)
        s.candidates = s.candidates.map((x) => ({
          ...x,
          duration: round.duration,
          remaining: round.duration,
        }));
      break;
    }
    case "settings": {
      const event = text(command.event, 80, "Nombre del evento");
      const warning = int(command.warning, 1, 300, "Aviso");
      if (typeof command.overtime !== "boolean")
        throw new AppError("Tiempo excedido: valor no válido.");
      if (
        !Array.isArray(command.candidates) ||
        command.candidates.length < 1 ||
        command.candidates.length > MAX_CANDIDATES
      )
        throw new AppError(`Se permiten de 1 a ${MAX_CANDIDATES} candidatos.`);
      const rounds = cleanRounds(command.rounds ?? s.rounds);
      const mode = command.mode ?? s.mode;
      if (!SCREEN_MODES.includes(mode))
        throw new AppError("Modo de pantallas no válido.");
      const stage = s.stage;
      stopAll();
      const used = new Set();
      s.candidates = command.candidates.map((item, i) => {
        if (!item || typeof item !== "object")
          throw new AppError("Candidato no válido.");
        const previous =
          Number.isInteger(item.id) && !used.has(item.id)
            ? s.candidates.find((x) => x.id === item.id)
            : null;
        if (previous) used.add(previous.id);
        const duration = int(item.duration, 1000, 3600000, "Duración");
        return {
          ...(previous ?? newCandidate(i + 1)),
          id: i + 1,
          name: text(item.name, 50, "Nombre"),
          duration,
          remaining: duration,
          running: false,
          deadline: null,
          startedAt: null,
        };
      });
      s.event = event;
      s.warning = warning;
      s.overtime = command.overtime;
      s.mode = mode;
      s.stage =
        command.candidates.findIndex(
          (item) => Number.isInteger(item.id) && item.id === stage,
        ) + 1 || null;
      s.rounds = rounds;
      if (!rounds.some((r) => r.id === s.round)) s.round = null;
      break;
    }
    case "clearReport":
      s.candidates = s.candidates.map((x) => ({
        ...x,
        spoken: {},
        startedAt: x.running ? now : null,
      }));
      break;
    case "design":
      c.name = text(command.name, 50, "Nombre");
      c.design = cleanDesign(command.design);
      break;
    default:
      throw new AppError("Comando desconocido.");
  }
  return s;
}
