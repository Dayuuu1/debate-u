import { randomUUID } from "node:crypto";
import { AppError, reduceCommand } from "./state.mjs";
import {
  requireConfig,
  identity,
  sameOrigin,
  loginKey,
  correctPassword,
  signToken,
  cookie,
} from "./auth.mjs";
const LIMIT = 2900000;
async function body(req) {
  let value;
  try {
    // Vercel interpreta el cuerpo (puede ser null o lanzar si el JSON es inválido).
    value = req.body;
  } catch {
    throw new AppError("JSON no válido.");
  }
  if (value === undefined) {
    value = "";
    for await (const chunk of req) {
      value += chunk;
      if (value.length > LIMIT)
        throw new AppError("Carga demasiado grande.", 413);
    }
  }
  if (typeof value === "string")
    try {
      value = JSON.parse(value || "{}");
    } catch {
      throw new AppError("JSON no válido.");
    }
  if (!value || typeof value !== "object")
    throw new AppError("JSON no válido.");
  if (JSON.stringify(value).length > LIMIT)
    throw new AppError("Carga demasiado grande.", 413);
  return value;
}
const json = (res, status, data) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
};
function validateImage(data, mime) {
  if (
    typeof data !== "string" ||
    data.length > 2800000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new AppError("Imagen no válida o demasiado grande.");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > 2000000)
    throw new AppError("La imagen comprimida debe pesar menos de 2 MB.");
  const valid =
    (mime === "image/png" &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "image/jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255) ||
    (mime === "image/webp" &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP");
  if (!valid) throw new AppError("Formato de imagen no válido.");
}
export function createHandler(getDB) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      requireConfig();
      const url = new URL(req.url, "http://local"),
        op = url.searchParams.get("op") || "state";
      const method = req.method;
      if (!["GET", "POST"].includes(method))
        throw new AppError("Método no permitido.", 405);
      if (method === "POST") sameOrigin(req);
      const db = getDB();
      if (op === "login" && method === "POST") {
        const input = await body(req),
          key = loginKey(req);
        if (!(await db.allowLogin(key)))
          throw new AppError("Demasiados intentos. Espera 10 minutos.", 429);
        if (!correctPassword(input.password))
          throw new AppError("Contraseña incorrecta.", 401);
        await db.clearLogin(key);
        res.setHeader(
          "Set-Cookie",
          cookie(signToken({ role: "admin" }, 12 * 3600000)),
        );
        return json(res, 200, { ok: true });
      }
      const user = identity(req);
      if (!user)
        throw new AppError(
          "Inicia sesión o usa un enlace de tótem válido.",
          401,
        );
      if (op === "logout" && method === "POST") {
        res.setHeader("Set-Cookie", cookie("", 0));
        return json(res, 200, { ok: true });
      }
      if (op === "state" && method === "GET") {
        const requested = Number(url.searchParams.get("screen") || 0),
          screen =
            user.role === "display"
              ? user.screen
              : [1, 2, 3].includes(requested)
                ? requested
                : 0;
        return json(res, 200, {
          ...(await db.poll(screen)),
          role: user.role,
          screen: user.screen ?? null,
        });
      }
      if (op === "image" && method === "GET") {
        const id = url.searchParams.get("id");
        if (!/^[-\da-f]{36}$/i.test(id || ""))
          throw new AppError("Imagen no válida.");
        const image = await db.image(id);
        if (!image) throw new AppError("Imagen no encontrada.", 404);
        res.setHeader("Content-Type", image.mime);
        return res.end(Buffer.from(image.data, "base64"));
      }
      if (user.role !== "admin")
        throw new AppError(
          "Este enlace solo permite visualizar el tótem.",
          403,
        );
      if (op === "links" && method === "POST") {
        return json(res, 200, {
          links: [1, 2, 3].map((screen) => ({
            screen,
            token: signToken({ role: "display", screen }, 30 * 86400000),
          })),
          expiresInDays: 30,
        });
      }
      if (op === "upload" && method === "POST") {
        const input = await body(req);
        validateImage(input.data, input.mime);
        const id = randomUUID();
        await db.storeImage(id, input.mime, input.data);
        return json(res, 200, { id });
      }
      if (op === "command" && method === "POST") {
        const input = await body(req);
        if (!Number.isInteger(input.version) || input.version < 0)
          throw new AppError("Versión no válida.");
        const snap = await db.snapshot();
        if (snap.version !== input.version)
          return json(res, 409, {
            error:
              "El debate cambió desde otro panel. Revisa el estado y repite la acción.",
            ...snap,
          });
        const next = reduceCommand(snap.state, input.command, snap.serverNow);
        if (input.command.type === "design") {
          for (const id of [
            next.candidates[input.command.id - 1].design.photo,
            next.candidates[input.command.id - 1].design.flyer,
          ])
            if (id && !(await db.imageExists(id)))
              throw new AppError("La imagen no existe. Vuelve a cargarla.");
        }
        const result = await db.compareAndSet(snap.version, next);
        if (!result)
          return json(res, 409, {
            error:
              "Otro moderador actualizó el debate. Revisa el estado y repite la acción.",
            ...(await db.snapshot()),
          });
        return json(res, 200, result);
      }
      throw new AppError("Ruta no encontrada.", 404);
    } catch (error) {
      const known = error instanceof AppError;
      if (!known)
        console.error(
          "Debate API failure:",
          error.name,
          error.code ?? "SERVER_ERROR",
        );
      return json(res, known ? error.status : 500, {
        error: known
          ? error.message
          : "No se pudo acceder a la base de datos. Revisa la conexión y ejecuta npm run db:setup.",
      });
    }
  };
}
