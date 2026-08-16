import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

import { CONFIG } from './config.js';
import { checkFacilitator } from './economy/x402.js';
import { mountX402 } from './economy/x402-server.js';
import { providerStatus } from './agents/llm.js';
import {
  createRoom, getRoom, publicRooms, roomSummary, allRooms,
  attach, detach, seatPlayer, pushState, broadcast, movePlayerIn,
  startRoom, finishRoom, resetRoom, closeRoom, startReaper,
} from './rooms.js';

const app = express();
app.use(cors());
app.use(express.json());

const http = createServer(app);
const wss = new WebSocketServer({ server: http });

/**
 * The default room.
 *
 * Everything used to hang off one module-level game. Rooms replaced that, but
 * a lobby-less single game is still how the tests, the headless runner and a
 * plain `npm start` expect to work — so one room always exists under a fixed
 * code and the unprefixed routes operate on it.
 */
const DEFAULT_CODE = 'MAIN';
const defaultRoom = createRoom({ name: 'Main table', isPublic: true });
defaultRoom.code = DEFAULT_CODE;

startReaper();

/** Resolve :code / ?room= / body.room, falling back to the main table. */
function resolveRoom(req) {
  const code = req.params?.code ?? req.query?.room ?? req.body?.room;
  return code ? getRoom(code) : defaultRoom;
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// ── Health & diagnostics ────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mockChain: CONFIG.MOCK_CHAIN,
    mockLLM: CONFIG.MOCK_LLM,
    tick: defaultRoom.game.tick,
    phase: defaultRoom.game.phase,
    players: Object.keys(defaultRoom.game.players).length,
    rooms: allRooms().length,
    agent: providerStatus(),
  });
});

/** Run this FIRST in Phase 1. If it isn't green, nothing downstream works. */
app.get('/facilitator', async (_req, res) => res.json(await checkFacilitator()));

/**
 * Everything the landing page needs to describe the game.
 * Served rather than hardcoded in the copy, so tuning CONFIG updates the
 * marketing page too and the two can never drift apart.
 */
app.get('/config', (_req, res) => {
  res.json({
    players: CONFIG.GAME.PLAYERS,
    saboteurs: CONFIG.GAME.SABOTEURS,
    tasksToWin: CONFIG.GAME.TASKS_TO_WIN,
    totalTicks: CONFIG.GAME.TOTAL_TICKS,
    tickSeconds: CONFIG.GAME.TICK_MS / 1000,
    visionRadius: CONFIG.GAME.VISION_RADIUS,
    corridorSight: CONFIG.GAME.CORRIDOR_SIGHT,
    survivorsToEscape: CONFIG.GAME.SURVIVORS_TO_ESCAPE,
    startingBalance: CONFIG.ECONOMY.STARTING_MON,
    contactFee: CONFIG.ECONOMY.CONTACT_FEE,
    maxPowerups: CONFIG.ECONOMY.MAX_POWERUPS_PER_GAME,
    powerups: Object.entries(CONFIG.POWERUPS).map(([name, p]) => ({
      name, cost: p.cost, desc: p.desc, team: p.team,
    })),
    mockChain: CONFIG.MOCK_CHAIN,
    explorer: CONFIG.CHAIN.EXPLORER,
  });
});

// ── Rooms ───────────────────────────────────────────────────────────────────

app.get('/rooms', (_req, res) => res.json({ rooms: publicRooms() }));

app.post('/rooms', (req, res) => {
  try {
    const room = createRoom({
      name: req.body?.name,
      isPublic: req.body?.isPublic !== false,
      hostName: req.body?.hostName,
      seed: req.body?.seed,
    });
    res.json({ ok: true, room: roomSummary(room) });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err.message ?? err) });
  }
});

app.get('/rooms/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ ok: false, error: 'No such room' });
  res.json({ ok: true, room: roomSummary(room) });
});

app.delete('/rooms/:code', (req, res) => {
  if (String(req.params.code).toUpperCase() === DEFAULT_CODE) {
    return res.status(400).json({ ok: false, error: 'The main table cannot be closed' });
  }
  res.json({ ok: closeRoom(String(req.params.code).toUpperCase()) });
});

// ── Game control (room-scoped, defaulting to the main table) ────────────────

app.post('/game/new', (req, res) => {
  const room = resolveRoom(req);
  if (!room) return res.status(404).json({ ok: false, error: 'No such room' });
  resetRoom(room, req.body?.seed);
  res.json({ ok: true, seed: room.game.seed, room: room.code });
});

app.post('/game/start', async (req, res) => {
  const room = resolveRoom(req);
  if (!room) return res.status(404).json({ ok: false, error: 'No such room' });
  res.json({ ...(await startRoom(room)), room: room.code });
});

app.get('/game/reveal', (req, res) => {
  const room = resolveRoom(req);
  if (!room) return res.status(404).json({ ok: false, error: 'No such room' });
  res.json(room.game.reveal ?? finishRoom(room));
});

/**
 * x402 paid resources: /x402/contact, /x402/powerup, /x402/bribe.
 *
 * Scoped to the main table. Agent wallets are server-held and shared across
 * rooms, so per-room settlement would need per-room wallets — out of scope
 * until more than one room runs on chain at once.
 */
mountX402(app, () => defaultRoom.game);

// ── WebSocket ───────────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  // ?room=CODE on the socket URL, so a spectator can deep-link a lobby.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const requested = url.searchParams.get('room');
  let room = requested ? getRoom(requested) : defaultRoom;

  if (!room) {
    send(ws, { type: 'ERROR', error: `Room ${requested} not found` });
    room = defaultRoom;
  }

  attach(room, ws, 'spectator');

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // A client may switch rooms on an open socket rather than reconnecting.
    if (msg.room) {
      const target = getRoom(msg.room);
      if (target && target !== room) {
        detach(room, ws);
        room = target;
        attach(room, ws, 'spectator');
      }
    }

    const meta = room.sockets.get(ws);

    switch (msg.type) {
      case 'JOIN': {
        const r = seatPlayer(room, ws, { name: msg.name, token: msg.token, playerId: msg.playerId });
        if (r.error) return send(ws, { type: 'ERROR', error: r.error });
        send(ws, {
          type: 'JOINED',
          playerId: r.seat.id, team: r.seat.team,
          token: r.token, resumed: r.resumed, room: room.code,
        });
        pushState(room, ws);
        broadcast(room);   // the roster changed for everyone watching
        break;
      }

      case 'SPECTATE':
        room.sockets.set(ws, { role: 'spectator', playerId: null });
        pushState(room, ws);
        break;

      case 'SET_GOAL_WEIGHT': {
        // Public and set in the lobby: everyone knows how corruptible your
        // advisor is, nobody knows whether it's been bought yet.
        const p = room.game.players[meta?.playerId];
        if (p && !room.game.started) {
          p.agent.goalWeight = Math.max(0, Math.min(100, Number(msg.value) || 70));
        }
        broadcast(room);
        break;
      }

      // Lets whoever is in the lobby start it without a curl command.
      case 'START':
        if (!room.game.started) startRoom(room);
        break;

      case 'MOVE':
        if (meta?.playerId) {
          movePlayerIn(room, meta.playerId, msg.dx | 0, msg.dy | 0);
          pushState(room, ws);
        }
        break;
    }
  });

  ws.on('close', () => {
    detach(room, ws);
    broadcast(room);
  });

  pushState(room, ws);
});

http.listen(CONFIG.PORT, () => {
  const a = providerStatus();
  console.log(`\nKhiana server :${CONFIG.PORT}`);
  console.log(`  chain   ${CONFIG.MOCK_CHAIN ? 'MOCK' : 'LIVE'}`);
  console.log(`  agents  ${a.mock ? 'FALLBACK BRAIN' : `${a.provider} / ${a.model}`}`);
  console.log(`  rooms   GET /rooms · POST /rooms · main table "${DEFAULT_CODE}"`);
  console.log(`  POST /game/start to begin\n`);
});
