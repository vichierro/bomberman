export const BASE_W = 15;
export const BASE_H = 13;
export const GROW = 2;
export const MAX_PLAYERS = 20;
export const BLOCK_RESPAWN_MS = 120_000;
export const EMPTY_RESET_MS = 30_000;
export const FUSE_MS = 2_200;
export const BLAST_MS = 480;
export const RESPAWN_MS = 3_000;
export const INVULN_MS = 1_200;
export const SPEED = 3.35;
export const PLAYER_R = 0.3;
export const MAX_BOMBS = 2;
export const BLAST_RANGE = 2;
export const SOFT_DENSITY = 0.86;

export const HARD = 1;
export const SOFT = 2;
export const EMPTY = 0;

export const PALETTE = [
  "#ff4d4d",
  "#4da3ff",
  "#ffd24a",
  "#3ddc78",
  "#d56bff",
  "#ff8a3c",
  "#3de0d0",
  "#ff6b9d",
  "#c6f25a",
  "#8d7cff",
  "#ff5d73",
  "#7dffe0",
  "#f0a0ff",
  "#ffa24d",
  "#6ecbff",
  "#e8ff7a",
];

export function isStructural(x, y, w, h) {
  if (x < 0 || y < 0 || x >= w || y >= h) return true;
  if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

function cleanName(name, fallback) {
  const text = String(name ?? "")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .slice(0, 16);
  return text || fallback;
}

export class Game {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.players = new Map();
    this.bombs = [];
    this.blasts = [];
    this.broken = [];
    this.feed = [];
    this.tiles = [];
    this.width = 0;
    this.height = 0;
    this.seq = 0;
    this.bombSeq = 0;
    this.tilesDirty = true;
    this.emptySince = 0;
    this.nameSeq = 0;
  }

  reset() {
    this.bombs = [];
    this.blasts = [];
    this.broken = [];
    this.feed = [];
    this.tiles = [];
    this.width = 0;
    this.height = 0;
    this.tilesDirty = true;
    this.emptySince = 0;
  }

  addPlayer(name) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const id = ++this.seq;
    const player = {
      id,
      name: cleanName(name, `Jogador ${++this.nameSeq}`),
      color: PALETTE[(id - 1) % PALETTE.length],
      x: 1.5,
      y: 1.5,
      alive: true,
      kills: 0,
      input: { up: false, down: false, left: false, right: false, bomb: false },
      bombLatch: false,
      phasingBombId: 0,
      respawnAt: 0,
      invulnUntil: this.now() + INVULN_MS,
      maxBombs: MAX_BOMBS,
      range: BLAST_RANGE,
    };
    this.players.set(id, player);
    this.emptySince = 0;
    const grown = this.ensureSize(this.players.size);
    this.placeAtSpawn(player);
    if (grown) {
      this.pushFeed(`${player.name} entrou. A arena cresceu para ${this.width}×${this.height}`);
    } else if (this.players.size === 1) {
      this.pushFeed(`${player.name} abriu a arena`);
    } else {
      this.pushFeed(`${player.name} entrou na arena`);
    }
    return player;
  }

  rename(id, name) {
    const player = this.players.get(id);
    if (!player) return;
    player.name = cleanName(name, player.name);
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.pushFeed(`${player.name} saiu`);
    if (this.players.size === 0) this.emptySince = this.now();
  }

  ensureSize(playerCount) {
    const extra = Math.max(0, playerCount - 1);
    const w = BASE_W + extra * GROW;
    const h = BASE_H + extra * GROW;
    if (this.width === w && this.height === h) return false;
    if (this.width === 0) this.generate(w, h);
    else this.expand(w, h);
    return this.players.size > 1;
  }

  generate(w, h) {
    this.tiles = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => {
        if (isStructural(x, y, w, h)) return HARD;
        return Math.random() < SOFT_DENSITY ? SOFT : EMPTY;
      }),
    );
    this.width = w;
    this.height = h;
    this.clearCorner(1, 1);
    this.clearCorner(w - 2, 1);
    this.clearCorner(1, h - 2);
    this.clearCorner(w - 2, h - 2);
    this.tilesDirty = true;
  }

  expand(newW, newH) {
    const next = Array.from({ length: newH }, () => Array(newW).fill(EMPTY));
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        if (isStructural(x, y, newW, newH)) {
          next[y][x] = HARD;
          continue;
        }
        if (x < this.width && y < this.height) {
          const old = this.tiles[y][x];
          next[y][x] = old === HARD ? SOFT : old;
        } else {
          next[y][x] = Math.random() < SOFT_DENSITY ? SOFT : EMPTY;
        }
      }
    }
    this.tiles = next;
    this.width = newW;
    this.height = newH;
    this.tilesDirty = true;
    for (const player of this.players.values()) this.rescue(player);
  }

  clearCorner(cx, cy) {
    const ix = cx < this.width / 2 ? 1 : -1;
    const iy = cy < this.height / 2 ? 1 : -1;
    for (const [x, y] of [
      [cx, cy],
      [cx + ix, cy],
      [cx, cy + iy],
    ]) {
      if (this.tiles[y]?.[x] === SOFT) this.tiles[y][x] = EMPTY;
    }
  }

  clearPocket(cx, cy) {
    this.clearCorner(cx, cy);
    this.tilesDirty = true;
  }

  spawnPoints() {
    const w = this.width;
    const h = this.height;
    const pts = [
      [w - 2, h - 2],
      [w - 2, 1],
      [1, h - 2],
      [1, 1],
    ];
    for (let x = w - 6; x >= 3; x -= 4) pts.push([x, h - 2], [x, 1]);
    for (let y = h - 6; y >= 3; y -= 4) pts.push([w - 2, y], [1, y]);
    return pts.filter(
      ([x, y]) =>
        x > 0 &&
        y > 0 &&
        x < w - 1 &&
        y < h - 1 &&
        !isStructural(x, y, w, h),
    );
  }

  placeAtSpawn(player) {
    for (const [x, y] of this.spawnPoints()) {
      if (this.bombs.some((bomb) => bomb.x === x && bomb.y === y)) continue;
      if (this.blastAt(x, y)) continue;
      if (this.playerNear(x, y, player)) continue;
      this.clearPocket(x, y);
      if (this.tiles[y][x] !== EMPTY) continue;
      if (this.playerNear(x, y, player)) continue;
      player.x = x + 0.5;
      player.y = y + 0.5;
      return;
    }
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (this.tiles[y][x] !== EMPTY) continue;
        if (this.playerNear(x, y, player) || this.blastAt(x, y)) continue;
        player.x = x + 0.5;
        player.y = y + 0.5;
        return;
      }
    }
    player.x = 1.5;
    player.y = 1.5;
  }

  playerNear(tx, ty, self) {
    for (const other of this.players.values()) {
      if (other === self || !other.alive) continue;
      if (Math.abs(other.x - (tx + 0.5)) < 1.1 && Math.abs(other.y - (ty + 0.5)) < 1.1) {
        return true;
      }
    }
    return false;
  }

  blastAt(tx, ty) {
    const now = this.now();
    return this.blasts.some((blast) => blast.x === tx && blast.y === ty && blast.until > now);
  }

  step(dtMs) {
    const dt = Math.max(0, Math.min(100, dtMs));
    if (
      this.players.size === 0 &&
      this.width > 0 &&
      this.emptySince &&
      this.now() - this.emptySince >= EMPTY_RESET_MS
    ) {
      this.reset();
      return;
    }
    if (this.width === 0) return;

    const dtSec = dt / 1000;
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      this.movePlayer(player, dtSec);
    }
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      if (player.input.bomb && !player.bombLatch) this.placeBomb(player);
      player.bombLatch = player.input.bomb;
    }

    for (const bomb of this.bombs) bomb.fuse -= dt;
    this.explodeDue();
    this.damagePlayers();
    const now = this.now();
    this.blasts = this.blasts.filter((blast) => blast.until > now);
    this.restoreBlocks();

    for (const player of this.players.values()) {
      if (!player.alive && now >= player.respawnAt) this.respawn(player);
    }
    this.feed = this.feed.filter((item) => now - item.at < 6000).slice(-5);
  }

  movePlayer(player, dtSec) {
    let dx = 0;
    let dy = 0;
    if (player.input.left) dx -= 1;
    if (player.input.right) dx += 1;
    if (player.input.up) dy -= 1;
    if (player.input.down) dy += 1;
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    const dist = SPEED * dtSec;
    const nx = player.x + dx * dist;
    if (!this.collides(nx, player.y, player)) player.x = nx;
    const ny = player.y + dy * dist;
    if (!this.collides(player.x, ny, player)) player.y = ny;
    this.nudge(player, dx, dy);
    this.updatePhasing(player);
  }

  nudge(player, dx, dy) {
    const max = 0.14;
    if (dx !== 0 && dy === 0) {
      const cy = Math.floor(player.y) + 0.5;
      const ny = player.y + Math.sign(cy - player.y) * Math.min(max, Math.abs(cy - player.y));
      if (!this.collides(player.x, ny, player)) player.y = ny;
    }
    if (dy !== 0 && dx === 0) {
      const cx = Math.floor(player.x) + 0.5;
      const nx = player.x + Math.sign(cx - player.x) * Math.min(max, Math.abs(cx - player.x));
      if (!this.collides(nx, player.y, player)) player.x = nx;
    }
  }

  collides(px, py, player) {
    const r = PLAYER_R;
    const x0 = Math.floor(px - r);
    const x1 = Math.floor(px + r);
    const y0 = Math.floor(py - r);
    const y1 = Math.floor(py + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.solidAt(x, y, player)) return true;
      }
    }
    return false;
  }

  solidAt(x, y, player) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    const tile = this.tiles[y][x];
    if (tile === HARD || tile === SOFT) return true;
    const bomb = this.bombs.find((item) => item.x === x && item.y === y);
    if (bomb && bomb.id !== player.phasingBombId) return true;
    return false;
  }

  updatePhasing(player) {
    if (!player.phasingBombId) return;
    const bomb = this.bombs.find((item) => item.id === player.phasingBombId);
    if (!bomb || !this.overlapsBomb(player, bomb)) player.phasingBombId = 0;
  }

  overlapsBomb(player, bomb) {
    const r = PLAYER_R;
    return (
      player.x + r > bomb.x &&
      player.x - r < bomb.x + 1 &&
      player.y + r > bomb.y &&
      player.y - r < bomb.y + 1
    );
  }

  placeBomb(player) {
    if (!player.alive) return;
    const x = Math.floor(player.x);
    const y = Math.floor(player.y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (this.tiles[y][x] !== EMPTY) return;
    if (this.bombs.some((bomb) => bomb.x === x && bomb.y === y)) return;
    const active = this.bombs.filter((bomb) => bomb.owner === player.id).length;
    if (active >= player.maxBombs) return;
    const bomb = {
      id: ++this.bombSeq,
      x,
      y,
      fuse: FUSE_MS,
      range: player.range,
      owner: player.id,
    };
    this.bombs.push(bomb);
    player.phasingBombId = bomb.id;
  }

  explodeDue() {
    const queue = this.bombs.filter((bomb) => bomb.fuse <= 0);
    const exploding = new Set();
    while (queue.length) {
      const bomb = queue.shift();
      if (!bomb || exploding.has(bomb)) continue;
      exploding.add(bomb);
      for (const cell of this.raycast(bomb)) {
        this.addBlast(cell.x, cell.y, bomb.owner);
        const other = this.bombs.find(
          (item) => item.x === cell.x && item.y === cell.y && !exploding.has(item),
        );
        if (other) queue.push(other);
      }
    }
    if (exploding.size) this.bombs = this.bombs.filter((bomb) => !exploding.has(bomb));
  }

  raycast(bomb) {
    const cells = [{ x: bomb.x, y: bomb.y }];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= bomb.range; i++) {
        const x = bomb.x + dx * i;
        const y = bomb.y + dy * i;
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) break;
        const tile = this.tiles[y][x];
        if (tile === HARD) break;
        cells.push({ x, y });
        if (tile === SOFT) {
          this.destroySoft(x, y);
          break;
        }
      }
    }
    return cells;
  }

  destroySoft(x, y) {
    if (this.tiles[y]?.[x] !== SOFT) return;
    this.tiles[y][x] = EMPTY;
    this.tilesDirty = true;
    if (!this.broken.some((block) => block.x === x && block.y === y)) {
      this.broken.push({ x, y, at: this.now() + BLOCK_RESPAWN_MS });
    }
  }

  addBlast(x, y, owner) {
    const until = this.now() + BLAST_MS;
    const existing = this.blasts.find((blast) => blast.x === x && blast.y === y);
    if (existing) {
      existing.until = Math.max(existing.until, until);
      return;
    }
    this.blasts.push({ x, y, until, owner });
  }

  damagePlayers() {
    const now = this.now();
    for (const player of this.players.values()) {
      if (!player.alive || now < player.invulnUntil) continue;
      const blast = this.blasts.find(
        (item) => item.until > now && this.playerTouchesTile(player, item.x, item.y),
      );
      if (blast) this.kill(player, blast.owner);
    }
  }

  playerTouchesTile(player, tx, ty) {
    const r = PLAYER_R;
    return player.x + r > tx && player.x - r < tx + 1 && player.y + r > ty && player.y - r < ty + 1;
  }

  kill(victim, ownerId) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.respawnAt = this.now() + RESPAWN_MS;
    victim.phasingBombId = 0;
    victim.bombLatch = true;
    const killer = ownerId ? this.players.get(ownerId) : null;
    if (killer && killer.id !== victim.id) {
      killer.kills += 1;
      this.pushFeed(`${killer.name} eliminou ${victim.name}`);
    } else {
      this.pushFeed(`${victim.name} se explodiu`);
    }
  }

  respawn(player) {
    this.placeAtSpawn(player);
    player.alive = true;
    player.invulnUntil = this.now() + INVULN_MS;
    this.pushFeed(`${player.name} voltou`);
  }

  restoreBlocks() {
    const now = this.now();
    const pending = this.broken
      .filter((block) => now >= block.at)
      .sort((a, b) => a.at - b.at || a.y - b.y || a.x - b.x);
    if (!pending.length) return;
    const pendingSet = new Set(pending);
    const waiting = [];
    let restored = 0;
    for (const block of pending) {
      if (!this.canRestore(block)) {
        waiting.push(block);
        continue;
      }
      this.tiles[block.y][block.x] = SOFT;
      restored += 1;
    }
    if (restored) {
      this.tilesDirty = true;
      this.pushFeed(
        restored === 1 ? "Um bloco antigo voltou" : `${restored} blocos antigos voltaram`,
      );
    }
    this.broken = [...this.broken.filter((block) => !pendingSet.has(block)), ...waiting];
  }

  canRestore(block) {
    const { x, y } = block;
    if (y < 0 || x < 0 || y >= this.height || x >= this.width) return false;
    if (isStructural(x, y, this.width, this.height)) return false;
    if (this.tiles[y][x] !== EMPTY) return false;
    if (this.bombs.some((bomb) => bomb.x === x && bomb.y === y)) return false;
    if (this.blastAt(x, y)) return false;
    for (const player of this.players.values()) {
      if (player.alive && this.playerTouchesTile(player, x, y)) return false;
    }
    return true;
  }

  rescue(player) {
    if (!player.alive || !this.collides(player.x, player.y, player)) return;
    const cx = Math.floor(player.x);
    const cy = Math.floor(player.y);
    for (let rad = 1; rad < 10; rad++) {
      for (let y = cy - rad; y <= cy + rad; y++) {
        for (let x = cx - rad; x <= cx + rad; x++) {
          if (this.tiles[y]?.[x] !== EMPTY) continue;
          const px = x + 0.5;
          const py = y + 0.5;
          if (!this.collides(px, py, player)) {
            player.x = px;
            player.y = py;
            return;
          }
        }
      }
    }
  }

  pushFeed(text) {
    this.feed.push({ text, at: this.now() });
    this.feed = this.feed.filter((item) => this.now() - item.at < 6000).slice(-5);
  }

  tileString() {
    const chars = [".", "#", "o"];
    let out = "";
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out += chars[this.tiles[y][x]] ?? ".";
    }
    return out;
  }

  snapshot(includeTiles) {
    const now = this.now();
    let next = null;
    let oldest = null;
    for (const block of this.broken) {
      if (oldest === null || block.at < oldest) oldest = block.at;
    }
    if (oldest !== null) next = Math.max(0, oldest - now);
    const soon = [];
    for (const block of this.broken) {
      const left = block.at - now;
      if (left <= 20_000) soon.push({ x: block.x, y: block.y, left: Math.max(0, left) });
    }
    soon.sort((a, b) => a.left - b.left);
    const state = {
      type: "state",
      w: this.width,
      h: this.height,
      blockSeconds: BLOCK_RESPAWN_MS / 1000,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        x: round(player.x),
        y: round(player.y),
        alive: player.alive,
        kills: player.kills,
        bombs: this.bombs.filter((bomb) => bomb.owner === player.id).length,
        maxBombs: player.maxBombs,
        range: player.range,
        invuln: player.alive && now < player.invulnUntil,
        respawnIn: player.alive ? 0 : Math.max(0, player.respawnAt - now),
      })),
      bombs: this.bombs.map((bomb) => ({
        x: bomb.x,
        y: bomb.y,
        fuse: Math.max(0, bomb.fuse),
        owner: bomb.owner,
      })),
      blasts: this.blasts
        .filter((blast) => blast.until > now)
        .map((blast) => ({
          x: blast.x,
          y: blast.y,
          t: (blast.until - now) / BLAST_MS,
        })),
      soon,
      broken: this.broken.length,
      next,
      feed: this.feed.map((item) => item.text),
    };
    if (includeTiles) state.tiles = this.tileString();
    return state;
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}
