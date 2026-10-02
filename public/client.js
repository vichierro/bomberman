const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const mini = document.querySelector("#mini");
const miniCtx = mini.getContext("2d");
const overlay = document.querySelector("#overlay");
const toast = document.querySelector("#toast");
const nameInput = document.querySelector("#name");
const soundBtn = document.querySelector("#sound");
const playersEl = document.querySelector("#players");
const feedEl = document.querySelector("#feed");
const selfEl = document.querySelector("#self");
const nextEl = document.querySelector("#next-block");
const statPlayers = document.querySelector("#stat-players");
const statMap = document.querySelector("#stat-map");
const statBlocks = document.querySelector("#stat-blocks");

const input = { up: false, down: false, left: false, right: false, bomb: false };
const shown = new Map();
let ws;
let state = null;
let tiles = "";
let mapW = 0;
let mapH = 0;
let you = 0;
let soundOn = false;
let audio;
let lastMap = "";
let toastTimer = 0;
let shake = 0;

nameInput.value = localStorage.getItem("bomber-name") || "";

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}`);
  ws.onopen = () => {
    if (nameInput.value.trim()) sendName();
    sendInput();
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "full") {
      overlay.hidden = false;
      overlay.textContent = "A arena está cheia.";
      return;
    }
    applyState(msg);
  };
  ws.onclose = () => {
    overlay.hidden = false;
    overlay.textContent = "Conexão perdida. Entrando de novo…";
    setTimeout(connect, 1000);
  };
}

function applyState(msg) {
  you = msg.you;
  if (msg.tiles) {
    tiles = msg.tiles;
    mapW = msg.w;
    mapH = msg.h;
  } else if (msg.w && msg.h && (msg.w !== mapW || msg.h !== mapH)) {
    mapW = msg.w;
    mapH = msg.h;
  }
  const key = `${msg.w}×${msg.h}`;
  if (lastMap && key !== lastMap) showToast(`O mapa cresceu para ${key}`);
  if (msg.w) lastMap = key;
  state = msg;
  const aliveIds = new Set();
  for (const player of msg.players) {
    aliveIds.add(player.id);
    const prev = shown.get(player.id);
    if (!prev || Math.hypot(player.x - prev.x, player.y - prev.y) > 2.4) {
      shown.set(player.id, { ...player });
    } else {
      prev.targetX = player.x;
      prev.targetY = player.y;
      prev.alive = player.alive;
      prev.invuln = player.invuln;
      prev.color = player.color;
      prev.name = player.name;
    }
    if (!shown.get(player.id).targetX) {
      const view = shown.get(player.id);
      view.targetX = player.x;
      view.targetY = player.y;
    }
  }
  for (const id of shown.keys()) if (!aliveIds.has(id)) shown.delete(id);
  const me = msg.players.find((player) => player.id === you);
  if (me && !me.alive) {
    overlay.hidden = false;
    overlay.textContent = `Você explodiu. Voltando em ${(me.respawnIn / 1000).toFixed(1)}s`;
  } else if (ws?.readyState === 1) {
    overlay.hidden = true;
  }
  renderHud(msg);
  if (msg.blasts?.length) {
    const me = msg.players.find((player) => player.id === you);
    if (me) {
      const near = msg.blasts.some(
        (blast) => Math.abs(blast.x + 0.5 - me.x) < 3 && Math.abs(blast.y + 0.5 - me.y) < 3,
      );
      if (near) shake = Math.max(shake, 5);
    }
  }
}

function renderHud(msg) {
  statPlayers.textContent = `Jogadores: ${msg.players.length}`;
  statMap.textContent = `Mapa: ${msg.w}×${msg.h}`;
  statBlocks.textContent = `Blocos quebrados: ${msg.broken}`;
  const me = msg.players.find((player) => player.id === you);
  if (me) {
    selfEl.textContent = me.alive
      ? `${me.name} · ${me.kills} abate${me.kills === 1 ? "" : "s"} · bombas ${me.maxBombs - me.bombs}/${me.maxBombs} · alcance ${me.range}`
      : `${me.name} explodiu. Voltando em ${(me.respawnIn / 1000).toFixed(1)}s`;
  }
  if (msg.next == null) nextEl.textContent = "Nenhum bloco quebrado.";
  else if (msg.next === 0) nextEl.textContent = "O bloco mais antigo volta assim que a casa liberar.";
  else nextEl.textContent = `O bloco mais antigo volta em ${formatMs(msg.next)}.`;
  playersEl.replaceChildren(
    ...msg.players.map((player) => {
      const li = document.createElement("li");
      if (!player.alive) li.className = "dead";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = player.color;
      li.append(swatch, document.createTextNode(`${player.name} · ${player.kills}`));
      if (player.id === you) li.append(document.createTextNode(" · você"));
      return li;
    }),
  );
  feedEl.replaceChildren(
    ...(msg.feed.length ? msg.feed : ["A arena está quieta."]).map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function showToast(text) {
  toast.hidden = false;
  toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function sendInput() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "input", ...input }));
}

function sendName() {
  if (!ws || ws.readyState !== 1) return;
  const name = nameInput.value.trim();
  localStorage.setItem("bomber-name", name);
  ws.send(JSON.stringify({ type: "name", name }));
}

const keys = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  a: "left",
  s: "down",
  d: "right",
  W: "up",
  A: "left",
  S: "down",
  D: "right",
};

addEventListener("keydown", (event) => {
  if (event.target === nameInput) return;
  const dir = keys[event.key];
  if (dir) {
    event.preventDefault();
    input[dir] = true;
    sendInput();
  }
  if (event.code === "Space" || event.key === "x" || event.key === "X") {
    event.preventDefault();
    if (!input.bomb) blip(520, 0.05);
    input.bomb = true;
    sendInput();
  }
});

addEventListener("keyup", (event) => {
  const dir = keys[event.key];
  if (dir) {
    input[dir] = false;
    sendInput();
  }
  if (event.code === "Space" || event.key === "x" || event.key === "X") {
    input.bomb = false;
    sendInput();
  }
});

for (const button of document.querySelectorAll("[data-dir]")) {
  const dir = button.dataset.dir;
  const press = (event) => {
    event.preventDefault();
    input[dir] = true;
    sendInput();
  };
  const release = (event) => {
    event.preventDefault();
    input[dir] = false;
    sendInput();
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("pointercancel", release);
}

const bombBtn = document.querySelector("#bomb");
bombBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  input.bomb = true;
  blip(520, 0.05);
  sendInput();
});
const releaseBomb = (event) => {
  event.preventDefault();
  input.bomb = false;
  sendInput();
};
bombBtn.addEventListener("pointerup", releaseBomb);
bombBtn.addEventListener("pointerleave", releaseBomb);

nameInput.addEventListener("change", sendName);
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? "Som: on" : "Som: off";
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  if (soundOn) audioCtx();
});

setInterval(sendInput, 50);
connect();

function audioCtx() {
  if (!audio) audio = new AudioContext();
  if (audio.state === "suspended") audio.resume();
  return audio;
}

function blip(freq, seconds) {
  if (!soundOn) return;
  const ctxAudio = audioCtx();
  const osc = ctxAudio.createOscillator();
  const gain = ctxAudio.createGain();
  osc.frequency.value = freq;
  gain.gain.value = 0.04;
  osc.connect(gain).connect(ctxAudio.destination);
  osc.start();
  osc.stop(ctxAudio.currentTime + seconds);
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

addEventListener("resize", resize);
new ResizeObserver(resize).observe(document.querySelector("#board"));
resize();

function loop() {
  requestAnimationFrame(loop);
  const dt = 1 / 60;
  for (const view of shown.values()) {
    const tx = view.targetX ?? view.x;
    const ty = view.targetY ?? view.y;
    view.x += (tx - view.x) * Math.min(1, dt * 16);
    view.y += (ty - view.y) * Math.min(1, dt * 16);
  }
  if (shake > 0) shake *= 0.86;
  draw();
}
requestAnimationFrame(loop);

function tileAt(index) {
  return tiles[index] || ".";
}

function draw() {
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.max(1, Math.floor(viewW * dpr)) ||
    canvas.height !== Math.max(1, Math.floor(viewH * dpr))
  ) {
    resize();
  }
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.fillStyle = "#0c1017";
  ctx.fillRect(0, 0, viewW, viewH);
  if (!state || !mapW || !tiles) return;

  const fit = Math.min((viewW - 16) / mapW, (viewH - 16) / mapH);
  const follow = fit < 28;
  const tile = follow ? 36 : Math.min(52, fit);
  const mapPxW = mapW * tile;
  const mapPxH = mapH * tile;
  const me = shown.get(you);
  let camX = (viewW - mapPxW) / 2;
  let camY = (viewH - mapPxH) / 2;
  if (follow && me) {
    camX = viewW / 2 - me.x * tile;
    camY = viewH / 2 - me.y * tile;
    camX = Math.min(8, Math.max(viewW - mapPxW - 8, camX));
    camY = Math.min(8, Math.max(viewH - mapPxH - 8, camY));
  }
  if (shake > 0.4 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    camX += (Math.random() - 0.5) * shake;
    camY += (Math.random() - 0.5) * shake;
  }

  ctx.save();
  ctx.translate(camX, camY);
  drawArena(ctx, tile, true);
  ctx.restore();
  drawMini();
}

function drawArena(context, tile, detailed) {
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const kind = tileAt(y * mapW + x);
      const px = x * tile;
      const py = y * tile;
      if (kind !== "#") {
        context.fillStyle = (x + y) % 2 === 0 ? "#2f8d45" : "#277a3b";
        context.fillRect(px, py, tile, tile);
      }
      if (kind === "#") drawHard(context, px, py, tile, detailed);
      else if (kind === "o") drawSoft(context, px, py, tile, detailed);
    }
  }
  if (detailed && state.soon) {
    for (const block of state.soon) {
      const alpha = 1 - Math.min(1, block.left / 20000);
      context.save();
      context.globalAlpha = 0.18 + alpha * 0.45;
      drawSoft(context, block.x * tile, block.y * tile, tile, true);
      context.restore();
      if (block.left < 10000) {
        context.fillStyle = "#fff4d2";
        context.font = `${Math.max(10, tile * 0.28)}px Trebuchet MS, sans-serif`;
        context.textAlign = "center";
        context.fillText(String(Math.ceil(block.left / 1000)), block.x * tile + tile / 2, block.y * tile + tile * 0.62);
      }
    }
  }
  for (const bomb of state.bombs || []) drawBomb(context, bomb, tile, detailed);
  for (const player of state.players) {
    if (!player.alive) continue;
    const view = shown.get(player.id) || player;
    drawPlayer(context, view.x * tile, view.y * tile, tile, player, player.id === you, detailed);
  }
  for (const blast of state.blasts || []) drawBlast(context, blast, tile);
}

function drawHard(context, x, y, tile, detailed) {
  context.fillStyle = "#4e6078";
  context.fillRect(x, y, tile, tile);
  if (!detailed) return;
  context.fillStyle = "#7f93ab";
  context.fillRect(x, y, tile, 4);
  context.fillStyle = "#2a3648";
  context.fillRect(x, y + tile - 4, tile, 4);
  context.fillStyle = "#9aadc4";
  const inset = Math.max(3, tile * 0.16);
  context.fillRect(x + inset, y + inset, 3, 3);
  context.fillRect(x + tile - inset - 3, y + inset, 3, 3);
  context.fillRect(x + inset, y + tile - inset - 3, 3, 3);
  context.fillRect(x + tile - inset - 3, y + tile - inset - 3, 3, 3);
}

function drawSoft(context, x, y, tile, detailed) {
  const pad = Math.max(2, tile * 0.08);
  context.fillStyle = "#a8642e";
  context.fillRect(x + pad, y + pad, tile - pad * 2, tile - pad * 2);
  if (!detailed) return;
  context.fillStyle = "#d5924e";
  context.fillRect(x + pad, y + pad, tile - pad * 2, 4);
  context.strokeStyle = "#6d3e18";
  context.lineWidth = Math.max(2, tile * 0.06);
  context.beginPath();
  context.moveTo(x + pad + 3, y + pad + 3);
  context.lineTo(x + tile - pad - 3, y + tile - pad - 3);
  context.moveTo(x + tile - pad - 3, y + pad + 3);
  context.lineTo(x + pad + 3, y + tile - pad - 3);
  context.stroke();
}

function drawBomb(context, bomb, tile, detailed) {
  const cx = bomb.x * tile + tile / 2;
  const cy = bomb.y * tile + tile / 2;
  const r = tile * 0.28;
  context.fillStyle = "rgba(0,0,0,0.25)";
  context.beginPath();
  context.ellipse(cx, cy + r * 0.8, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#1b1b1b";
  context.beginPath();
  context.arc(cx, cy, r, 0, Math.PI * 2);
  context.fill();
  if (!detailed) return;
  context.fillStyle = "#f4f4f4";
  context.beginPath();
  context.arc(cx - r * 0.3, cy - r * 0.3, r * 0.22, 0, Math.PI * 2);
  context.fill();
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 80);
  context.fillStyle = `rgba(255, ${180 - pulse * 80}, 40, 1)`;
  context.beginPath();
  context.arc(cx + r * 0.55, cy - r * 0.85, 3 + pulse * 2, 0, Math.PI * 2);
  context.fill();
}

function drawPlayer(context, x, y, tile, player, isYou, detailed) {
  context.save();
  if (player.invuln && Math.floor(performance.now() / 90) % 2 === 0) context.globalAlpha = 0.4;
  const r = tile * 0.32;
  context.fillStyle = "rgba(0,0,0,0.25)";
  context.beginPath();
  context.ellipse(x, y + r * 0.75, r * 0.7, r * 0.28, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = player.color;
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(x - r * 0.28, y - r * 0.05, r * 0.16, 0, Math.PI * 2);
  context.arc(x + r * 0.28, y - r * 0.05, r * 0.16, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#1b1b1b";
  context.beginPath();
  context.arc(x - r * 0.28, y - r * 0.02, r * 0.07, 0, Math.PI * 2);
  context.arc(x + r * 0.28, y - r * 0.02, r * 0.07, 0, Math.PI * 2);
  context.fill();
  if (isYou) {
    context.strokeStyle = "#fff8e8";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, y, r + 4, 0, Math.PI * 2);
    context.stroke();
  }
  if (detailed) {
    context.globalAlpha = 1;
    context.fillStyle = "#fff8e8";
    context.font = "12px Trebuchet MS, sans-serif";
    context.textAlign = "center";
    context.fillText(player.name, x, y - r - 8);
  }
  context.restore();
}

function drawBlast(context, blast, tile) {
  const t = Math.max(0, Math.min(1, blast.t));
  const inset = tile * 0.04;
  const x = blast.x * tile + inset;
  const y = blast.y * tile + inset;
  const size = tile - inset * 2;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const grad = context.createRadialGradient(cx, cy, tile * 0.08, cx, cy, size * 0.72);
  grad.addColorStop(0, `rgba(255, 250, 220, ${0.55 + t * 0.4})`);
  grad.addColorStop(0.5, "rgba(255, 150, 28, 0.95)");
  grad.addColorStop(1, "rgba(214, 42, 12, 0.9)");
  context.fillStyle = grad;
  context.fillRect(x, y, size, size);
}

function drawMini() {
  const w = mini.width;
  const h = mini.height;
  miniCtx.clearRect(0, 0, w, h);
  miniCtx.fillStyle = "#121722";
  miniCtx.fillRect(0, 0, w, h);
  if (!mapW || !tiles) return;
  const tile = Math.min((w - 8) / mapW, (h - 8) / mapH);
  const ox = (w - mapW * tile) / 2;
  const oy = (h - mapH * tile) / 2;
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const kind = tileAt(y * mapW + x);
      miniCtx.fillStyle = kind === "#" ? "#60748c" : kind === "o" ? "#c47a3a" : "#2c8a42";
      miniCtx.fillRect(ox + x * tile, oy + y * tile, Math.ceil(tile), Math.ceil(tile));
    }
  }
  for (const block of state.soon || []) {
    miniCtx.fillStyle = "rgba(255, 220, 120, 0.8)";
    miniCtx.fillRect(ox + block.x * tile, oy + block.y * tile, Math.ceil(tile), Math.ceil(tile));
  }
  for (const player of state.players) {
    if (!player.alive) continue;
    const view = shown.get(player.id) || player;
    miniCtx.fillStyle = player.color;
    miniCtx.beginPath();
    miniCtx.arc(ox + view.x * tile, oy + view.y * tile, Math.max(2, tile * 0.35), 0, Math.PI * 2);
    miniCtx.fill();
  }
}
