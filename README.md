# CYBER TRINITY — 5v5v5 Data-Node Combat

A browser-based 5v5v5 real-time combat visualisation set in a rain-soaked, neon-lit cyberpunk data-centre city.

## Factions

| Colour | Name | Role | Style |
|--------|------|------|-------|
| 🔵 Blue  | **The Archive**      | Data Sniper   | Knowledge & Order — server-rack base, energy rifle snipers |
| 🟢 Green | **Life Forge**       | Bio Guard     | Life & Harmony — bionic-tree base, shield warriors |
| 🔴 Red   | **Core Protocol**    | Core Striker  | Force & Chaos — furnace base, power-fist speedsters |

## Mechanics

- **15 agents** compete simultaneously (5v5v5).
- **Memory Crystals** (holographic polyhedra) are scattered across the field. Agents collect and deliver them to their faction's Data Node for **+10 points**.
- Each faction has a **holographic shield** protecting its base.
- Bases are connected by animated **network links** with live data-stream particles.

## HUD

- **Top centre** — live 3-faction score board (pre-seeded 30 / 85 / 55).
- **Bottom left** — local agent health & energy bars.
- **Bottom right** — ability charge & cooldown timer.
- **Top right** — active crystal count.
- **Right side** — rolling kill / delivery event feed.

## Running

Open `index.html` in any modern browser (ES modules required — use a local HTTP server):

```bash
npx serve .
# then visit http://localhost:3000
```