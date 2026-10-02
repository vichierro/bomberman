import { DurableObject } from "cloudflare:workers";
import { Game } from "./game.js";

const TICK_MS = 50;
const IDLE_RESET_MS = 30_000;
const STALE_MS = 45_000;

export class Arena extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new Game();
    this.clients = new Set();
    this.timer = null;
    this.stopTimer = null;
    this.last = Date.now();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Esperado WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.join(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  join(ws) {
    const player = this.game.addPlayer();
    if (!player) {
      try {
        ws.send(JSON.stringify({ type: "full" }));
        ws.close(1000, "cheio");
      } catch {
        /* o soquete já fechou */
      }
      return;
    }

    const session = { ws, id: player.id, needsTiles: true, seen: Date.now() };
    this.clients.add(session);
    this.send(session, true);
    this.ensureLoop();
    console.log(`+ ${player.name} (${this.game.players.size}) mapa ${this.game.width}×${this.game.height}`);

    ws.addEventListener("message", (event) => {
      session.seen = Date.now();
      this.onMessage(player, event.data);
    });
    const leave = () => this.drop(session);
    ws.addEventListener("close", leave);
    ws.addEventListener("error", leave);
  }

  onMessage(player, data) {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (text.length > 1000) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "name") {
      this.game.rename(player.id, msg.name);
      return;
    }
    if (msg.type === "input") {
      player.input.up = !!msg.up;
      player.input.down = !!msg.down;
      player.input.left = !!msg.left;
      player.input.right = !!msg.right;
      player.input.bomb = !!msg.bomb;
    }
  }

  drop(session) {
    if (!this.clients.delete(session)) return;
    const player = this.game.players.get(session.id);
    this.game.removePlayer(session.id);
    console.log(`- ${player?.name ?? session.id} (${this.game.players.size})`);
    if (this.clients.size === 0) this.scheduleStop();
  }

  ensureLoop() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  scheduleStop() {
    if (this.stopTimer) return;
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (this.clients.size > 0) return;
      this.tick();
      clearInterval(this.timer);
      this.timer = null;
    }, IDLE_RESET_MS);
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.game.step(dt);
    const stale = [];
    for (const session of this.clients) {
      if (session.ws.readyState !== 1 || now - session.seen > STALE_MS) stale.push(session);
      else this.send(session);
    }
    this.game.tilesDirty = false;
    for (const session of stale) {
      try {
        session.ws.close(1000, "inativo");
      } catch {
        /* já fechado */
      }
      this.drop(session);
    }
  }

  send(session, force = false) {
    if (session.ws.readyState !== 1) return;
    const includeTiles = force || session.needsTiles || this.game.tilesDirty;
    const state = this.game.snapshot(includeTiles);
    state.you = session.id;
    if (includeTiles) session.needsTiles = false;
    session.ws.send(JSON.stringify(state));
  }
}

export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") === "websocket") {
      const id = env.ARENA.idFromName("arena");
      return env.ARENA.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
