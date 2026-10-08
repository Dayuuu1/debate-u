export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
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
export const defaultState = () => ({
  event: "Debate al Rectorado · UNAMAD",
  warning: 30,
  sound: false,
  candidates: [1, 2, 3].map((id) => ({
    id,
    name: `Candidato ${id}`,
    duration: 120000,
    remaining: 120000,
    running: false,
    deadline: null,
  })),
});
export const remaining = (c, now) =>
  Math.max(0, c.running ? c.deadline - now : c.remaining);
export function pause(c, now) {
  return { ...c, remaining: remaining(c, now), running: false, deadline: null };
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
export function reduceCommand(current, command, now) {
  if (!command || typeof command !== "object")
    throw new AppError("Comando no válido.");
  const s = structuredClone(current);
  s.candidates = s.candidates.map((c) =>
    c.running && remaining(c, now) === 0 ? pause(c, now) : c,
  );
  let c;
  if (["toggle", "reset", "adjust", "design"].includes(command.type)) {
    const id = int(command.id, 1, 3, "Candidato");
    c = s.candidates[id - 1];
  }
  switch (command.type) {
    case "toggle":
      if (c.running) s.candidates[c.id - 1] = pause(c, now);
      else {
        if (remaining(c, now) <= 0)
          throw new AppError("El tiempo terminó. Reinicia o agrega segundos.");
        s.candidates = s.candidates.map((x) =>
          x.id === c.id
            ? { ...x, running: true, deadline: now + remaining(x, now) }
            : pause(x, now),
        );
      }
      break;
    case "pauseAll":
      s.candidates = s.candidates.map((x) => pause(x, now));
      break;
    case "reset":
      s.candidates[c.id - 1] = {
        ...c,
        remaining: c.duration,
        running: false,
        deadline: null,
      };
      break;
    case "resetAll": {
      const duration =
        command.duration === undefined
          ? null
          : int(command.duration, 1000, 3600000, "Duración");
      s.candidates = s.candidates.map((x) => ({
        ...x,
        duration: duration ?? x.duration,
        remaining: duration ?? x.duration,
        running: false,
        deadline: null,
      }));
      break;
    }
    case "adjust": {
      const amount = int(command.ms, -300000, 300000, "Ajuste");
      const value = Math.max(0, Math.min(7200000, remaining(c, now) + amount));
      s.candidates[c.id - 1] = {
        ...c,
        remaining: value,
        running: c.running && value > 0,
        deadline: c.running && value > 0 ? now + value : null,
      };
      break;
    }
    case "sound":
      if (typeof command.value !== "boolean")
        throw new AppError("Sonido no válido.");
      s.sound = command.value;
      break;
    case "settings":
      s.event = text(command.event, 80, "Nombre del evento");
      s.warning = int(command.warning, 1, 300, "Aviso");
      if (!Array.isArray(command.candidates) || command.candidates.length !== 3)
        throw new AppError("Se requieren tres candidatos.");
      s.candidates = s.candidates.map((x, i) => {
        const item = command.candidates[i],
          duration = int(item.duration, 1000, 3600000, "Duración");
        return {
          ...x,
          name: text(item.name, 50, "Nombre"),
          duration,
          remaining: duration,
          running: false,
          deadline: null,
        };
      });
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
