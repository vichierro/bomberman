import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import {
  BASE_H,
  BASE_W,
  BLOCK_RESPAWN_MS,
  EMPTY,
  HARD,
  SOFT,
  Game,
  isStructural,
} from "../game.js";
import { createApp } from "../server.js";

function makeGame() {
  let now = 10_000;
  const game = new Game({ now: () => now });
  return {
    game,
    tick(ms = 50) {
      now += ms;
      game.step(ms);
    },
    setNow(value) {
      now = value;
    },
    now: () => now,
  };
}

test("o mapa começa no tamanho clássico e cresce dois ladrilhos por jogador", () => {
  const { game } = makeGame();
  const ana = game.addPlayer("Ana");
  assert.equal(game.width, BASE_W);
  assert.equal(game.height, BASE_H);
  assert.ok(ana);

  game.tiles[3][3] = EMPTY;
  game.tiles[5][5] = SOFT;
  const bia = game.addPlayer("Bia");
  assert.equal(game.width, 17);
  assert.equal(game.height, 15);
  assert.equal(game.tiles[3][3], EMPTY);
  assert.equal(game.tiles[5][5], SOFT);
  assert.equal(game.tiles[4][4], HARD);
  assert.equal(game.tiles[1][14], SOFT);
  assert.equal(isStructural(16, 0, game.width, game.height), true);
  assert.equal(game.tiles[0][16], HARD);
  assert.notEqual(bia.x, ana.x);

  game.addPlayer("Caio");
  assert.equal(game.width, 19);
  assert.equal(game.height, 17);
});

test("o mapa não encolhe quando alguém sai e reinicia só depois da arena esvaziar", () => {
  const { game, setNow, now } = makeGame();
  const ana = game.addPlayer("Ana");
  const bia = game.addPlayer("Bia");
  game.removePlayer(bia.id);
  assert.equal(game.width, 17);
  assert.equal(game.players.size, 1);
  game.removePlayer(ana.id);
  assert.equal(game.width, 17);
  setNow(now() + EMPTY_WAIT - 1);
  game.step(50);
  assert.equal(game.width, 17);
  setNow(now() + 2);
  game.step(50);
  assert.equal(game.width, 0);
});

const EMPTY_WAIT = 30_000;

test("cada bloco quebrado volta depois de 2 minutos, os mais antigos primeiro", () => {
  assert.equal(BLOCK_RESPAWN_MS, 120_000);
  const { game, tick, setNow, now } = makeGame();
  const ana = game.addPlayer("Ana");
  game.tiles[1][3] = SOFT;
  game.tiles[1][4] = SOFT;
  ana.x = 1.5;
  ana.y = 1.5;
  ana.input.bomb = true;
  tick();
  ana.input.bomb = false;

  let guard = 0;
  while (game.bombs.length && guard < 80) {
    tick();
    guard += 1;
  }
  assert.equal(game.tiles[1][3], EMPTY);
  assert.equal(game.tiles[1][4], SOFT);
  const oldest = game.broken.find((block) => block.x === 3 && block.y === 1);
  assert.ok(oldest);
  assert.equal(oldest.at - now(), BLOCK_RESPAWN_MS);

  for (let i = 0; i < 12; i++) tick();
  game.tiles[5][5] = SOFT;
  game.destroySoft(5, 5);
  const newer = game.broken.find((block) => block.x === 5 && block.y === 5);
  assert.ok(newer.at > oldest.at);

  ana.alive = true;
  ana.x = 3.5;
  ana.y = 1.5;
  ana.invulnUntil = now() + 10_000;
  setNow(oldest.at);
  game.step(50);
  assert.equal(game.tiles[1][3], EMPTY, "bloco ocupado espera");
  assert.equal(game.tiles[5][5], EMPTY, "o mais novo ainda não completou 2 minutos");

  setNow(newer.at);
  game.step(50);
  assert.equal(game.tiles[5][5], SOFT);
  assert.equal(game.tiles[1][3], EMPTY);

  ana.x = 1.5;
  ana.y = 1.5;
  game.step(50);
  assert.equal(game.tiles[1][3], SOFT);
});

test("bomba em cadeia elimina e a explosão para no bloco duro", () => {
  const { game, tick } = makeGame();
  const ana = game.addPlayer("Ana");
  ana.x = 1.5;
  ana.y = 1.5;
  game.placeBomb(ana);
  ana.x = 2.5;
  game.placeBomb(ana);
  assert.equal(game.bombs.length, 2);
  ana.x = 1.5;
  game.placeBomb(ana);
  assert.equal(game.bombs.length, 2);

  game.bombs[0].fuse = 0;
  ana.invulnUntil = 0;
  tick();
  assert.equal(game.bombs.length, 0);
  assert.equal(ana.alive, false);
  assert.equal(game.tiles[2][2], HARD);
});

test("o site aceita cada conexão como um jogador e amplia o mapa", async () => {
  const app = createApp();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  const sockets = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Super Bomberman/);

    const first = await openPlayer(port, sockets);
    assert.equal(first.w, 15);
    assert.equal(first.h, 13);
    assert.equal(first.tiles.length, 15 * 13);
    assert.equal(first.players.length, 1);

    const second = await openPlayer(port, sockets);
    assert.equal(second.w, 17);
    assert.equal(second.h, 15);
    assert.equal(second.players.length, 2);
    assert.equal(second.tiles.length, 17 * 15);
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close();
  }
});

function openPlayer(port, sockets) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tempo esgotado ao entrar na arena")), 2000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.once("error", reject);
  });
}
