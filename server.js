import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { Game } from "./game.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end("Não encontrado");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

export function createApp() {
  const game = new Game();
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  function send(client, forceTiles = false) {
    if (client.ws.readyState !== 1) return;
    const includeTiles = forceTiles || client.needsTiles || game.tilesDirty;
    const state = game.snapshot(includeTiles);
    state.you = client.id;
    if (includeTiles) client.needsTiles = false;
    client.ws.send(JSON.stringify(state));
  }

  function broadcast() {
    for (const client of clients) send(client);
    game.tilesDirty = false;
  }

  wss.on("connection", (ws) => {
    const player = game.addPlayer();
    if (!player) {
      ws.send(JSON.stringify({ type: "full" }));
      ws.close();
      return;
    }
    const client = { ws, id: player.id, needsTiles: true };
    clients.add(client);
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    console.log(`+ ${player.name} (${game.players.size}) mapa ${game.width}×${game.height}`);
    send(client, true);

    ws.on("message", (raw) => {
      if (raw.length > 1000) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "name") {
        game.rename(player.id, msg.name);
        return;
      }
      if (msg.type === "input") {
        player.input.up = !!msg.up;
        player.input.down = !!msg.down;
        player.input.left = !!msg.left;
        player.input.right = !!msg.right;
        player.input.bomb = !!msg.bomb;
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      game.removePlayer(player.id);
      console.log(`- ${player.name} (${game.players.size})`);
    });
  });

  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(100, now - last);
    last = now;
    game.step(dt);
    if (clients.size) broadcast();
  }, 50);

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  return {
    server,
    game,
    async close() {
      clearInterval(timer);
      clearInterval(ping);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createApp();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Super Bomberman em http://localhost:${port}`);
  });
}
