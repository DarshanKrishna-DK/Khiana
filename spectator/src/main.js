const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
// Monad testnet explorer. Env-overridable so a mainnet or alternate-explorer
// deployment needs no code change.
const EXPLORER = import.meta.env.VITE_EXPLORER ?? 'https://testnet.monadscan.com';

import { unlock, sfx, startAmbience, setTension } from './audio.js';

const el = id => document.getElementById(id);
const cv = el('cv');
const ctx = cv.getContext('2d');

// Canvas colours are duplicated from the CSS custom properties because a 2D
// context cannot read them. Keep this block in sync with :root in index.html.
const C = {
  ink: '#0E091C', fog: '#1E1440', edge: '#2C1F5C', floor: '#150E2B',
  bone: '#DDD7FE', muted: '#8778BE', amber: '#85E6FF',
  rust: '#FF8EE4', violet: '#6E54FF', teal: '#85E6FF',
};

let state = null;
let seen = 0;
const envelopes = [];   // in-flight bribe animations

// ── Canvas sizing ───────────────────────────────────────────────────────────
function fit() {
  const r = cv.parentElement.getBoundingClientRect();
  cv.width = r.width * devicePixelRatio;
  cv.height = r.height * devicePixelRatio;
  cv.style.width = r.width + 'px';
  cv.style.height = r.height + 'px';
}
addEventListener('resize', fit);
fit();

// ── Network ─────────────────────────────────────────────────────────────────
const ws = new WebSocket(WS_URL);
ws.onopen = () => ws.send(JSON.stringify({ type: 'SPECTATE' }));
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.type !== 'SPECTATE_STATE' || !msg.view) return;
  state = msg.view;
  paintHud();
  paintFeed();
  if (state.phase === 'REVEAL') showReveal();
};

// ── Board ───────────────────────────────────────────────────────────────────
function drawBoard() {
  if (!state?.maze) return;
  const n = state.maze.length;
  const s = Math.min(cv.width, cv.height) / n;
  const ox = (cv.width - s * n) / 2;
  const oy = (cv.height - s * n) / 2;

  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, cv.width, cv.height);

  // Maze. Spectators see the whole thing — that's the point of this screen.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = state.maze[y][x] === 1 ? C.fog : C.floor;
      ctx.fillRect(ox + x * s, oy + y * s, s - 0.5, s - 0.5);
    }
  }

  // Task tiles
  for (const t of (state.tasks ?? [])) {
    if (!t.revealed || t.complete) continue;
    for (const tile of t.tiles) {
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = Math.max(1, s * 0.16);
      ctx.strokeRect(ox + tile.x * s, oy + tile.y * s, s, s);
    }
  }

  // Extraction point. The audience needs it to read the endgame — once the
  // tasks are done, every remaining decision is about this tile.
  if (state.exit) {
    const ex = ox + state.exit.x * s, ey = oy + state.exit.y * s;
    ctx.strokeStyle = state.exitOpen ? C.amber : 'rgba(232,227,217,.35)';
    ctx.lineWidth = Math.max(1.5, s * 0.2);
    ctx.strokeRect(ex, ey, s, s);
    if (state.exitOpen) {
      // Pulse only when it's live, so "open" reads as an event.
      const pulse = 0.5 + Math.sin(performance.now() * 0.004) * 0.5;
      ctx.fillStyle = `rgba(133,230,255,${0.15 + pulse * 0.35})`;
      ctx.fillRect(ex, ey, s, s);
    }
  }

  const at = p => ({ x: ox + p.pos.x * s + s / 2, y: oy + p.pos.y * s + s / 2 });

  // Bribe envelopes in flight — the "owl". Every one of these is a settled
  // transaction, not decoration.
  for (const e of envelopes) {
    const from = state.players.find(p => p.id === e.from);
    const to = state.players.find(p => p.id === e.to);
    if (!from || !to) continue;
    const a = at(from), b = at(to);
    const t = e.t;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * s * 2.5;

    ctx.strokeStyle = `rgba(133,230,255,${0.35 * (1 - t)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    ctx.fillStyle = C.amber;
    ctx.fillRect(x - s * .3, y - s * .2, s * .6, s * .4);
    ctx.fillStyle = C.ink;
    ctx.font = `600 ${Math.max(7, s * .3)}px 'Roboto Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(e.amount), x, y + s * .12);
  }

  // Players
  for (const p of (state.players ?? [])) {
    const c = at(p);
    const r = s * 0.4;

    if (!p.alive) {
      ctx.strokeStyle = 'rgba(135,120,190,.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y - r); ctx.lineTo(c.x + r, c.y + r);
      ctx.moveTo(c.x + r, c.y - r); ctx.lineTo(c.x - r, c.y + r);
      ctx.stroke();
      continue;
    }

    // A violet halo marks an agent that has taken money. The audience
    // reads corruption at a glance; the player never will.
    if (p.bribed) {
      ctx.fillStyle = 'rgba(110,84,255,.30)';
      ctx.beginPath(); ctx.arc(c.x, c.y, r * 2.1, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = p.team === 'SABOTEUR' ? C.rust : C.teal;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ── HUD ─────────────────────────────────────────────────────────────────────
function paintHud() {
  if (!state) return;
  el('tick').textContent = `${state.tick}/${state.totalTicks}`;
  el('tasks').textContent = `${state.tasksComplete}/5`;
  el('alive').textContent = state.players.filter(p => p.alive).length;

  const bribes = (state.ledger?.entries ?? []).filter(e => e.kind === 'BRIBE');
  el('bribed').textContent = bribes.reduce((s, e) => s + e.amount, 0).toFixed(2);
  el('burned').textContent = (state.ledger?.burned ?? 0).toFixed(2);
  el('betrayals').textContent = bribes.filter(e => e.followed).length;

  const max = Math.max(5, ...state.players.map(p => p.balance));
  el('treasuries').innerHTML = state.players.map(p => `
    <div class="tr ${p.team === 'SABOTEUR' ? 'sab' : ''} ${p.alive ? '' : 'dead'} ${p.bribed ? 'bought' : ''}">
      <div class="nm">${esc(p.name)}</div>
      <div class="bar"><i style="width:${(p.balance / max) * 100}%"></i></div>
      <div class="amt">${p.balance.toFixed(2)}</div>
    </div>`).join('');
}

// ── Channel feed ────────────────────────────────────────────────────────────
function paintFeed() {
  const feed = el('feed');
  const msgs = state.channel ?? [];
  const fresh = msgs.slice(seen);
  seen = msgs.length;

  for (const m of fresh) {
    if (m.kind === 'BRIBE_SETTLED') {
      envelopes.push({ from: m.from, to: m.to, amount: m.amount, t: 0 });
      // Money changing hands is the beat the audience is here for.
      sfx.bribe();
    }
    if (m.kind === 'ELIMINATION') sfx.elimination();
    if (m.kind === 'POWERUP') sfx.powerup();
    if (m.kind === 'BRIBE_OFFER') sfx.briefing();
    const node = document.createElement('div');
    node.className = 'msg ' + cls(m);
    node.innerHTML = body(m);
    feed.appendChild(node);
  }

  while (feed.children.length > 80) feed.removeChild(feed.firstChild);
  if (fresh.length) feed.scrollTop = feed.scrollHeight;
}

function cls(m) {
  if (m.kind === 'BRIEFING') return m.corrupted ? 'corrupt' : '';
  if (m.kind === 'BRIBE_SETTLED') return 'settled';
  if (m.kind === 'BRIBE_OFFER' || m.kind === 'BRIBE_COUNTER') return 'bribe';
  if (m.kind === 'ELIMINATION') return 'kill';
  if (m.kind === 'AUDIT') return 'audit';
  if (m.kind === 'SYSTEM') return 'system';
  return '';
}

/**
 * Explorer link for a settled payment.
 *
 * Mock runs mint fake hashes (economy/x402.js), and a dead link on the demo
 * screen is worse than no link — it invites someone to click and find
 * nothing. Only real 32-byte hashes get one.
 */
function txLink(hash) {
  if (!hash || !/^0x[0-9a-f]{64}$/i.test(hash)) return '';

  // A mock hash is a perfectly well-formed 32-byte value — you cannot tell it
  // from a real one by looking, so the server tells us. Label it instead of
  // linking: honest, and it still shows settlement happened.
  if (state?.mockChain) return `<span class="tx muted">mock settlement</span>`;

  const base = state?.explorer ?? EXPLORER;
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return `<a class="tx" href="${base}/tx/${hash}" target="_blank" rel="noopener">${short} ↗</a>`;
}

function body(m) {
  const meta = `t${m.tick} · ${m.from ?? 'system'}${m.to ? ` → ${m.to}` : ''}`;
  let text = esc(m.text ?? m.kind);

  if (m.kind === 'BRIBE_SETTLED') {
    // The link is the proof. Without it the audience has to take the host's
    // word that money actually moved, which is the one thing the chain is
    // here to make unnecessary.
    text = `${m.amount} KHIA settled for "${esc(m.instruction ?? '')}" ${txLink(m.txHash)}`;
  }
  if (m.kind === 'BRIBE_OFFER' || m.kind === 'BRIBE_COUNTER') {
    text = `${m.amount ?? ''} KHIA · ${esc(m.text ?? '')}`;
  }

  // The dramatic-irony marker. This is the single most important line on
  // the whole screen.
  const tag = (m.kind === 'BRIEFING' && m.corrupted)
    ? `<div class="tagline">↑ this advisor has been paid</div>` : '';

  return `<div class="meta">${meta}</div><div class="body">${text}</div>${tag}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Reveal ──────────────────────────────────────────────────────────────────
async function showReveal() {
  const res = await fetch(`${API}/game/reveal`).then(r => r.json()).catch(() => null);
  if (!res) return;

  el('rvwin').textContent = `${res.winner} WIN`;
  el('rvsub').textContent =
    `${res.totalBribed} MON changed hands · ${res.betrayals} betrayals honoured · ${res.totalBurned} MON burned`;

  el('rvrows').innerHTML = Object.entries(res.perAgent).map(([id, a]) => `
    <div class="row">
      <div class="nm ${a.team === 'SABOTEUR' ? 'sab' : ''}">${esc(a.player)}${a.alive ? '' : ' ☠'}</div>
      <div>${a.team}</div>
      <div class="bal">${a.finalBalance}</div>
      <div class="took">
        ${a.received.length
          ? a.received.map(r =>
              `paid <b>${r.amount}</b> by ${r.from} to "${esc(r.memo ?? '')}" ${r.followed ? '<span class="hon">[HONOURED]</span>' : '[ignored]'} ${txLink(r.txHash)}`
            ).join('<br>')
          : '<span style="opacity:.4">never took a cent</span>'}
      </div>
    </div>`).join('');

  renderRoleCommit(res.roleCommit);
  el('reveal').classList.add('on');
}

/**
 * The commit-reveal proof (PRD §10.4).
 *
 * Shown with the commitment published BEFORE tick 1 next to the roles opened
 * after the last one. A developer in the room can hash the second and check
 * it equals the first, which is the entire point — the host could not have
 * reassigned anybody once the game started going badly.
 */
function renderRoleCommit(rc) {
  const box = el('rolecommit');
  if (!box) return;
  if (!rc) { box.hidden = true; return; }
  box.hidden = false;

  const verdict = rc.revealed
    ? (rc.verified
        ? '<span class="ok">✓ roles match the pre-game commitment</span>'
        : '<span class="bad">✗ COMMITMENT MISMATCH</span>')
    : '<span class="pending">opening commitment…</span>';

  box.innerHTML = `
    <h3>ROLE COMMITMENT ${rc.mocked ? '<em>(mock)</em>' : ''}</h3>
    <div class="rc-line"><span>committed before tick 1</span><code>${esc(rc.commitment)}</code>
      ${rc.committedUrl ? `<a class="tx" href="${rc.committedUrl}" target="_blank" rel="noopener">tx ↗</a>` : ''}</div>
    ${rc.revealed ? `
      <div class="rc-line"><span>roles</span><code>${esc(rc.roles)}</code></div>
      <div class="rc-line"><span>salt</span><code>${esc(rc.salt)}</code>
        ${rc.revealUrl ? `<a class="tx" href="${rc.revealUrl}" target="_blank" rel="noopener">tx ↗</a>` : ''}</div>` : ''}
    <div class="rc-verdict">${verdict}</div>`;
}

// ── Sound ───────────────────────────────────────────────────────────────────
// Autoplay is blocked without a gesture, so this is a real button rather than
// an attempt that silently fails.
el('sound')?.addEventListener('click', e => {
  unlock();
  startAmbience();
  e.currentTarget.classList.add('on');
  e.currentTarget.textContent = 'SOUND ON';
  e.currentTarget.disabled = true;
});

// ── Loop ────────────────────────────────────────────────────────────────────
(function frame() {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    envelopes[i].t += 0.018;
    if (envelopes[i].t >= 1) envelopes.splice(i, 1);
  }
  drawBoard();
  requestAnimationFrame(frame);
})();
