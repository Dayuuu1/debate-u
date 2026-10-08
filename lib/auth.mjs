import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { AppError, MAX_CANDIDATES } from "./state.mjs";
export function requireConfig() {
  const env = process.env;
  const missing = [
    !env.DATABASE_URL && "DATABASE_URL",
    (env.SESSION_SECRET?.length ?? 0) < 32 &&
      "SESSION_SECRET (mínimo 32 caracteres)",
    (env.ADMIN_PASSWORD?.length ?? 0) < 12 &&
      "ADMIN_PASSWORD (mínimo 12 caracteres)",
  ].filter(Boolean);
  if (missing.length)
    throw new AppError(
      `Falta configurar en el servidor: ${missing.join(", ")}. Después de corregirlo, vuelve a desplegar.`,
      503,
    );
}
const equal = (a, b) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export function correctPassword(password) {
  return (
    typeof password === "string" &&
    equal(
      createHash("sha256").update(password).digest("hex"),
      createHash("sha256").update(process.env.ADMIN_PASSWORD).digest("hex"),
    )
  );
}
export function signToken(payload, ttl, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now + ttl }),
  ).toString("base64url");
  const sig = createHmac("sha256", process.env.SESSION_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}
export function verifyToken(token, now = Date.now()) {
  try {
    if (typeof token !== "string" || token.length > 1500) return null;
    const [body, sig, extra] = token.split(".");
    if (extra || !body || !sig) return null;
    const expected = createHmac("sha256", process.env.SESSION_SECRET)
      .update(body)
      .digest("base64url");
    if (!equal(sig, expected)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url"));
    if (!Number.isFinite(data.exp) || data.exp <= now) return null;
    if (data.role === "admin" || data.role === "overview") return data;
    if (
      data.role === "display" &&
      Number.isInteger(data.screen) &&
      data.screen >= 1 &&
      data.screen <= MAX_CANDIDATES
    )
      return data;
    return null;
  } catch {
    return null;
  }
}
export function identity(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer /, "");
  if (bearer) return verifyToken(bearer);
  const value = (req.headers.cookie ?? "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("debate_session="))
    ?.slice(15);
  return verifyToken(value);
}
export function cookie(value, maxAge = 43200) {
  return `debate_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.VERCEL ? "; Secure" : ""}`;
}
export function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) throw new AppError("Solicitud sin origen válido.", 403);
  try {
    if (new URL(origin).host !== host) throw new Error();
  } catch {
    throw new AppError("Origen no permitido.", 403);
  }
}
export function loginKey(req) {
  const ip = (
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ).toString();
  return createHmac("sha256", process.env.SESSION_SECRET)
    .update(ip)
    .digest("hex");
}
