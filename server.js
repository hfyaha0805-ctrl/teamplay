import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const ROUND_MS = 30_000;
const REVEAL_MS = 3_200;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ANIMALS = new Set(["rabbit","fox","cat","dog","panda","bird","hamster","capybara","seal","frog","hedgehog","otter"]);
const EMOJIS = new Set(["😀","😂","😍","😮","🥹","🔥","❤️","👏","🙌","🤔","😭","✨"]);
const rooms = new Map();

function makeCode() {
  const bytes = randomBytes(5);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}
function cleanName(value) {
  return String(value || "玩家").trim().slice(0, 12) || "玩家";
}
function cleanAnimal(value) {
  return ANIMALS.has(value) ? value : "rabbit";
}
function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => ({
      id: p.id, name: p.name, animal: p.animal, ready: p.ready,
      submitted: p.submitted, connected: p.connected
    })),
    round: room.round,
    roundStartedAt: room.roundStartedAt,
    roundEndsAt: room.roundEndsAt,
    serverNow: Date.now(),
    history: room.history,
    reveal: room.reveal,
    winner: room.winner
  };
}
function send(ws, event, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, data }));
}
function broadcast(room, event, data) {
  for (const player of room.players) send(player.ws, event, data);
}
function emitRoom(room) {
  broadcast(room, "room:update", publicRoom(room));
}
function gameError(ws, message) {
  send(ws, "game:error", message);
}
function saveTimer(room, delay, callback) {
  clearTimeout(room.timer);
  room.timer = setTimeout(callback, delay);
}
function removeRoomLater(room) {
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (room.players.every(p => p.ws.readyState !== WebSocket.OPEN)) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
    }
  }, ROOM_TTL_MS);
  room.cleanupTimer.unref?.();
}
function beginRound(room) {
  if (room.status !== "reveal") return;
  room.status = "round";
  room.round += 1;
  room.roundStartedAt = Date.now();
  room.roundEndsAt = room.roundStartedAt + ROUND_MS;
  room.reveal = null;
  room.players.forEach(p => {
    p.submitted = false; p.answer = ""; p.draft = ""; p.submittedAt = null;
  });
  emitRoom(room);
  saveTimer(room, ROUND_MS, () => resolveRound(room, true));
}
function finishOrReveal(room, words) {
  room.reveal = { round: room.round, words };
  room.history.push({ round: room.round, words });
  if (words[0] === words[1] && words[0] !== "（未填写）") {
    room.status = "finished";
    room.winner = { word: words[0], rounds: room.round };
    clearTimeout(room.timer);
  } else {
    room.status = "reveal";
    saveTimer(room, REVEAL_MS, () => beginRound(room));
  }
  emitRoom(room);
}
function resolveRound(room, timedOut = false) {
  if (room.status !== "round") return;
  clearTimeout(room.timer);
  if (timedOut) {
    room.players.forEach(p => {
      if (!p.submitted) {
        p.answer = p.draft || "（未填写）";
        p.submitted = true;
        p.submittedAt = room.roundEndsAt;
      }
    });
  }
  const words = room.players.map(p => p.answer || "（未填写）");
  finishOrReveal(room, words);
}
function attachPlayer(room, ws, name, animal) {
  const player = {
    id: randomUUID(), name, animal, ready: false, submitted: false,
    answer: "", draft: "", connected: true, ws, lastEmojiAt: 0
  };
  room.players.push(player);
  ws.playerId = player.id;
  ws.roomCode = room.code;
  send(ws, "room:joined", { code: room.code, playerId: player.id });
  emitRoom(room);
}
function handlePacket(ws, packet) {
  const room = rooms.get(ws.roomCode);
  const player = room?.players.find(p => p.id === ws.playerId);
  if (!room || !player) return;
  const { event, data = {} } = packet || {};

  if (event === "player:animal") {
    if (room.status !== "waiting") return;
    const nextAnimal = cleanAnimal(data.animal);
    if (player.animal !== nextAnimal) {
      player.animal = nextAnimal;
      player.ready = false;
      emitRoom(room);
    }
    return;
  }
  if (event === "player:ready") {
    if (room.status !== "waiting") return;
    player.ready = true;
    emitRoom(room);
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.status = "initial";
      room.round = 1;
      room.reveal = null;
      room.history = [];
      room.players.forEach(p => { p.submitted = false; p.answer = ""; p.draft = ""; });
      emitRoom(room);
    }
    return;
  }
  if (event === "player:initial-submit") {
    if (room.status !== "initial" || player.submitted) return;
    const answer = String(data.word || "").trim().slice(0, 24);
    if (!answer) return gameError(ws, "先写下一个词语再提交吧。");
    player.answer = answer;
    player.submitted = true;
    if (room.players.every(p => p.submitted)) {
      finishOrReveal(room, room.players.map(p => p.answer));
    } else emitRoom(room);
    return;
  }
  if (event === "player:draft") {
    if (room.status !== "round" || player.submitted) return;
    player.draft = String(data.word || "").trim().slice(0, 24);
    return;
  }
  if (event === "player:submit") {
    if (room.status !== "round" || player.submitted) return;
    const submittedWord = String(data.word ?? player.draft ?? "").trim().slice(0, 24);
    if (Date.now() >= room.roundEndsAt) {
      if (submittedWord) player.draft = submittedWord;
      resolveRound(room, true);
      return;
    }
    player.answer = submittedWord || "（未填写）";
    player.submitted = true;
    player.submittedAt = Date.now();
    emitRoom(room);
    if (room.players.every(p => p.submitted)) resolveRound(room);
    return;
  }
  if (event === "game:emoji") {
    if (room.status !== "round") return;
    const emoji = String(data.emoji || "");
    if (!EMOJIS.has(emoji)) return;
    const now = Date.now();
    if (now - player.lastEmojiAt < 450) return;
    player.lastEmojiAt = now;
    broadcast(room, "game:emoji", { playerId: player.id, emoji });
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
    clearTimeout(room.timer);
    emitRoom(room);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, platform: "tencent-cloudbase-run" }));
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405); res.end("Method Not Allowed"); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch {
    res.writeHead(400); res.end("Bad Request"); return;
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(PUBLIC_DIR, "." + pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end("Not Found"); return; }
    const types = {
      ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
      ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
      ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg",
      ".jpeg":"image/jpeg", ".ico":"image/x-icon", ".webp":"image/webp"
    };
    res.writeHead(200, {
      "content-type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600"
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const mode = url.searchParams.get("mode");
  let code = (url.searchParams.get("code") || "").trim().toUpperCase();
  const name = cleanName(url.searchParams.get("name"));
  const animal = cleanAnimal(url.searchParams.get("animal"));
  let room;

  if (mode === "create") {
    for (let i = 0; i < 10; i++) {
      const candidate = makeCode();
      if (!rooms.has(candidate)) { code = candidate; break; }
    }
    if (!code || rooms.has(code)) {
      send(ws, "game:error", "创建房间失败，请重试。"); ws.close(1008); return;
    }
    room = {
      code, status: "waiting", players: [], round: 0, history: [],
      roundStartedAt: null, roundEndsAt: null, reveal: null, winner: null,
      timer: null, cleanupTimer: null
    };
    rooms.set(code, room);
  } else if (mode === "join" && /^[A-Z0-9]{5}$/.test(code)) {
    room = rooms.get(code);
    if (!room) { send(ws, "game:error", "没有找到这个房间，请检查房间码。"); ws.close(1008); return; }
    if (room.players.length >= 2) { send(ws, "game:error", "这个房间已经坐满两位玩家。"); ws.close(1008); return; }
    if (room.status !== "waiting") { send(ws, "game:error", "这局游戏已经开始，无法中途加入。"); ws.close(1008); return; }
  } else {
    send(ws, "game:error", "无效的房间请求。"); ws.close(1008); return;
  }

  clearTimeout(room.cleanupTimer);
  attachPlayer(room, ws, name, animal);
  ws.on("message", raw => {
    try { handlePacket(ws, JSON.parse(raw.toString())); }
    catch (error) { console.error("WebSocket message error:", error); }
  });
  ws.on("close", () => {
    const currentRoom = rooms.get(ws.roomCode);
    const player = currentRoom?.players.find(p => p.id === ws.playerId);
    if (!player) return;
    player.connected = false;
    emitRoom(currentRoom);
    removeRoomLater(currentRoom);
  });
  ws.on("error", error => console.error("WebSocket error:", error));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wordloop listening on 0.0.0.0:${PORT}`);
});
