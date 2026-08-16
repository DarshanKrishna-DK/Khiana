# BLINDSIDE

**A 3D fog-of-war maze where you can't see, your AI advisor can — and it may have been paid to lie to you.**

Built for Monad Blitz Bangalore V5.

---

## The idea in three lines

Eight humans in a maze they can barely see. Each is paired with an AI agent that sees everything and tells them where to go. Agents can pay each other, on-chain, to corrupt what they say.

**The audience sees the agent channel. The players don't.**

That's the whole product. The room watches an agent take a bribe, then watches its human trust it.

---

## Quickstart

```bash
# 1. Server (runs fully offline by default)
cd server && npm install && npm run dev

# 2. Player client
cd client && npm install && npm run dev      # :5173

# 3. Spectator view  ← this is the demo screen
cd spectator && npm install && npm run dev   # :5174

# 4. Start a game
curl -X POST http://localhost:8787/game/start
```

**Fastest way to see it work — no browser, no keys, ~2 seconds:**

```bash
cd server && npm run headless 42
```

That runs a full 40-tick game and prints the ledger reveal, including which agents took bribes and whether they honoured them.

---

## Current state — read this before you build

Verified working:

- Tick engine, four-phase state machine, 40 ticks
- Maze generation with loop carving; server-authoritative fog of war
- All 5 task types, elimination rule, win conditions
- Agent deliberation with two-goal treasury calculation
- Bribe negotiation, contact fees, 12 powerups
- Ledger with per-agent reveal
- Bot fill for every seat
- 3D isometric client + spectator channel view
- Contracts written (escrow, role commit, powerup shop)

**Balance verified across four seeds** (`42`, `7`, `99`, `2024`): tasks land at 2–4 of 5, wins split evenly between teams, ~15 of 40 MON burns per game. The economy behaves.

Integration test passes 19/19 (`node integration.test.mjs`), including the two assertions that matter most: a player's state packet contains neither the agent channel nor the ledger, and fog restricts them to ~20 of 2401 tiles. Client and spectator both build clean.

### Known gaps — fix these first

1. **x402 settlement is unverified against live Monad testnet.** Written to spec from the docs, runs in mock mode. `MOCK_CHAIN=true` is the default. **This is Phase 1 and it blocks everything** — see `docs/BUILD_PHASES.md`.
2. **Contracts compile-ready but untested.** No test suite, never deployed.
3. **Agent prompts are first-draft.** The eight personalities need tuning until they're distinguishable within one round of negotiation — that difference has to be legible to the audience or the bribery layer feels flat.
4. **Elimination rate is low with bots.** Kills now fire on roughly 3 of 5 seeds. Bots path straight to task tiles and cluster, which creates witnesses. Real humans scatter more, but watch this in playtest — if Saboteurs can't get kills, they can only win on the clock.
5. **The three-clock problem is handled but untested under load.** Agent deliberation runs in parallel with an 8s cap; with a real API key and 8 agents, confirm the DELIBERATE phase fits inside the tick.

---

## Repo layout

```
docs/
  PRD.md            Product requirements, full design rationale
  POWERUPS.md       12-item catalogue + balance invariants
  BUILD_PHASES.md   Nine phases, time budget, resources
  DEMO_SCRIPT.md    Stage plan
CHANGELOG.md        ⚠️ Update on every change. Protocol at the top of the file.

server/             Authoritative. Tick engine, fog, agents, settlement.
  src/game/         engine · maze · fog · tasks · powerups
  src/agents/       agent · prompts · llm · bots
  src/economy/      ledger · x402
  src/headless.js   Fast text-only runner
client/             Player view. three.js isometric, fog of war.
spectator/          The demo screen. Full map + agent channel + reveal.
contracts/          BlindsideEscrow · RoleCommit · PowerupShop
```

---

## Two rules that matter

**Fog of war is computed server-side and never sent to the client.** If you send full state and hide it in the renderer, anyone opens devtools and wins. This is the only security property in the project that actually matters. See `server/src/game/fog.js`.

**Update `CHANGELOG.md` on every change.** Especially economy changes — powerup pricing is the most fragile part of the design, and an untracked price change is how it silently breaks. The `Balance` category and the invariants exist for this reason.

---

## Where Monad is load-bearing

In strength order, and worth being able to recite on stage:

1. **Escrowed conditional bribes.** Two agents on opposing teams can't trust each other and can't build trust in ten minutes. The contract holds the money and releases on engine confirmation.
2. **The ledger reveal.** Every bribe published at game end. Worthless if the host could fabricate it.
3. **Sub-second finality is why 15-second ticks work.** On a slower chain the tick becomes 40 seconds and the game is dead.
4. **Commit-revealed roles.** Proves nothing was adjusted mid-game.

Honest caveat worth stating rather than hiding: the engine is a trusted attestor for whether a human reached a tile. What the chain guarantees is that payments can't be reneged, reordered, or quietly erased — which is what makes the reveal believable.

---

## Configuration

Everything tunable lives in `server/src/config.js`. Copy `.env.example` to `.env`.

- No `ANTHROPIC_API_KEY` → deterministic fallback brain. Fully playable.
- `MOCK_CHAIN=true` (default) → zero network. This is also your demo parachute.

---

Testnet only. Valueless tokens. Framed as retainers and commissions.
