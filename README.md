# CYBER TRINITY — 5v5v5 Data-Node Combat

An Unreal Engine 5 game set in a rain-soaked, neon-lit cyberpunk datacenter city.  
Rendered with **Lumen** global illumination, **Nanite** virtualized geometry,  
volumetric fog, and cinematic post-process.

---

## Factions

| Colour | Name | Role | Base |
|--------|------|------|------|
| 🔵 Blue  | **The Archive**      | Data Sniper   | Animated server rack — energy rifle snipers on high ground |
| 🟢 Green | **Life Forge**       | Bio Guard     | Bionic tree — shield-wall warriors, close-range AoE heal |
| 🔴 Red   | **Core Protocol**    | Core Striker  | Furnace core — power-fist dash, highest movement speed |

---

## Mechanics

- **15 agents** compete simultaneously (5v5v5).
- **Memory Crystals** (`AMemoryCrystal`) — glowing polyhedra scattered across the field.  
  Agents pick them up and deliver them to their faction's **Data Node** (`ADataNode`) for **+10 points**.
- Each Data Node is protected by an animated **holographic shield dome** (Niagara).
- Nodes are connected by animated **network-link splines** with travelling data-stream particles.
- Pre-seeded match scores: **Archive 30 · Life Forge 85 · Core Protocol 55**.

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
- `Space`: activate faction ability (Railshot) when charged

---

## Next Task

Bring the **Unreal `GameState` implementation** up to parity with the browser
preview's full feature-contract chain.

- Add contracts #2 and #3 after **Activate Overclock Uplink** (currently only one
  contract is tracked in UE).
- Replicate current contract progress/status so HUD/Blueprint can show
  who/when/what and completion state.
- Keep completion effects aligned with the browser contract flow (score bonus +
  event feed updates per contract).

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

## Faction Abilities

Each faction has a unique active ability triggered by AI agents when their cooldown
is ready and enough energy is available.

| Faction | Ability | Effect | Cost | Cooldown |
|---------|---------|--------|------|----------|
| 🔵 The Archive | **Railshot** | Fast long-range energy bolt, 35 damage | 25 energy | 6 s |
| 🟢 Life Forge | **Bio Shield** | Stationary heal aura, restores 15 HP/s to nearby allies for 2.5 s | 35 energy | 6 s |
| 🔴 Core Protocol | **Power Dash** | Blazing charge toward nearest enemy, 25 damage | 30 energy | 6 s |

Energy regenerates at 8 per second (max 100). Abilities appear in the event feed
and are visible as canvas effects in the browser preview.

---

## HUD Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Faction Legend]    [ARCHIVE 30 | LIFE FORGE 85 | CORE PROTOCOL 55] │ ← top
│                                              [💎 Crystals on field] │
│                                              [Event feed…         ] │ ← right
│                                                                      │
│ [AGENT STATUS                  ]  [ABILITY — RAILSHOT             ] │ ← bottom
│   ❤ Health  ████████░░  180/200   🎯 Charge  ██████░░░░  75%        │
│   ⚡ Energy  ██████████  100/100   ⏱ Cooldown ██░░░░░░░░  2.1s      │
└─────────────────────────────────────────────────────────────────────┘
```
