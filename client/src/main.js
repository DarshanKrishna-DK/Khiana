import { Scene } from './scene.js';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';

/**
 * Room + seat continuity.
 *
 * The room comes from ?room=CODE so a lobby link is shareable. The seat token
 * is kept in sessionStorage keyed by room: a refresh or a dropped connection
 * resumes the same player, same team, same accumulated bribes, instead of
 * being handed whatever seat happens to be free.
 *
 * sessionStorage, not localStorage — two tabs should be two players, which is
 * how you test a game like this on one machine.
 */
const ROOM = new URLSearchParams(location.search).get('room') || null;
const TOKEN_KEY = `khiana:seat:${ROOM ?? 'MAIN'}`;

const el = id => document.getElementById(id);
const scene = new Scene(el('stage'));

// Debug handle. Harmless in production and the only practical way to inspect
// three.js internals from an automated browser session.
if (typeof window !== 'undefined') window.__khiana = { scene };
let ws = null;
let me = null;
let mazeBuilt = false;

// ── Retainer descriptions ───────────────────────────────────────────────────
// The player's one pre-game strategic decision. It's public, so the wording
// has to make the trade-off obvious in a glance.
const RETAINER = [
  [85, 'Nearly incorruptible. Your advisor will refuse almost everything — but it plays scared and spends nothing.'],
  [65, 'Loyal, but it will take a low-risk bribe if the ask seems harmless.'],
  [45, 'Openly mercenary. It negotiates hard and takes good deals. Everyone can see that.'],
  [0,  'For sale. It will actively solicit bribes. You will be lied to. You may also end up very rich.'],
];

function retainerText(v) {
  return RETAINER.find(([min]) => v >= min)[1];
}

el('weight').addEventListener('input', e => {
  const v = Number(e.target.value);
  el('wv').textContent = `${v} / 100`;
  el('wd').textContent = retainerText(v);
});
el('weight').dispatchEvent(new Event('input'));

el('join').addEventListener('click', () => {
  const name = el('name').value.trim() || 'Anon';
  connect(name, Number(el('weight').value));
  el('gate').style.display = 'none';
});

// ── Networking ──────────────────────────────────────────────────────────────

function connect(name, weight) {
  ws = new WebSocket(ROOM ? `${WS_URL}?room=${encodeURIComponent(ROOM)}` : WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'JOIN', name,
      room: ROOM ?? undefined,
      token: sessionStorage.getItem(TOKEN_KEY) ?? undefined,
    }));
    ws.send(JSON.stringify({ type: 'SET_GOAL_WEIGHT', value: weight, room: ROOM ?? undefined }));
  };

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'JOINED') {
      me = msg.playerId;
      scene.youId = me;
      if (msg.token) sessionStorage.setItem(TOKEN_KEY, msg.token);
      const r = el('role');
      r.className = 'stat ' + msg.team.toLowerCase();
      r.querySelector('b').textContent = msg.team;
    }
    if (msg.type === 'STATE' && msg.view) render(msg.view);
    if (msg.type === 'ERROR') el('brieftext').textContent = msg.error;
  };

  ws.onclose = () => {
    el('brieftext').className = 'text empty';
    el('brieftext').textContent = 'Connection lost. Reload to rejoin.';
  };
}

function render(view) {
  if (!mazeBuilt && view.maze) { scene.buildMaze(view.maze); mazeBuilt = true; }

  scene.applyFog(view.visible ?? []);
  scene.updateActors(view.you, view.others ?? []);
  scene.setExit(view.exit, view.exitOpen);

  el('tickstat').querySelector('b').textContent = `${view.tick}/${view.totalTicks}`;
  el('taskstat').querySelector('b').textContent = `${view.tasksComplete}/${view.tasksToWin}`;
  el('tickbar').style.width = `${(view.tick / view.totalTicks) * 100}%`;

  // Extraction is the win condition, so it gets a line in the HUD the moment
  // it matters — a player who finishes the tasks and isn't told to run has
  // been given no way to act on it.
  const ex = el('exitstat');
  if (ex) {
    ex.hidden = !view.exit;
    ex.classList.toggle('live', Boolean(view.exitOpen));
    ex.querySelector('b').textContent = view.exitOpen
      ? `OPEN (${view.exit.x},${view.exit.y}) · need ${view.survivorsToEscape}`
      : `sealed (${view.exit.x},${view.exit.y})`;
  }

  const bt = el('brieftext');
  if (view.briefing) {
    bt.className = 'text';
    bt.textContent = view.briefing;
  }

  // Teams are public — the roster shows everyone. What it can't show is who's
  // been bought, which is the whole point of the display.
  el('rosterlist').innerHTML = (view.roster ?? []).map(p => `
    <div class="r ${p.team === 'SABOTEUR' ? 'sab' : ''} ${p.alive ? '' : 'dead'}">
      <span class="n">${escapeHtml(p.name)}</span>
      <span class="w">${p.agentGoal}</span>
    </div>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Input ───────────────────────────────────────────────────────────────────

/**
 * First-person input.
 *
 * The server speaks absolute grid deltas (dx, dy) and knows nothing about
 * facing — that stays true. The client turns "forward" into whichever grid
 * axis the player is most nearly looking down, so the protocol is unchanged
 * and the movement still lands on tile centres.
 *
 * Snapping to the dominant axis rather than allowing diagonals is deliberate:
 * the maze is a grid, and a diagonal step would either clip a wall corner or
 * need collision rules the server does not have.
 */

let yaw = 0;
let pitch = 0;

const MOVE = {
  KeyW: [1, 0], ArrowUp: [1, 0],
  KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyA: [0, -1],
  KeyD: [0, 1],
};
// Arrow left/right turn rather than strafe — it's what a keyboard-only player
// expects, and without a turn key a trackpad user cannot look around at all.
const TURN = { ArrowLeft: -1, ArrowRight: 1 };
const TURN_STEP = Math.PI / 8;

/** Project forward/strafe intent onto the dominant grid axis. */
function gridStep(fwd, strafe) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // right
  const vx = fx * fwd + rx * strafe;
  const vz = fz * fwd + rz * strafe;
  if (Math.abs(vx) >= Math.abs(vz)) {
    return Math.abs(vx) > 0.001 ? [Math.sign(vx), 0] : null;
  }
  return Math.abs(vz) > 0.001 ? [0, Math.sign(vz)] : null;
}

let lastMove = 0;
function move(dx, dy) {
  const now = performance.now();
  if (now - lastMove < 110) return;    // movement rate cap
  lastMove = now;
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'MOVE', dx, dy, room: ROOM ?? undefined }));
}

function step(fwd, strafe) {
  const d = gridStep(fwd, strafe);
  if (d) move(d[0], d[1]);
}

addEventListener('keydown', e => {
  if (TURN[e.code] !== undefined) {
    e.preventDefault();
    yaw -= TURN[e.code] * TURN_STEP;
    scene.setLook(yaw, pitch);
    return;
  }
  const m = MOVE[e.code];
  if (m) { e.preventDefault(); step(m[0], m[1]); }
});

// ── Mouse look ──────────────────────────────────────────────────────────────
// Pointer lock is the right feel, but it swallows the cursor — so it is opt-in
// by clicking the view, and Escape gives the cursor back for the HUD.

const stage = el('stage');
const SENS = 0.0022;

stage.addEventListener('click', () => {
  if (!document.pointerLockElement) stage.requestPointerLock?.();
});

addEventListener('mousemove', e => {
  if (document.pointerLockElement !== stage) return;
  yaw -= e.movementX * SENS;
  pitch -= e.movementY * SENS;
  scene.setLook(yaw, pitch);
});

// Drag-to-look for anyone who does not want pointer lock, and for touch.
let dragging = null;
stage.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && document.pointerLockElement) return;
  dragging = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', () => { dragging = null; });
addEventListener('pointermove', e => {
  if (!dragging) return;
  yaw -= (e.clientX - dragging.x) * SENS * 1.6;
  pitch -= (e.clientY - dragging.y) * SENS * 1.6;
  dragging = { x: e.clientX, y: e.clientY };
  scene.setLook(yaw, pitch);
});

// ── On-screen dpad (mobile) ─────────────────────────────────────────────────
// Repurposed to forward/back/turn, because absolute compass directions are
// meaningless once the camera is inside the maze.
for (const b of document.querySelectorAll('#dpad button')) {
  const dx = Number(b.dataset.dx), dy = Number(b.dataset.dy);
  const fire = e => {
    e.preventDefault();
    if (dy === -1) step(1, 0);          // up    → forward
    else if (dy === 1) step(-1, 0);     // down  → back
    else if (dx === -1) { yaw += TURN_STEP; scene.setLook(yaw, pitch); }
    else if (dx === 1) { yaw -= TURN_STEP; scene.setLook(yaw, pitch); }
  };
  b.addEventListener('click', fire);
  b.addEventListener('touchstart', fire, { passive: false });
}

// ── Loop ────────────────────────────────────────────────────────────────────

let prev = performance.now();
(function frame(t) {
  const dt = Math.min((t - prev) / 1000, 0.1);
  prev = t;
  scene.render(dt);
  requestAnimationFrame(frame);
})(prev);
