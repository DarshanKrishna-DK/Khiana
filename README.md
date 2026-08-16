<div align="center">

# KHIANA

### You see one corridor. Your advisor sees everything.

**A first-person maze where an AI advisor guides you through the dark — and it may have been paid, on-chain, to walk you into a wall.**

<br>

[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet%2010143-836EF9?style=for-the-badge&logo=ethereum&logoColor=white)](https://testnet.monadscan.com/)
[![x402](https://img.shields.io/badge/x402-EIP--3009-E5A93C?style=for-the-badge)](https://docs.monad.xyz/guides/x402)
[![three.js](https://img.shields.io/badge/three.js-r169-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3%2070B-F55036?style=for-the-badge)](https://groq.com/)

[![Tests](https://img.shields.io/badge/tests-107%20passing-5FA8A0?style=flat-square)](#-testing)
[![Contracts](https://img.shields.io/badge/contracts-4%20deployed-5FA8A0?style=flat-square)](#-deployed-on-monad-testnet)
[![Licence](https://img.shields.io/badge/licence-MIT-7A8499?style=flat-square)](./LICENSE)

<br>

**[Quick start](#-quick-start)** · **[How it works](#-how-it-works)** · **[On-chain proof](#-deployed-on-monad-testnet)** · **[x402](#-how-x402-actually-works-here)** · **[Architecture](#-architecture)**

</div>

---

<div align="center">

### The one-sentence pitch

*Eight people walk a maze they can barely see. Each has an AI advisor who can see everything.*
*The advisors can pay each other, on-chain, to lie.*

**The audience watches every bribe land. The players never find out until it's over.**

</div>

---

## ⚡ Quick start

No wallet. No API key. No testnet tokens. One command.

```bash
# Windows
khiana.bat play

# macOS / Linux
./khiana.sh play
```

That opens three things:

| | URL | What it is |
|---|---|---|
| 🏠 | `localhost:5173` | Landing page, live lobby browser, how to play |
| 🎮 | `localhost:5173/play.html` | The game, first person |
| 📺 | `localhost:5174` | **Spectator view — this is the one to watch** |

The game runs fully in `MOCK_CHAIN` mode out of the box. Add a `GROQ_API_KEY` for real LLM advisors, an `AGENT_MNEMONIC` for real on-chain settlement. Both optional.

<details>
<summary><b>All launcher commands</b></summary>

```
khiana.bat play        start everything and open both screens
khiana.bat test        run every test suite
khiana.bat headless    watch a full game as text, no browser
khiana.bat playback    replay the last recorded run (demo parachute)
khiana.bat record      play, and save the run for playback
khiana.bat setup       install all dependencies
khiana.bat wallets     show addresses and balances
khiana.bat deploy      deploy contracts to Monad testnet
khiana.bat verify      prove settlement + x402 on testnet
khiana.bat stop        kill anything on our ports
```

Same commands for `./khiana.sh`.
</details>

---

## 🎭 How it works

### The asymmetry

|  | Sees the maze | Sees the advisor channel | Knows who's a saboteur | Knows who's been bought |
|---|:---:|:---:|:---:|:---:|
| **Player** | one corridor | ❌ | ✅ | ❌ |
| **Their advisor** | full map | own chats only | ✅ | own bribes only |
| **Audience** | full map | ✅ **all of it** | ✅ | ✅ **all of it** |

Teams are **public from tick zero**. This is deliberate — it removes the tedious accusation rounds of normal social deduction. The hidden information isn't *who is the traitor*, it's **who has been bought**.

### The tick

Real-time movement, LLM latency and blockchain settlement run at three incompatible speeds. A **15-second tick** reconciles them:

```
DELIBERATE  →  SETTLE  →  BRIEF  →  MOVE
 8 agents      bribes    advisor   you walk
 think in      lock,     speaks    freely
 parallel      x402      2 lines   until next tick
```

Humans move smoothly *inside* a tick. Advisors act only at the **boundary**, all at once — which is what makes betrayal legible to an audience instead of a blur.

### The central tension

> A saboteur can spend **2.00 to Freeze** a target, or **1.00 to bribe that target's own advisor** into walking them somewhere useful.
>
> **Bribery is cheaper than force.** Every saboteur agent works this out within two ticks. That emergent realisation is what the room is there to watch.

---

## ⛓️ Deployed on Monad testnet

All four contracts are live. Every link below was **verified in a browser** — status `Success`, real bytecode, real token transfers.

### Contracts

| Contract | Address | What it does |
|---|---|---|
| **KhianaCredit** | [`0x76b55810…a2CA5`](https://testnet.monadscan.com/address/0x76b558107220526fafC50B813BE56eb3D14a2CA5) | ERC-20 + EIP-3009. The currency x402 requires. 40 KHIA minted once, **no `mint()` exists** |
| **KhianaEscrow** | [`0x51dD09Ee…Cc46B`](https://testnet.monadscan.com/address/0x51dD09Eeb6751D334CF7aC847A5531a86d5Cc46B) | Holds bribes until the engine attests delivery |
| **PowerupShop** | [`0xaF49bF78…48075`](https://testnet.monadscan.com/address/0xaF49bF781754bEb0F15FEb2aa378dB72e5948075) | Burns credits permanently. `totalSupply` actually falls |
| **RoleCommit** | [`0x1d04e66B…04d8F`](https://testnet.monadscan.com/address/0x1d04e66B65A7B86ee6700980e852A66447204d8F) | Commit-reveal so the host can't reassign teams mid-game |

### Live transaction proofs

| What it proves | Transaction |
|---|---|
| 💸 **Contact fee over x402** — advisor pays advisor 0.25 KHIA, signed but never broadcast by the payer | [`0x4f1769d5…c975`](https://testnet.monadscan.com/tx/0x4f1769d5e58111bbbc1b2739bfc38dc1fc37e55eeab51629f72125e3bce2c975) |
| 🔥 **Powerup burn** — supply fell 39 → 38 KHIA, genuinely destroyed | [`0xf5735042…eef7`](https://testnet.monadscan.com/tx/0xf573504278e2f112e026b76c1b53a86436f59cbe19c4cba842c4655d73b3eef7) |
| 🤝 **Escrow release** — bribe held in custody, paid only on engine attestation | [`0xdcd6f9aa…b420`](https://testnet.monadscan.com/tx/0xdcd6f9aa86df0c235dcc3a4525f6e3a213daef757fe01cf0bec7c8e9721cb420) |
| ✍️ **EIP-3009** — a third party submitted a transfer the holder only *signed* | [`0x9d5ca3d9…a741`](https://testnet.monadscan.com/tx/0x9d5ca3d9a84a7ebbfaccf65d4dc55f7e40956ec6c860743d5e2563c79e3ea741) |

Engine wallet: [`0x2db80CD0…2ed73`](https://testnet.monadscan.com/address/0x2db80CD0c660FfDB701B0980362A9E118902ed73)

Reproduce any of it yourself:

```bash
cd server && npm run x402      # 21 live checks against Monad testnet
cd server && npm run phase1    # settlement acceptance
```

---

## 🔌 How x402 actually works here

**Every advisor-to-advisor payment travels over the real x402 protocol.** Not a wrapper, not a mock:

```
1. Advisor requests a resource        POST /x402/bribe
2. Server refuses, quotes the price   402 + {asset, amount, payTo, EIP-712 domain}
3. Advisor signs an authorization     EIP-3009, off-chain, no gas
4. Advisor retries with the signature X-PAYMENT header
5. Engine settles it on Monad         funds move, resource served
```

Three paid resources: `/x402/contact` · `/x402/powerup` · `/x402/bribe`

<details>
<summary><b>Why we minted our own token instead of using native MON</b></summary>

<br>

**x402 cannot move native MON.** The `exact` scheme settles through EIP-3009 `transferWithAuthorization` — an ERC-20 method. Native tokens have no such entry point. Verified against the live facilitator:

```bash
POST /verify  { asset: "0x000...000" }
→ {"isValid": false, "invalidReason": "unsupported_scheme"}
```

So the currency *had* to be a compliant ERC-20. `KhianaCredit` is that. Native MON is now gas only.

It also removed a hard blocker: the public faucet drips a few MON per address per day, which made funding eight advisors at 5 each impossible. Minting a fixed 40-token supply once solved that.

**Monetary policy is unchanged.** The entire supply is minted in the constructor; there is no `mint()` function. In-game, credits only move (contacts, bribes) or burn (powerups). The pool shrinks all game, exactly as designed.
</details>

<details>
<summary><b>Monad-specific behaviour we had to design around</b></summary>

<br>

**Reserve balance.** A transaction reverts if the sender's ending balance drops below `min(starting_balance, 10 MON)`. Advisors hold 5 credits, so every payment would revert — except via the "emptying transaction" exception, which requires no other tx from that account in the previous 3 blocks (~1.2s). `economy/wallets.js` serialises each advisor to one send per 1.5s. Free at a 15s tick, fatal if removed.

**Gas is billed on `gas_limit`, not gas used.** Unlike Ethereum, an inflated estimate is a real cost. Native transfers are hardcoded to 21,000; contract estimates get a 10% buffer and no more.

**Cancun/MCOPY.** OpenZeppelin 5.6 compiles to `MCOPY` (EIP-5656), which needs the Cancun EVM target. We proved Monad executes it on testnet rather than assuming — a wrong guess there deploys cleanly and fails at runtime.

**Sub-second finality is why the 15s tick works.** On a slower chain the tick stretches to 40s to fit settlement, and the game stops being a game.
</details>

---

## 🕹️ Playing

| Input | Action |
|---|---|
| `W` `S` | Walk forward / back, relative to where you're facing |
| `A` `D` | Strafe |
| `←` `→` | Turn |
| Mouse | Look (click the view for pointer lock) |
| Touch | Drag to look, on-screen pad to move |

Your advisor **speaks its briefing aloud** through the browser's speech synthesis. You are looking at a wall — the instruction has to reach you through your ears.

**Sound cues** are synthesised, not sampled (no audio files ship): tick, footstep, wall bump, bribe settling, task complete, elimination, extraction opening.

---

## 🧠 The advisors

Powered by **Groq** (`llama-3.3-70b-versatile`, ~1.9s latency). Each advisor carries two weighted goals:

- **Survive** — my human lives to the end
- **Enrich** — maximise my credit balance

The human sets that weight before the game and **it is public**. Everyone can see how corruptible your advisor is. Nobody can see whether it has actually been bought.

Betrayal isn't scripted. Each advisor runs a treasury calculation comparing its expected share of the winning pot against the bribe on the table. Raise your advisor's retainer and it genuinely becomes harder to buy.

> **No API key?** A deterministic fallback brain plays a competent, boring game. Nothing breaks.

---

## 🏗️ Architecture

```
client/       first-person three.js game + landing page + lobby browser
spectator/    the demo screen: full map, live advisor channel, bribe ticker
server/       authoritative engine, fog of war, agents, x402 resource server
contracts/    KhianaCredit · KhianaEscrow · PowerupShop · RoleCommit
```

<details>
<summary><b>The one security property that matters</b></summary>

<br>

**Fog of war is computed server-side and never sent to the client.** If the full state were shipped and hidden in the renderer, anyone could open devtools and win. `server/src/game/fog.js` is the boundary, and there is a test asserting that a player packet never contains the advisor channel or the ledger.

Visibility is two-part: a tight radius bubble around you, plus rays that carry ~7 tiles straight down an open corridor and stop dead at the first wall. A plain radius is wrong in both directions at once — too generous sideways, far too mean down a long hallway.
</details>

---

## 🧪 Testing

```bash
khiana.bat test       # or ./khiana.sh test
```

| Suite | Count | Covers |
|---|:---:|---|
| `server/game.test.mjs` | 53 | maze, exit, win conditions, elimination, fog boundary, powerup conflicts, commit-reveal |
| `server/integration.test.mjs` | 19 | live server, sockets, information boundary, tick engine |
| `contracts` (hardhat) | 35 | EIP-3009, escrow x402 + allowance paths, commit-reveal, burn |
| `server/scripts/x402.mjs` | 21 | **live** Monad testnet x402 handshake + replay protection |
| `server/scripts/phase1.mjs` | 21 | **live** settlement acceptance |

<details>
<summary><b>Bugs the browser caught that reading code did not</b></summary>

<br>

- **The 3D maze rendered nothing.** `renderer.info` proved 6 draw calls and 29,208 triangles every frame — the scene fog was hardcoded to `Fog(ink, 14, 30)` while the camera sat ~33.6 units back, so the entire world was past the far plane.
- **`REVEAL` (1.00) granted nothing** — every advisor already had every position for free, which also meant `GHOST` hid nobody and the documented conflict could never fire.
- **`LANTERN` (0.75) cancelled `BLACKOUT` (2.00)** back to normal vision — the cheap powerup beating the expensive one, the exact inverse of the rule.
- **Explorer links rendered for *mock* tx hashes**, which are well-formed and indistinguishable from real ones. The server now declares chain mode.
- **Seat assignment was deterministic** — always `p1`, so the same server always gave you the same team.
</details>

---

## ⚠️ Honest caveats

- **Testnet only.** Valueless tokens by design. Framed as retainers and commissions, not gambling.
- **The engine is a trusted attestor.** Monad guarantees a payment can't be reneged on, reordered or erased. It does *not* independently verify that a human reached a tile — the game engine asserts that. Real centralisation, named rather than hidden.
- **The x402 resource server is hand-rolled**, not the official `@x402/next` middleware. It's fully tested, but it is ours.
- **The `upto` scheme is unused.** Variable-amount payments would fit bribe negotiation better than `exact`, but it's Permit2-only and that's real work.

---

<div align="center">

Built for **Monad Blitz Bangalore**

<sub>MIT licensed · testnet only · valueless tokens</sub>

</div>
