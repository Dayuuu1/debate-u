(function (root) {
  const remaining = (c, now = Date.now()) =>
    Math.max(0, c.running ? c.deadline - now : c.remaining);
  const pause = (c, now = Date.now()) => ({
    ...c,
    remaining: remaining(c, now),
    running: false,
    deadline: null,
  });
  const start = (s, id, now = Date.now()) => ({
    ...s,
    candidates: s.candidates.map((c) =>
      c.id === id
        ? {
            ...c,
            remaining: remaining(c, now),
            running: remaining(c, now) > 0,
            deadline: remaining(c, now) > 0 ? now + remaining(c, now) : null,
          }
        : pause(c, now),
    ),
  });
  const adjust = (c, ms, now = Date.now()) => {
    const value = Math.max(0, remaining(c, now) + ms);
    return {
      ...c,
      remaining: value,
      running: c.running && value > 0,
      deadline: c.running && value > 0 ? now + value : null,
    };
  };
  const format = (ms) => {
    const n = Math.ceil(Math.max(0, ms) / 1000);
    return (
      String(Math.floor(n / 60)).padStart(2, "0") +
      ":" +
      String(n % 60).padStart(2, "0")
    );
  };
  root.TimerCore = { remaining, pause, start, adjust, format };
})(typeof module !== "undefined" ? module.exports : window);
