# poqpoq // Cross-Team Coordination Plan

*March 2026 — Division of labor following ADR-001 (Terrain Texture Authority)*

---

## The Four Teams

ADR-001 defines a seven-layer terrain compositor model. Four teams own different slices of that stack. This document assigns concrete deliverables to each team and identifies the coordination contracts between them.

| Team | Repository | Layer Ownership |
|------|-----------|----------------|
| **Terraformer** | `BlackBoxTerrains` | Layers 1 & 2 (height/slope mask, base noise), spline geometry, SDF export |
| **World** | `World` / `BlackBoxWorlds` | Layers 3, 4, 5, 7 (biome drift, path styling, physics influence, transient FX) |
| **DungeonMaster** | `BlackBoxDungeonMaster` | Dungeon geometry equivalent of Layers 1 & 2, hosts SplatPainter for indoor surfaces |
| **SplatPainter** | `Splatter` | Layer 6 (maker paint overrides), compositor UI, PathStyleEditor, all three creative tiers |

---

## Team 1: Terraformer

**Owns:** Layers 1 & 2, spline geometry, path distance field export

### Deliverables

1. **Path Distance Field (SDF) baking** — extend `PathSystem` to produce a single-channel distance field texture where each texel stores distance-to-nearest-path. Already on Sprint 5D roadmap as "SDF optimization."

2. **BBT format v2.1** — add `pathDistanceField.png` (R-channel SDF) and `splineMetadata.json` to the exported bundle alongside heightmap, zone tables, and path JSON.

3. **Draft ADR-002** — Terraformer is the authority on path geometry. It writes the first draft of the SDF contract spec (texture format, resolution, per-path encoding, metadata sidecar). World and SplatPainter teams review.

4. **Spline metadata API** — reshape `PathSystem.exportToJSON()` into the `SplineMeta[]` format SplatPainter expects in its init payload (curve names, lengths, types, control point counts).

5. **SplatPainter iframe host scaffold** — minimal embed point in Terraformer's UI. Can be a stub until SplatPainter repo has its first build.

### Does NOT own

- Runtime path styling, wear simulation, physics influence halos
- Seasonal biome drift, transient FX
- AI companion proposal pipeline

---

## Team 2: poqpoq World

**Owns:** Layers 3, 4, 5, 7 — the runtime compositor

### Deliverables

1. **Runtime compositor** — reads Terraformer's baked base splat + SDF, overlays dynamic layers per frame.

2. **Layer 4: path styling** — consumes SDF + style rules authored in SplatPainter. Implements the per-fragment path evaluation shader (edge noise, wear, moss creep).

3. **Layer 5: terrain influence halos** — `terrain_influence` config blocks on physics objects. Dirty-flag spatial tracking (ADR-005).

4. **Layer 7: transient FX** — footprints, spell burns, weather effects with TTL decay.

5. **Layer 3: seasonal biome drift** — biome overlay shift on game-time ticks.

6. **Event log infrastructure (ADR-006)** — timestamped terrain events, spatial query API for AI companions.

7. **`postMessage` host-side** — embed SplatPainter iframe in World's live editor context.

8. **AI proposal pipeline** — companion proposes terrain change → proposal event → maker reviews in SplatPainter → approval writes config permanently.

### ADRs to draft

- **ADR-005** — dirty-flag evaluation and spatial influence zone tracking
- **ADR-006** — event log schema and AI companion terrain API

---

## Team 3: DungeonMaster

**Owns:** Small-sim terrain generation with dungeon-specific geometry concerns

### Key Architecture Question

Dungeons are not heightmaps — they are rooms, corridors, and vertical surfaces (floors, walls, ceilings). The 7-layer model needs a mapping:

| ADR-001 Layer | Dungeon Equivalent |
|---------------|-------------------|
| Layer 1 (height/slope mask) | Room geometry masks — floor/wall/ceiling classification per texel |
| Layer 2 (base noise) | Dungeon material noise — stone type variation, age weathering |
| Layer 3 (biome overlay) | *Likely unused* — dungeons don't have seasons |
| Layer 4 (path network) | Corridor/passage SDF — same format as Terraformer paths |
| Layer 5 (object influence) | Torch scorch, water seepage, moss near drains — same halo system |
| Layer 6 (maker paint) | Floor/wall/ceiling painting in SplatPainter — *primary creative tool* |
| Layer 7 (transient FX) | Spell damage, blood splatter, frost — same TTL system |

### Deliverables

1. **Dungeon geometry → Layer 1 mapping** — define how room/corridor geometry produces floor/wall/ceiling mask textures in a format SplatPainter can consume.

2. **Corridor SDF export** — same distance field format as Terraformer paths, applied to dungeon corridors and passages.

3. **SplatPainter iframe host** — embed SplatPainter for dungeon surface painting (same `postMessage` contract as Terraformer and World).

4. **ADR addendum** — short document specifying how dungeon geometry maps onto the 7-layer model.

### Shared with Terraformer

- Same texture asset pipeline (texture array format, asset registry)
- Same SDF contract (ADR-002 applies to corridors too)
- Same BBT-like bundle format for dungeon export

---

## Team 4: SplatPainter (this repo)

**Owns:** Layer 6, compositor UI, all three creative tiers, PathStyleEditor

### Deliverables

1. **Micro-repo scaffold** — standalone app deployable as an iframe. No engine dependencies.

2. **`postMessage` API spec (ADR-003)** — SplatPainter owns this contract since it's the receiver in all three host contexts. Includes:
   - `SPLATPAINTER_INIT` payload schema (context, worldId, baseSplat, SDF, spline metadata, permissions)
   - `SPLATPAINTER_SAVE` response schema (Layer 6 overrides, path style assignments, influence configs)
   - Version negotiation protocol
   - Error/fallback behavior for schema mismatches
   - Save frequency strategy (auto-save on stroke vs. explicit save vs. both)

3. **Tier 1 brush tools** — direct paint, erase, smear, opacity. Available to all makers.

4. **Tier 2 rule composer** — condition-driven texture rules (node/config UI). `slope > X → rock`, `height < Y → sand`, etc.

5. **Tier 3 physics-linked painter** — UI for authoring `terrain_influence` config blocks. AI proposal review panel.

6. **PathStyleEditor sub-component** — per-path material assignment, edge moss creep, wear simulation, intersection rules. Consumes spline metadata from host (Terraformer or World) via init payload. Does NOT re-implement curve editing.

7. **Preset library** — shareable named texture rulesets publishable to maker community.

### ADRs to draft

- **ADR-003** — SplatPainter module boundaries and PathStyleEditor placement
- **ADR-004** — maker three-tier access model

---

## Critical Coordination Contracts

These are the interfaces where teams must agree before implementation proceeds.

### Contract 1: SDF Texture Format (Terraformer → all consumers)

| Property | Proposed Value | Notes |
|----------|---------------|-------|
| Format | Single-channel R8 or R16F | R8 for size, R16F for precision — needs benchmarking |
| Resolution | Same as heightmap (e.g. 1024x1024) | 1:1 mapping simplifies UV lookup |
| Encoding | Normalized distance (0.0 = on path, 1.0 = max distance) | Max distance TBD — global or per-path? |
| Multi-path | Combined texture (min distance across all paths) | Path-ID encoded in G channel if per-path styling needed |
| Metadata sidecar | `splineMetadata.json` | Path type, default width, style hints, control point count |

**Owner:** Terraformer drafts ADR-002. World and SplatPainter review before any team implements consumers.

### Contract 2: `postMessage` API (SplatPainter ↔ all hosts)

The init payload schema from ADR-001 is the starting point. Additional requirements:

- **Version field** in every message (`apiVersion: '1.0'`)
- **Capability negotiation** — host sends supported features, SplatPainter responds with what it can handle
- **Save modes** — `'auto'` (save on every stroke), `'explicit'` (save button only), `'hybrid'` (auto-save + explicit checkpoints)
- **Dirty state notification** — SplatPainter tells host when unsaved changes exist (for close/navigate-away warnings)

**Owner:** SplatPainter drafts ADR-003. Terraformer, World, and DungeonMaster review.

### Contract 3: Shared Texture Asset Pipeline

All four apps reference the same texture libraries (stone, dirt, grass, moss, etc.). Need:

- One canonical texture format (resolution, compression, mip levels)
- One asset registry (URL scheme or bundle reference)
- Deduplication — same grass texture referenced by Terraformer zone table AND SplatPainter brush should resolve to one download

**Owner:** Needs joint ownership. Suggest Terraformer defines the format (already has TextureArrayBuilder), SplatPainter defines the registry/catalog UI.

### Contract 4: DungeonMaster Geometry Abstraction

DungeonMaster must define how its room/corridor geometry maps to the same mask textures that Terraformer produces from heightmaps. SplatPainter needs both to look the same in its compositor UI.

**Owner:** DungeonMaster drafts the addendum. SplatPainter reviews for compatibility.

---

## Recommended Sequencing

### Phase 1: Contracts (now)

| Team | Task |
|------|------|
| Terraformer | Draft ADR-002 (SDF contract) |
| World | Draft ADR-005 (dirty-flag tracking), ADR-006 (event log schema) |
| DungeonMaster | Draft dungeon-to-7-layer geometry mapping addendum |
| SplatPainter | Draft ADR-003 (`postMessage` API), ADR-004 (tier access model), scaffold micro-repo |

### Phase 2: Foundation implementations

| Team | Task |
|------|------|
| Terraformer | Bake SDF export (Sprint 5D), BBT v2.1 with SDF + spline metadata |
| World | Build runtime compositor skeleton (Layer 4 path styling first — most visible) |
| DungeonMaster | Implement dungeon Layer 1 geometry masks, corridor SDF |
| SplatPainter | Tier 1 brush tools, PathStyleEditor UI, `postMessage` handler |

### Phase 3: Integration

| Team | Task |
|------|------|
| Terraformer | Embed SplatPainter iframe, integration test: Terraformer → SDF → World round-trip |
| World | Layer 5 physics influence, Layer 7 transient FX, AI proposal pipeline |
| DungeonMaster | Host SplatPainter iframe for indoor surface painting |
| SplatPainter | Tier 2/3 tools, preset library, AI proposal review panel |

---

## Open Questions (from ADR-001 session)

These need resolution but don't yet have enough definition for full ADRs:

- **Seasonal drift cadence** — game-time, real-time, or player-activity driven?
- **Transient FX TTL configuration** — hardcoded per type or configurable per object?
- **SplatPainter versioning** — how do hosts pin to a specific SplatPainter version?
- **SDF bake performance** — benchmark needed on max-size worlds. Incremental re-bake feasible?
- **Path intersection UX** — how does PathStyleEditor visualize and edit cross-path behavior?
- **Shared texture deduplication** — CDN-level, bundle-level, or both?

---

*poqpoq // Cross-Team Coordination Plan // March 2026*
