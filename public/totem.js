"use strict";
(function (root) {
  const palette = ["#d60050"];
  function normalize(design = {}, id = 1) {
    const d = design && typeof design === "object" ? design : {};
    return {
      backdrop: d.backdrop === "solid" ? "solid" : "institutional",
      theme: d.theme === "light" ? "light" : "dark",
      layout: ["portrait", "flyer", "minimal"].includes(d.layout)
        ? d.layout
        : "portrait",
      accent: /^#[a-f\d]{6}$/i.test(d.accent)
        ? d.accent
        : palette[id - 1] || palette[0],
      role:
        typeof d.role === "string"
          ? d.role.slice(0, 70)
          : "Postulante al Rectorado",
      label:
        typeof d.label === "string"
          ? d.label.slice(0, 35)
          : "CANDIDATO " + String(id).padStart(2, "0"),
      fit: d.fit === "cover" ? "cover" : "contain",
      position: Number.isFinite(Number(d.position))
        ? Math.min(100, Math.max(0, Number(d.position)))
        : 50,
      photo: typeof d.photo === "string" ? d.photo : null,
      flyer: typeof d.flyer === "string" ? d.flyer : null,
    };
  }
  const stageHTML = () =>
    `<div class="totem-stage"><div class="totem-top"><div class="totem-university-banner"><img class="totem-crest" src="assets/unamad-escudo-oficial.png" alt="Escudo de la UNAMAD"><div class="totem-wordmark">UNAMAD<span>Universidad Nacional Amazónica<br>de Madre de Dios</span></div></div><div class="totem-event-ribbon"><span class="totem-event"></span></div></div><div class="totem-art"><div class="totem-pattern"></div><img class="totem-image" alt="" hidden><div class="totem-placeholder"><svg viewBox="0 0 160 190" fill="none" aria-hidden="true"><circle cx="80" cy="57" r="32" fill="currentColor"/><path d="M15 182v-17a65 65 0 0 1 130 0v17" fill="currentColor"/></svg><span>FOTO DEL CANDIDATO</span></div><div class="totem-art-edge"></div></div><div class="totem-identity"><div class="totem-label"></div><h2 class="totem-name"></h2><p class="totem-role"></p></div><div class="totem-clock-block"><div class="totem-time-caption">TIEMPO RESTANTE</div><div class="totem-time">02:00</div><div class="totem-state"><i></i><span>LISTO PARA INICIAR</span></div><div class="totem-track"><div></div></div></div><div class="totem-footer"><span>UNAMAD</span><span>DIÁLOGO · RESPETO · IDEAS</span></div></div>`;
  const assetCache = new Map();
  async function putImage(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new Error("Selecciona una imagen JPG, PNG o WebP.");
    if (file.size > 25 * 1024 * 1024)
      throw new Error("La imagen supera 25 MB. Elige una versión más pequeña.");
    const source = URL.createObjectURL(file);
    let img = new Image();
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("No se pudo leer esta imagen."));
        img.src = source;
      });
      const scale = Math.min(1, 2160 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.9),
      );
      if (!blob) throw new Error("No se pudo preparar la imagen.");
      if (blob.size > 2000000)
        throw new Error(
          "La imagen comprimida supera 2 MB. Usa una imagen más pequeña.",
        );
      return await root.Cloud.upload(blob);
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  async function getImage(id) {
    if (!id) return null;
    if (assetCache.has(id)) return assetCache.get(id);
    const promise = root.Cloud.image(id).catch((e) => {
      assetCache.delete(id);
      throw e;
    });
    assetCache.set(id, promise);
    return promise;
  }
  function paintStage(stage, c, event, ms, status, mood, caption) {
    const d = normalize(c.design, c.id);
    stage.className = `totem-stage theme-${d.theme} layout-${d.layout} backdrop-${d.backdrop} ${mood || ""}`;
    stage.style.setProperty("--totem-accent", d.accent);
    const set = (selector, text) => {
      const el = stage.querySelector(selector);
      if (el.textContent !== text) el.textContent = text;
    };
    set(".totem-event", event);
    set(".totem-time-caption", caption || "TIEMPO RESTANTE");
    set(".totem-label", d.label);
    set(".totem-name", c.name);
    set(".totem-role", d.role);
    set(".totem-time", root.TimerCore.format(ms));
    set(".totem-state span", status);
    stage.querySelector(".totem-track div").style.width =
      Math.min(100, Math.max(0, (ms / c.duration) * 100)) + "%";
    const nameSize =
      d.layout === "minimal"
        ? c.name.length > 35
          ? "6cqw"
          : "8cqw"
        : d.layout === "flyer"
          ? c.name.length > 35
            ? "3.5cqw"
            : "4cqw"
          : c.name.length > 35
            ? "4.6cqw"
            : c.name.length > 22
              ? "5.3cqw"
              : "6.1cqw";
    stage.querySelector(".totem-name").style.fontSize = nameSize;
    const img = stage.querySelector(".totem-image");
    img.style.objectFit = d.layout === "portrait" ? "cover" : d.fit;
    img.style.objectPosition = "50% " + d.position + "%";
    const asset =
      d.layout === "minimal"
        ? ""
        : d[d.layout === "flyer" ? "flyer" : "photo"] || "";
    img.alt =
      d.layout === "flyer" ? "Flyer de " + c.name : "Fotografía de " + c.name;
    if (!asset)
      set(
        ".totem-placeholder span",
        d.layout === "flyer" ? "TU FLYER AQUÍ" : "FOTO DEL CANDIDATO",
      );
    if (stage.dataset.asset !== asset) {
      stage.dataset.asset = asset;
      img.hidden = true;
      img.removeAttribute("src");
      stage.classList.remove("has-image");
      set(
        ".totem-placeholder span",
        d.layout === "flyer" ? "TU FLYER AQUÍ" : "FOTO DEL CANDIDATO",
      );
      if (asset)
        getImage(asset)
          .then((url) => {
            if (stage.dataset.asset !== asset) return;
            if (url) {
              img.src = url;
              img.alt =
                d.layout === "flyer"
                  ? "Flyer de " + c.name
                  : "Fotografía de " + c.name;
              img.hidden = false;
              stage.classList.add("has-image");
            } else set(".totem-placeholder span", "IMAGEN NO DISPONIBLE");
          })
          .catch(() => {
            if (stage.dataset.asset === asset) {
              set(".totem-placeholder span", "REINTENTANDO IMAGEN…");
              setTimeout(() => {
                if (stage.dataset.asset === asset) delete stage.dataset.asset;
              }, 3000);
            }
          });
    } else if (!img.hidden) {
      stage.classList.add("has-image");
    }
  }
  root.Totem = { normalize, stageHTML, paintStage, putImage };
})(typeof module !== "undefined" ? module.exports : window);
