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