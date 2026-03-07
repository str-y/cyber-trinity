# CYBER TRINITY — Battle Trinity 3-Team Jewel Combat

A cyberpunk 3-team real-time territory control action game inspired by
Dragon Quest X's "Battle Trinity". Set in a rain-soaked, neon-lit datacenter city,
rendered with **Lumen** global illumination, **Nanite** virtualized geometry,
volumetric fog, and cinematic post-process.

---

## Class Structure Diagram

```
Game (world state, update loop)
 ├── Base (TriLock)
 │    ├─ faction: string | null     ← owning faction or neutral
 │    ├─ isHome: boolean            ← true for spawn bases (un-capturable)
 │    ├─ captureProgress: 0–100     ← current capture meter
 │    ├─ captureFaction: string     ← who is capturing
 │    ├─ level: 0–3                 ← delivery bonus ×1 / ×1.25 / ×1.5
 │    ├─ tryCapture(counts, dt)     ← resolve capture per frame
 │    └─ deliverJewel(value) → score
 │
 ├── Player (Agent)
 │    ├─ faction: string            ← blue / green / red
 │    ├─ job: string                ← warrior / mage / healer / scout
 │    ├─ carrying: Jewel[]          ← up to 5 jewels
 │    ├─ skills[0]: primary         ← Power Slash / Railshot / Bio Shield / Quick Dash
 │    ├─ skills[1]: secondary       ← War Cry / Ice Wall / Purify / Smoke Bomb
 │    ├─ ultimate                   ← Blade Storm / Meteor Strike / Sanctuary / Shadow Step
 │    ├─ role: string               ← collector / fighter / defender (AI)
 │    ├─ tryAbility(world)          ← fire primary skill → Projectile
 │    └─ dropAllJewels(world)       ← death penalty
 │
 ├── MemoryCrystal (Jewel)
 │    ├─ tier: normal / rare / legendary
 │    ├─ value: 5 / 15 / 25
 │    └─ tierColor: hex             ← visual colour per tier
 │
 ├── Projectile                     ← ability effects (railshot / bioshield / powerdash / …)
 ├── Particle                       ← visual sparks
 └── RainDrop                       ← ambient rain
```

### Inheritance / Composition

- `Game` owns arrays of `Base`, `Player`, `MemoryCrystal`, `Projectile`, `Particle`, `RainDrop`.
- `Player.carrying` is an array of `MemoryCrystal` references (max 5).
- `Base.tryCapture()` is called by `Game._updateTriLocks()` each frame.
- `Player.tryAbility()` creates and returns a `Projectile`.

---

## Game Rules (Battle Trinity)

| Rule | Detail |
|------|--------|
| **Teams** | 3 teams × 5 agents (5v5v5) |
| **Match length** | 5 minutes (300 s countdown) |
| **Victory** | Team with the most **win points** when time expires |
| **Jewel delivery** | Pick up jewels → deliver to any owned base (home or captured TriLock) |
| **TriLock capture** | Stand inside a neutral/enemy TriLock to capture it; contested = no progress |
| **Death penalty** | On death, drop ALL carried jewels on the ground |
| **Hate control** | AI fighters bias toward the leading team; HUD highlights 1st place |

---

## Factions

| Colour | Name | Role | Base |
|--------|------|------|------|
| 🔵 Blue  | **The Archive**      | Data Sniper   | Animated server rack — energy rifle snipers on high ground |
| 🟢 Green | **Life Forge**       | Bio Guard     | Bionic tree — shield-wall warriors, close-range AoE heal |
| 🔴 Red   | **Core Protocol**    | Core Striker  | Furnace core — power-fist dash, highest movement speed |

---

## Job System

Each team fields 5 agents across 4 jobs (index 0–4: Warrior, Mage, Healer, Scout, Warrior):

| Job | Emoji | Speed | HP | Skills | Ultimate |
|-----|-------|-------|----|--------|----------|
| **Warrior** | ⚔️ | 72 | 130 | Power Slash (30 dmg), War Cry (buff) | Blade Storm (45 dmg) |
| **Mage** | 🔮 | 55 | 80 | Railshot (35 dmg), Ice Wall (zone) | Meteor Strike (50 dmg) |
| **Healer** | 💚 | 60 | 100 | Bio Shield (heal aura), Purify (cleanse) | Sanctuary (mass heal) |
| **Scout** | 💨 | 95 | 85 | Quick Dash (20 dmg), Smoke Bomb (stealth) | Shadow Step (30 dmg) |

---

## Jewel Value Tiers

| Tier | Value | Colour | Spawn Zone | Weight |
|------|-------|--------|------------|--------|
| **Normal** | 5 pts | 💠 Blue | Entire field | 60% |
| **Rare** | 15 pts | 💜 Purple | Inner 50% | 30% |
| **Legendary** | 25 pts | 🌟 Gold | Centre 30% | 10% |

- Higher-value jewels spawn closer to the centre of the map.
- Every 20 seconds a bonus Rare or Legendary jewel appears at the centre.
- Delivery score is multiplied by the TriLock's level bonus (Lv1 ×1, Lv2 ×1.25, Lv3 ×1.5).

---

## TriLock Capture Logic (Sample)

```javascript
// Base.tryCapture(counts, dt)
// counts = { blue: N, green: N, red: N } — alive players in range per faction
//
// 1. If 2+ factions present → contested, no progress
// 2. If attacker ≠ current owner → decay existing progress (slower at higher levels)
// 3. If decay reaches 0 → base becomes neutral
// 4. If attacker == captureFaction → build progress at CAPTURE_SPEED × count × dt
// 5. When progress reaches CAPTURE_MAX (100) → base claimed by attacker
//
// Tuning constants:
//   CAPTURE_RANGE = BASE_RADIUS + 20 px
//   CAPTURE_SPEED = 20 progress/s per player
//   CAPTURE_MAX   = 100
//   Level decay defense = 1 + (level × 0.5)
```

---

## Scoring

| Action | Points |
|--------|--------|
| Normal Jewel delivery (Lv1 base) | +5 |
| Rare Jewel delivery (Lv1 base) | +15 |
| Legendary Jewel delivery (Lv1 base) | +25 |
| Delivery × Lv2 bonus (×1.25) | e.g. +6 / +19 / +31 |
| Delivery × Lv3 bonus (×1.5) | e.g. +8 / +23 / +38 |
| Eliminate enemy agent | +5 |
| Assist (damage within 5 s) | +2 |

---

## Mechanics

- **15 agents** compete simultaneously (5v5v5), each with a job class.
- **Jewels** (`MemoryCrystal`) — value-tiered glowing polyhedra scattered across the field.
  Agents pick them up (carry up to 5) and deliver them to an owned base for points.
- **TriLock bases** — 5 neutral hexagonal bases scattered in a ring at the centre.
  Capture by standing in range; level up through deliveries.
- **Death penalty** — killed agents drop ALL carried jewels on the ground.
- **Hate control** — AI fighters target the leading team 60% of the time.
- **Combat scoring**: defeating an enemy agent grants **+5 points**, and recent damage contributors receive an **assist +2 points**.
- **Chaos events** fire every 30 s: EMP Storm, Crystal Rain, Nexus Overload.
- **Feature contracts** chain: Overclock Uplink → Deploy Firewall → Core Meltdown.

---

## Project Structure

```
CyberTrinity.uproject                  ← UE 5.4 project descriptor
Config/
  DefaultEngine.ini                    ← Lumen, Nanite, TSR, volumetric fog settings
  DefaultGame.ini                      ← Match rules, faction defaults
  DefaultInput.ini                     ← Enhanced Input action bindings
Source/CyberTrinity/
  CyberTrinity.Build.cs                ← Module build rules
  Factions/
    FactionDefinition.h/.cpp           ← Data asset: colours, speeds, FX refs
    DataNode.h/.cpp                    ← Base actor: shield, delivery zone, Lumen light
  Characters/
    AgentCharacter.h/.cpp              ← Base agent: health, crystal carry, neon armour MID
  Pickups/
    MemoryCrystal.h/.cpp               ← Pickup: pulsing emissive, Lumen point light, dissolve
  GameFramework/
    CyberTrinityGameMode.h/.cpp        ← Spawn 15 agents, crystal pool, respawn timers
    CyberTrinityGameState.h/.cpp       ← Replicated scores, event feed, win condition
  HUD/
    CyberTrinityHUD.h/.cpp             ← UMG holographic overlay, score/status/event feed
Content/Blueprints/
  BlueprintStubs.txt                   ← Blueprint & asset creation guide for the editor
index.html / src/ / styles/            ← Browser preview (JS visualisation)
```

---

## Building & Running (Unreal Engine 5.4)

### Prerequisites

- Unreal Engine 5.4 installed via Epic Games Launcher
- Visual Studio 2022 (Windows) or Xcode 15 (macOS) with C++ workload

### Steps

```bash
# 1. Right-click CyberTrinity.uproject → "Generate Visual Studio project files"
# 2. Open CyberTrinity.sln and build the Development Editor configuration
# 3. Double-click CyberTrinity.uproject to open the Unreal Editor
# 4. Follow Content/Blueprints/BlueprintStubs.txt to create Blueprints and assets
# 5. Open Maps/CyberTrinityLevel and press Play (or package for shipping)
```

### Key console variables (in-editor)

```
r.Lumen.HardwareRayTracing 1   ← enable HW ray-traced Lumen (requires RTX/RDNA2+)
r.VolumetricFog 1              ← smog / rain volumetric atmosphere
r.FilmGrain 1                  ← cinematic film grain overlay
ShowDebug HUD                  ← toggle debug score overlay
```

---

## Browser Preview

A JavaScript canvas visualisation of the same scene is available without UE5:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Controls (browser preview):

- `W/A/S/D` or Arrow keys: move the local blue agent (`YOU`)
- `Space`: activate job ability (Warrior: Power Slash) when charged
- `Tab`: lock the nearest enemy and show a direction indicator / target marker
- `E`: manually drop one carried jewel for tactical hand-offs
- `Q`: issue a temporary rally signal so nearby blue AI reprioritise around your position

---

## AI Roles

Each faction's 5 agents are assigned specialised roles based on their job class:

| Job | Role | Behaviour |
|-----|------|-----------|
| **Scout / Healer** | Collector | Jewel retrieval specialist — strongly prefers picking up jewels and delivering them. |
| **Warrior (idx 0) / Mage** | Fighter | Enemy elimination specialist — seeks out and attacks enemy agents. Biased toward the leading team (hate control). |
| **Warrior (idx 4)** | Defender | Base patrol guard — stays within patrol radius, engages intruders, grabs nearby jewels. |

---

## Feature Contract Chain

The game includes a progressive **feature contract** system. As factions reach score
milestones, special contracts activate, granting a temporary faction-wide buff and a
score bonus. The HUD panel in the top-right tracks the current contract.

| # | Contract | Faction | Trigger | Buff | Bonus |
|---|----------|---------|---------|------|-------|
| 1 | **Activate Overclock Uplink** | 🔵 The Archive | Score ≥ 100 | 1.5× speed, 2× energy regen for 6 s | +15 |
| 2 | **Deploy Firewall** | 🟢 Life Forge | Score ≥ 120 | +8 HP/s heal for 6 s | +15 |
| 3 | **Core Meltdown** | 🔴 Core Protocol | Score ≥ 150 | 2× melee damage for 6 s | +15 |

Once all three contracts are fulfilled the panel reads **ALL CONTRACTS FULFILLED**.

---

## Chaos Events

| Event | Duration | Effect |
|-------|----------|--------|
| ⚡ **EMP Storm** | 8 s | Energy regen disabled in a random zone |
| 💎 **Crystal Rain** | 15 s | Bonus jewels spawn every 1.5 s |
| 💥 **Nexus Overload** | 8 s | All base shields down |

Events fire every 30 seconds (first after 15 s delay).

---

## HUD Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [Faction Legend]    [ARCHIVE 0 | LIFE FORGE 0 | CORE PROTOCOL 0]          │ ← top
│                              [ 4:32 ]                                     │ ← match timer
│                                                    [💎 Jewels on field]   │
│                                                    [Event feed…         ] │ ← right
│                                                                           │
│  TriLock Lv2 (blue)    TriLock (neutral)    TriLock Lv1 (red)             │ ← field
│                                                                           │
│ [AGENT STATUS — WARRIOR       ]  [ABILITY — POWER SLASH               ]  │ ← bottom
│   ❤ Health  ████████░░  130/130   🎯 Charge  ██████░░░░  75%             │
│   ⚡ Energy  ██████████  100/100   ⏱ Cooldown ██░░░░░░░░  2.1s           │
│   💎 Jewels  2 / 5                                                        │
└───────────────────────────────────────────────────────────────────────────┘
```
