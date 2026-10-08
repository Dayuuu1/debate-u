(function (root) {
  const FREE_ROUND = "libre";
  // Negativo = tiempo excedido; sin "overtime" se detiene en 00:00.
  const remaining = (c, now = Date.now(), overtime = true) => {
    const ms = c.running ? c.deadline - now : c.remaining;
    return overtime ? ms : Math.max(0, ms);
  };
  const clock = (n) =>
    String(Math.floor(n / 60)).padStart(2, "0") +
    ":" +
    String(n % 60).padStart(2, "0");
  const format = (ms) =>
    ms < 0 ? "+" + clock(Math.floor(-ms / 1000)) : clock(Math.ceil(ms / 1000));
  const elapsed = (ms) => clock(Math.floor(Math.max(0, ms) / 1000));
  // Tiempo en uso de la palabra de un candidato en una ronda, incluido el turno en curso.
  const spoken = (s, c, key, now = Date.now()) => {
    let ms = c.spoken?.[key] || 0;
    if (c.running && c.startedAt && key === (s.round ?? FREE_ROUND)) {
      const end = s.overtime ? now : Math.min(now, c.deadline);
      ms += Math.max(0, end - c.startedAt);
    }
    return ms;
  };
  root.TimerCore = { FREE_ROUND, remaining, format, elapsed, spoken };
})(typeof module !== "undefined" ? module.exports : window);
