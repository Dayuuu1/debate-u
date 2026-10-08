"use strict";
window.Cloud = (() => {
  const params = new URLSearchParams(location.search),
    screen = Number(params.get("pantalla") || 0),
    key = "debate-screen-token-" + screen;
  let token = null;
  try {
    const fragment = new URLSearchParams(location.hash.slice(1));
    token = fragment.get("token") || sessionStorage.getItem(key);
    if (fragment.has("token")) {
      sessionStorage.setItem(key, token);
      history.replaceState(null, "", location.pathname + location.search);
    }
  } catch {}
  // Tótems: cada segundo si el panel del moderador estuvo abierto en los últimos
  // 10 minutos; si no, cada 30 s. El panel entra en reposo tras 3 h sin uso.
  const FAST = 1000,
    IDLE = 30000,
    MODERATOR_WINDOW = 600000,
    REST_AFTER = 10800000;
  let role = null,
    version = -1,
    state = null,
    lastSuccess = 0,
    offset = 0,
    busy = false,
    presence = [],
    onState = () => {},
    onConnection = () => {},
    links = [],
    delay = FAST,
    resting = false,
    lastActivity = Date.now();
  async function request(op, options = {}) {
    const t0 = Date.now();
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const headers = {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      };
      const r = await fetch(
        "/api/debate?op=" + op + (op === "state" ? "&screen=" + screen : ""),
        {
          credentials: "same-origin",
          cache: "no-store",
          ...options,
          headers,
          signal: controller.signal,
        },
      );
      const data = await r.json();
      if (data.serverNow) offset = data.serverNow - (t0 + Date.now()) / 2;
      if (!r.ok) {
        if (data.state) accept(data);
        const error = new Error(data.error || "Error del servidor.");
        error.status = r.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
  function accept(data) {
    if (data.state && data.version >= version) {
      version = data.version;
      state = data.state;
      onState(state);
    }
    if (data.role) {
      role = data.role;
      if (role === "display" && data.screen !== screen)
        throw new Error("El enlace no corresponde a este tótem.");
    }
    if (data.presence) presence = data.presence;
    lastSuccess = Date.now();
    onConnection();
  }
  async function refresh() {
    if (busy) return;
    try {
      accept(await request("state"));
    } catch (error) {
      lastSuccess = 0;
      onConnection();
      if (error.status === 401 && !screen) location.reload();
      throw error;
    }
  }
  async function command(command) {
    if (busy) throw new Error("Espera a que termine la acción anterior.");
    if (role !== "admin") throw new Error("Este enlace es de solo lectura.");
    busy = true;
    onConnection();
    try {
      const result = await request("command", {
        method: "POST",
        body: JSON.stringify({ version, command }),
      });
      accept(result);
      return result;
    } catch (e) {
      if (e.status !== 409) {
        lastSuccess = 0;
        refreshAfterError();
      }
      throw e;
    } finally {
      busy = false;
      onConnection();
    }
  }
  function refreshAfterError() {
    setTimeout(() => refresh().catch(() => {}), 100);
  }
  async function upload(blob) {
    if (role !== "admin") throw new Error("Inicia sesión como moderador.");
    const data = await new Promise((resolve, reject) => {
      const f = new FileReader();
      f.onload = () => resolve(String(f.result).split(",")[1]);
      f.onerror = reject;
      f.readAsDataURL(blob);
    });
    return (
      await request("upload", {
        method: "POST",
        body: JSON.stringify({ mime: blob.type, data }),
      })
    ).id;
  }
  async function image(id) {
    const r = await fetch("/api/debate?op=image&id=" + encodeURIComponent(id), {
      credentials: "same-origin",
      headers: token ? { Authorization: "Bearer " + token } : {},
      cache: "no-store",
    });
    if (!r.ok) throw new Error("No se pudo cargar la imagen.");
    return URL.createObjectURL(await r.blob());
  }
  async function getLinks() {
    const data = await request("links", { method: "POST", body: "{}" });
    links = data.links.map((x) => {
      const url = new URL(location.origin + "/");
      url.searchParams.set("pantalla", x.screen);
      url.hash = new URLSearchParams({ token: x.token }).toString();
      return { screen: x.screen, url: url.href };
    });
    return links;
  }
  function link(id) {
    return links.find((x) => x.screen === id)?.url;
  }
  async function init() {
    const box = document.getElementById("cloud-gate"),
      form = document.getElementById("login-form"),
      error = document.getElementById("login-error");
    async function load() {
      try {
        accept(await request("state"));
        if (
          screen &&
          role === "display" &&
          screen !== Number(params.get("pantalla"))
        )
          throw new Error("Enlace de tótem incorrecto.");
        if (!screen && role !== "admin")
          throw new Error("Usa el enlace de tu tótem.");
        if (role === "admin") await getLinks();
        box.hidden = true;
        return true;
      } catch (e) {
        error.textContent = e.message;
        box.hidden = false;
        form.hidden = !!screen || e.status !== 401;
        document.getElementById("cloud-retry").hidden =
          e.status === 401 && !screen;
        return false;
      }
    }
    if (await load()) return;
    await new Promise((resolve) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector("button");
        button.disabled = true;
        try {
          await request("login", {
            method: "POST",
            body: JSON.stringify({
              password: document.getElementById("admin-password").value,
            }),
          });
          document.getElementById("admin-password").value = "";
          if (await load()) resolve();
        } catch (e) {
          error.textContent = e.message;
        } finally {
          button.disabled = false;
        }
      };
      document.getElementById("cloud-retry").onclick = async () => {
        if (await load()) resolve();
      };
    });
  }
  function moderatorActive() {
    const seen = presence.find((p) => p.screen === 0);
    return !!seen && Date.now() + offset - seen.at < MODERATOR_WINDOW;
  }
  function shouldRest() {
    return (
      role === "admin" &&
      Date.now() - lastActivity > REST_AFTER &&
      !state?.candidates.some(
        (c) => c.running && c.deadline > Date.now() + offset,
      )
    );
  }
  function startPolling() {
    let timer,
      polling = false;
    const tick = async () => {
      clearTimeout(timer);
      if (polling) return;
      if (shouldRest()) {
        resting = true;
        lastSuccess = 0;
        onConnection();
        return;
      }
      polling = true;
      try {
        await refresh();
      } catch {}
      polling = false;
      delay = role === "admin" || moderatorActive() ? FAST : IDLE;
      timer = setTimeout(tick, delay);
    };
    if (role === "admin")
      for (const type of ["pointerdown", "pointermove", "keydown"])
        addEventListener(
          type,
          () => {
            lastActivity = Date.now();
            if (resting) {
              resting = false;
              tick();
            }
          },
          { capture: true, passive: true },
        );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !resting) tick();
    });
    timer = setTimeout(tick, FAST);
  }
  async function logout() {
    await request("logout", { method: "POST", body: "{}" });
    location.reload();
  }
  return {
    init,
    startPolling,
    refresh,
    command,
    upload,
    image,
    getLinks,
    link,
    logout,
    now: () => Date.now() + offset,
    setCallbacks: (stateFn, connectionFn) => {
      onState = stateFn;
      onConnection = connectionFn;
    },
    get state() {
      return state;
    },
    get role() {
      return role;
    },
    get busy() {
      return busy;
    },
    get connected() {
      return Date.now() - lastSuccess < delay + 7000;
    },
    get resting() {
      return resting;
    },
    get waiting() {
      return role === "display" && !moderatorActive();
    },
    get presence() {
      return presence;
    },
    get links() {
      return links;
    },
  };
})();
