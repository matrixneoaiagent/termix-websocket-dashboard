/* Reconnect dashboard client: exponential backoff, heartbeat/latency, force drop, pause. */
(() => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const attemptEl = $("attempt");
  const latencyEl = $("latency");
  const lastEl = $("last");
  const countdownEl = $("countdown");
  const rowsEl = $("rows");
  const chart = $("chart");
  const ctx = chart.getContext("2d");

  const MAX_ROWS = 12;
  const MAX_BACKOFF_MS = 10000;
  const HEARTBEAT_MS = 5000;

  let ws = null;
  let attempt = 0;
  let paused = false;
  let reconnectTimer = null;
  let countdownTimer = null;
  let heartbeatTimer = null;
  let pingSentAt = 0;
  let values = [];
  let seq = 0;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "status " + cls;
  }

  function fmtTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleTimeString([], { hour12: false }) + "." +
      String(ms % 1000).padStart(3, "0");
  }

  function drawChart() {
    const w = chart.width, h = chart.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#273a33";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (h - 16) * i / 4 + 8;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    if (values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values);
    const span = Math.max(1, max - min);
    ctx.strokeStyle = "#5fd3a6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (w - 12) * i / (values.length - 1) + 6;
      const y = h - 10 - ((v - min) / span) * (h - 26);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#5fd3a6";
    const last = values[values.length - 1];
    const x = w - 6, y = h - 10 - ((last - min) / span) * (h - 26);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }

  function addRow(tick) {
    const tr = document.createElement("tr");
    const cells = [tick.seq, tick.value.toFixed(2), fmtTime(tick.ts)];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    rowsEl.prepend(tr);
    while (rowsEl.children.length > MAX_ROWS) rowsEl.lastChild.remove();
    values.push(tick.value);
    while (values.length > 60) values.shift();
    drawChart();
    lastEl.textContent = fmtTime(tick.ts);
    seq = tick.seq;
  }

  function stopTimers() {
    clearTimeout(reconnectTimer);
    clearInterval(countdownTimer);
    clearInterval(heartbeatTimer);
    reconnectTimer = countdownTimer = heartbeatTimer = null;
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pingSentAt = performance.now();
      ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    }, HEARTBEAT_MS);
  }

  function scheduleReconnect() {
    if (paused) return;
    attempt += 1;
    attemptEl.textContent = String(attempt);
    const delay = Math.min(MAX_BACKOFF_MS, 500 * Math.pow(2, Math.min(attempt - 1, 5)));
    setStatus("Reconnecting…", "reconnecting");
    let left = Math.ceil(delay / 1000);
    countdownEl.textContent = left + "s";
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      left -= 1;
      countdownEl.textContent = left > 0 ? left + "s" : "now";
    }, 1000);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (paused) return;
    stopTimers();
    countdownEl.textContent = "—";
    setStatus("Connecting…", "connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener("open", () => {
      attempt = 0;
      attemptEl.textContent = "0";
      setStatus("Connected", "connected");
      startHeartbeat();
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "tick") addRow(msg);
      if (msg.type === "pong" && pingSentAt) {
        const rtt = Math.max(0, Math.round(performance.now() - pingSentAt));
        latencyEl.textContent = rtt + " ms";
      }
    });

    ws.addEventListener("close", () => {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (!paused) scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      try { ws.close(); } catch {}
    });
  }

  $("drop").addEventListener("click", () => {
    if (ws) ws.close();
  });

  $("pause").addEventListener("click", () => {
    paused = !paused;
    const btn = $("pause");
    if (paused) {
      stopTimers();
      if (ws) ws.close();
      setStatus("Paused", "paused");
      countdownEl.textContent = "—";
      btn.textContent = "Resume";
    } else {
      btn.textContent = "Pause";
      attempt = 0;
      connect();
    }
  });

  drawChart();
  connect();
})();
