import { DurableObject } from "cloudflare:workers";

const ROUND_MS = 20_000;
const REVEAL_MS = 3_200;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}
function cleanName(value) {
  return String(value || "玩家").trim().slice(0, 12) || "玩家";
}
function cleanAnimal(value) {
  const allowed = ["rabbit", "fox", "cat", "dog", "panda", "bird", "hamster"];
  return allowed.includes(value) ? value : "rabbit";
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, platform: "cloudflare-workers" });
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      let code = (url.searchParams.get("code") || "").trim().toUpperCase();
      const mode = url.searchParams.get("mode");
      if (mode === "create") {
        code = makeCode();
      } else if (mode !== "join" || !/^[A-Z0-9]{5}$/.test(code)) {
        return json({ error: "无效的房间请求。" }, 400);
      }
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set("x-wordloop-mode", mode);
      headers.set("x-wordloop-code", code);
      headers.set("x-wordloop-name", cleanName(url.searchParams.get("name")));
      headers.set("x-wordloop-animal", cleanAnimal(url.searchParams.get("animal")));
      return stub.fetch(new Request(request, { headers }));
    }
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.loading = this.ctx.storage.get("room").then(value => {
      this.room = value || null;
    });
  }
  async getRoom() {
    await this.loading;
    return this.room;
  }
  async save() {
    if (this.room) await this.ctx.storage.put("room", this.room);
  }
  publicRoom() {
    const room = this.room;
    return {
      code: room.code, status: room.status,
      players: room.players.map(p => ({
        id: p.id, name: p.name, animal: p.animal, ready: p.ready,
        submitted: p.submitted, connected: p.connected
      })),
      round: room.round, roundStartedAt: room.roundStartedAt,
      roundEndsAt: room.roundEndsAt, history: room.history,
      reveal: room.reveal, winner: room.winner
    };
  }
  send(ws, event, data) {
    try { ws.send(JSON.stringify({ event, data })); } catch {}
  }
  broadcast(event, data) {
    const payload = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch {}
    }
  }
  emitRoom() {
    if (this.room) this.broadcast("room:update", this.publicRoom());
  }
  error(ws, message) {
    this.send(ws, "game:error", message);
  }
  playerFor(ws) {
    const attachment = ws.deserializeAttachment();
    return this.room?.players.find(p => p.id === attachment?.playerId);
  }
  async fetch(request) {
    const mode = request.headers.get("x-wordloop-mode");
    const code = request.headers.get("x-wordloop-code");
    const name = cleanName(request.headers.get("x-wordloop-name"));
    const animal = cleanAnimal(request.headers.get("x-wordloop-animal"));
    await this.getRoom();

    if (mode === "create") {
      if (this.room) return json({ error: "房间码冲突，请再试一次。" }, 409);
      this.room = {
        code, status: "waiting", players: [], round: 0, history: [],
        roundStartedAt: null, roundEndsAt: null, reveal: null, winner: null
      };
    } else {
      if (!this.room) return json({ error: "没有找到这个房间，请检查房间码。" }, 404);
      if (this.room.players.length >= 2) return json({ error: "这个房间已经坐满两位玩家。" }, 409);
      if (this.room.status !== "waiting") return json({ error: "这局游戏已经开始，无法中途加入。" }, 409);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const playerId = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId });
    this.room.players.push({
      id: playerId, name, animal, ready: false, submitted: false,
      answer: "", draft: "", connected: true
    });
    await this.save();
    this.send(server, "room:joined", { code, playerId });
    this.emitRoom();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    let packet;
    try { packet = JSON.parse(message); } catch { return; }
    const { event, data = {} } = packet;
    const room = await this.getRoom();
    const player = this.playerFor(ws);
    if (!room || !player) return;

    if (event === "player:ready") {
      if (room.status !== "waiting") return;
      player.ready = true;
      await this.save();
      this.emitRoom();
      if (room.players.length === 2 && room.players.every(p => p.ready)) {
        room.status = "initial";
        room.round = 1;
        room.reveal = null;
        room.history = [];
        room.players.forEach(p => { p.submitted = false; p.answer = ""; p.draft = ""; });
        await this.save();
        this.emitRoom();
      }
      return;
    }
    if (event === "player:initial-submit") {
      if (room.status !== "initial" || player.submitted) return;
      const answer = String(data.word || "").trim().slice(0, 24);
      if (!answer) return this.error(ws, "先写下一个词语再提交吧。");
      player.answer = answer;
      player.submitted = true;
      if (room.players.every(p => p.submitted)) {
        room.reveal = { round: 1, words: room.players.map(p => p.answer) };
        room.history.push({ round: 1, words: room.reveal.words });
        room.status = "reveal";
        await this.save();
        this.emitRoom();
        await this.ctx.storage.setAlarm(Date.now() + REVEAL_MS);
      } else {
        await this.save();
        this.emitRoom();
      }
      return;
    }
    if (event === "player:draft") {
      if (room.status !== "round" || player.submitted) return;
      player.draft = String(data.word || "").trim().slice(0, 24);
      await this.save();
      return;
    }
    if (event === "player:submit") {
      if (room.status !== "round" || player.submitted) return;
      const answer = String(data.word ?? player.draft ?? "").trim().slice(0, 24);
      player.answer = answer || "（未填写）";
      player.submitted = true;
      player.submittedAt = Date.now();
      await this.save();
      this.emitRoom();
      if (room.players.every(p => p.submitted)) await this.resolveRound();
      return;
    }
    if (event === "game:restart") {
      if (room.status !== "finished") return;
      player.name = cleanName(data.name || player.name);
      player.animal = cleanAnimal(data.animal || player.animal);
      room.players.forEach(p => {
        p.ready = false; p.submitted = false; p.answer = ""; p.draft = "";
      });
      room.status = "waiting";
      room.round = 0;
      room.history = [];
      room.reveal = null;
      room.winner = null;
      await this.ctx.storage.deleteAlarm();
      await this.save();
      this.emitRoom();
    }
  }
  async beginRound() {
    const room = await this.getRoom();
    if (!room || room.status !== "reveal") return;
    room.status = "round";
    room.round += 1;
    room.roundStartedAt = Date.now();
    room.roundEndsAt = room.roundStartedAt + ROUND_MS;
    room.reveal = null;
    room.players.forEach(p => {
      p.submitted = false; p.answer = ""; p.draft = ""; p.submittedAt = null;
    });
    await this.save();
    this.emitRoom();
    await this.ctx.storage.setAlarm(room.roundEndsAt);
  }
  async resolveRound() {
    const room = await this.getRoom();
    if (!room || room.status !== "round") return;
    await this.ctx.storage.deleteAlarm();
    const words = room.players.map(p => p.answer || "（未填写）");
    room.reveal = { round: room.round, words };
    room.history.push({ round: room.round, words });
    if (words[0] === words[1] && words[0] !== "（未填写）") {
      room.status = "finished";
      room.winner = { word: words[0], rounds: room.round };
    } else {
      room.status = "reveal";
    }
    await this.save();
    this.emitRoom();
    if (room.status === "reveal") await this.ctx.storage.setAlarm(Date.now() + REVEAL_MS);
  }
  async alarm() {
    const room = await this.getRoom();
    if (!room) return;
    if (room.status === "round") {
      room.players.forEach(p => {
        if (!p.submitted) {
          p.answer = p.draft || "（未填写）";
          p.submitted = true;
          p.submittedAt = room.roundEndsAt;
        }
      });
      await this.resolveRound();
    } else if (room.status === "reveal") {
      await this.beginRound();
    }
  }
  async webSocketClose(ws) {
    const player = this.playerFor(ws);
    if (!player || !this.room) return;
    player.connected = false;
    await this.save();
    this.emitRoom();
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
