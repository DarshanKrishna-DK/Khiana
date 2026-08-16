import { randomUUID } from 'crypto';

import { CONFIG } from './config.js';
import { createGame, runTick, resolveTick, movePlayer, endGame } from './game/engine.js';
import { playerView, spectatorView } from './game/fog.js';
import { stepAllBots, claimSeat, releaseSeat, firstOpenSeat } from './agents/bots.js';
import { commitRoles } from './economy/roles.js';
import { startRecording, captureFrame, captureReveal, stopRecording, isRecording } from './recording.js';

/**
 * Room registry — many concurrent games on one server.
 *
 * The server used to hold a single module-level `game`, which meant one match
 * at a time for the whole internet. Everything that was global there is now
 * per-room state, so two lobbies cannot see or interfere with each other.
 *
 * Codes are short and human-sayable because the primary way people join is
 * someone reading it out. Ambiguous glyphs (0/O, 1/I/L) are excluded from the
 * alphabet for exactly that reason.
 */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = Number(process.env.ROOM_CODE_LENGTH ?? 4);

// An abandoned lobby should not sit in the public list forever.
const EMPTY_ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS ?? 15 * 60_000);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 40);

const rooms = new Map();

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  // Astronomically unlikely, but a silent collision would hand a player into
  // someone else's game.
  throw new Error('could not allocate a unique room code');
}

export function createRoom({ name, isPublic = true, seed, hostName } = {}) {
  if (rooms.size >= MAX_ROOMS) throw new Error('server is at room capacity');

  const code = newCode();
  const room = {
    code,
    name: (name || `${hostName ? hostName + "'s" : 'Open'} lobby`).slice(0, 40),
    isPublic: Boolean(isPublic),
    game: createGame({ seed: seed ?? Date.now() }),
    loop: null,
    sockets: new Map(),      // ws -> { role, playerId }
    seatTokens: new Map(),   // token -> playerId
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    recordingFile: null,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase()) ?? null;
}

export function allRooms() {
  return [...rooms.values()];
}

/** Humans currently holding a seat (bots don't count as occupancy). */
export function humanCount(room) {
  return Object.values(room.game.players).filter(p => !p.isBot).length;
}

export function roomSummary(room) {
  const g = room.game;
  return {
    code: room.code,
    name: room.name,
    isPublic: room.isPublic,
    humans: humanCount(room),
    capacity: CONFIG.GAME.PLAYERS,
    spectators: [...room.sockets.values()].filter(m => m.role === 'spectator').length,
    started: g.started,
    phase: g.phase,
    tick: g.tick,
    totalTicks: CONFIG.GAME.TOTAL_TICKS,
    winner: g.winner,
    // Empty seats auto-fill with bots, so a game is always joinable until it
    // ends — "open" here means "you can still take a seat", not "waiting".
    joinable: !g.winner && humanCount(room) < CONFIG.GAME.PLAYERS,
    createdAt: room.createdAt,
  };
}

/** Public, unfinished rooms, newest first. */
export function publicRooms() {
  return allRooms()
    .filter(r => r.isPublic && !r.game.winner)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(roomSummary);
}

// ── Sockets ─────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

export function pushState(room, ws) {
  const meta = room.sockets.get(ws);
  if (!meta) return;
  if (meta.role === 'player' && meta.playerId) {
    // Fog is applied HERE, server-side. Never send a player state they
    // shouldn't see and hide it in the renderer — devtools defeats that.
    send(ws, { type: 'STATE', view: playerView(room.game, meta.playerId) });
  } else {
    send(ws, { type: 'SPECTATE_STATE', view: spectatorView(room.game) });
  }
}

export function broadcast(room) {
  for (const ws of room.sockets.keys()) pushState(room, ws);
  if (isRecording() && room.recordingFile) captureFrame(spectatorView(room.game));
}

export function attach(room, ws, role = 'spectator') {
  room.sockets.set(ws, { role, playerId: null });
  room.lastSeenAt = Date.now();
}

export function detach(room, ws) {
  const meta = room.sockets.get(ws);
  if (meta?.playerId) releaseSeat(room.game, meta.playerId);
  room.sockets.delete(ws);
  room.lastSeenAt = Date.now();
}

/**
 * Seat a player, resuming their previous seat when they hold a valid token.
 *
 * Reconnect-before-allocate matters on a venue network: a dropped socket hands
 * the seat back to a bot, and without the token a returning player would be
 * given whatever seat happened to be free — a different human, a different
 * team, someone else's bribes.
 */
export function seatPlayer(room, ws, { name, token, playerId } = {}) {
  const g = room.game;
  const resumedId = token && room.seatTokens.get(token);
  const seat = (resumedId && g.players[resumedId])
    ?? (playerId ? g.players[playerId] : null)
    ?? firstOpenSeat(g);

  if (!seat) return { error: 'This lobby is full.' };
  if (!seat.alive && !resumedId) return { error: 'No living seats left in this game.' };

  claimSeat(g, seat.id, name);
  room.sockets.set(ws, { role: 'player', playerId: seat.id });
  room.lastSeenAt = Date.now();

  const issued = (token && resumedId) ? token : randomUUID();
  room.seatTokens.set(issued, seat.id);

  return { seat, token: issued, resumed: Boolean(resumedId) };
}

export function movePlayerIn(room, playerId, dx, dy) {
  movePlayer(room.game, playerId, dx, dy);
  room.lastSeenAt = Date.now();
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function startRoom(room) {
  if (room.loop) return { ok: false, error: 'Already running' };

  // Publish the role commitment BEFORE the first tick. Committing afterwards
  // would prove nothing (PRD §10.4).
  const commit = await commitRoles(room.game).catch(() => null);
  room.game.started = true;

  if (process.env.RECORD === 'true' && !isRecording()) {
    room.recordingFile = startRecording({ seed: room.game.seed, room: room.code });
  }

  const step = async () => {
    await runTick(room.game, () => broadcast(room));

    // MOVE window: humans act over WebSocket, bots are stepped near the end.
    const moveWindow = Math.floor(CONFIG.GAME.TICK_MS * 0.6);
    setTimeout(() => {
      stepAllBots(room.game);
      const winner = resolveTick(room.game);
      broadcast(room);
      if (winner) finishRoom(room);
    }, moveWindow);
  };

  step();
  room.loop = setInterval(step, CONFIG.GAME.TICK_MS);

  return {
    ok: true,
    recording: room.recordingFile,
    roleCommit: commit ? { commitment: commit.commitment, txHash: commit.txHash } : null,
  };
}

export function finishRoom(room) {
  stopRoomLoop(room);
  const reveal = endGame(room.game, () => broadcast(room));
  if (isRecording() && room.recordingFile) {
    captureReveal(reveal);
    stopRecording().then(r => console.log(`  recording closed (${r.frames} frames)`));
  }
  return reveal;
}

export function stopRoomLoop(room) {
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
}

export function resetRoom(room, seed) {
  stopRoomLoop(room);
  room.game = createGame({ seed: seed ?? Date.now() });
  room.seatTokens = new Map();
  broadcast(room);
  return room;
}

export function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return false;
  stopRoomLoop(room);
  for (const ws of room.sockets.keys()) { try { ws.close(); } catch { /* already gone */ } }
  return rooms.delete(code);
}

/**
 * Reap abandoned lobbies.
 *
 * Without this the public list fills with dead rooms nobody can play in,
 * which is worse than an empty list: a player clicks three ghosts before
 * finding a real game and concludes the whole thing is broken.
 */
export function reapRooms(now = Date.now()) {
  let reaped = 0;
  for (const [code, room] of rooms) {
    const empty = room.sockets.size === 0;
    const stale = now - room.lastSeenAt > EMPTY_ROOM_TTL_MS;
    const done = room.game.winner && now - room.lastSeenAt > 60_000;
    if ((empty && stale) || done) { closeRoom(code); reaped++; }
  }
  return reaped;
}

export function startReaper(intervalMs = 60_000) {
  const t = setInterval(() => reapRooms(), intervalMs);
  t.unref?.();   // never hold the process open just to garbage-collect
  return t;
}

export const constants = { CODE_ALPHABET, CODE_LENGTH, EMPTY_ROOM_TTL_MS, MAX_ROOMS };
