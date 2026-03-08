# ADR-001 Cross-Team Division of Labor

*Response to ADR-001 — Terrain Texture Authority & Module Topology*

| Field | Value |
|-------|-------|
| **From** | World Team (poqpoq-world repo) |
| **Rep** | Claude Opus 4.6 / World Team AI Engineer |
| **Date** | 2026-03-08 |
| **Re** | ADR-001 Terrain Texture Authority — cross-team coordination |
| **Status** | Proposal for all-team review |

---

## Summary

ADR-001 defines a seven-layer terrain texture compositor split across four teams. This document proposes how to divide labor, coordinate shared contracts, and sequence work so all four teams can proceed in parallel after a single contract design session.

---

## The Four Teams

| Team | Repo | Primary Domain |
|------|------|----------------|
| **Terraformer** | `BlackBoxTerrainStudio` | Heightmap editing, spline/path definition, world-gen baking |
| **World** | `poqpoq-world` | Runtime rendering, physics, AI companions, event system |
| **DungeonMaster** | `dungeonMaster` | Instance generation, dungeon geometry, floors/walls/ceilings |
| **Splatter** | `Splatter` (this repo) | SplatPainter UI, layer compositor, brush tools, PathStyleEditor |

---

## Layer Ownership Map

| Layer | Name | Owner Team | Consumers | Coordination Point |
|-------|------|-----------|-----------|-------------------|
| **1** | Height / Slope Mask | **Terraformer** | World, DungeonMaster | Export format (texture + metadata JSON) |
| **2** | Base Noise | **Terraformer** | World, DungeonMaster | Same export pipeline as L1 |
| **3** | Biome Overlay | **World** | Splatter (visualization) | World defines drift rules; Splatter visualizes |
| **4** | Path Network | **World** (reads Terraformer splines) | Splatter (PathStyleEditor) | **Shared contract**: Terraformer exports path distance field + spline metadata; World evaluates at runtime; Splatter edits styles |
| **5** | AI / Object Influence | **World** | Splatter (Tier 3 UI) | `terrain_influence` config schema is the contract |
| **6** | Maker Paint Overrides | **Splatter** | World (reads at runtime) | Layer6Data format is the contract |
| **7** | Transient FX | **World** | None (ephemeral) | No coordination needed |

---

## Per-Team Responsibilities

### Terraformer Team

**Delivers:** Baked data that downstream teams consume as read-only inputs.

1. **Heightmap export** — confirm format stability with World team
2. **Path distance field baking** — NEW: bake spline curves into a distance field texture on save
   - Performance benchmark needed (ADR-002 open question)
   - Incremental re-bake (dirty regions only) vs full re-bake decision
3. **Spline metadata export** — curve names, lengths, types, control points as JSON
4. **Base splat texture** — Layers 1+2 combined into a single baked texture
5. **Export contract**: `{ baseSplatUrl, pathDistanceFieldUrl, splineMetadata[] }`

**Does NOT**: Evaluate runtime conditions, know about physics objects, run AI logic, or style paths.

**Coordinates with**: Splatter (spline metadata format), World (baked texture format, distance field format)

---

### World Team (poqpoq-world)

**Delivers:** Runtime compositor, event log, AI terrain API, physics influence evaluation.

1. **Runtime compositor** — reads Terraformer baked data + Splatter overrides, composites Layers 3-5, 7
2. **Path evaluation shader** — the GLSL from ADR-001 (pathDist, edgeNoise, wearNoise, mossCreep)
3. **Layer 5 influence system** — spatial tracking of `terrain_influence` config blocks on objects
   - Dirty-flag evaluation (ADR-005)
   - Spatial index when object count grows
4. **Event log** — timestamped terrain changes for AI companion consumption (ADR-006)
5. **AI terrain API** — read (spatial queries) + write (proposal-only, never direct)
6. **Transient FX** (Layer 7) — TTL-decaying effects (footprints, spell burns)
7. **iframe host** — launches Splatter from World with proper init payload + permissions

**Does NOT**: Define path geometry, bake base splats, or own brush tool UI.

**Coordinates with**: Terraformer (consumes baked data), Splatter (hosts iframe, reads Layer6Data, sends/receives postMessage), DungeonMaster (dungeon instances need the same compositor)

---

### DungeonMaster Team

**Delivers:** Instance geometry with terrain-compatible texture system.

1. **Floor/wall/ceiling splatmaps** — same layer model applied to dungeon surfaces
   - L1/L2: baked from dungeon geometry (slope, material zones)
   - L4: corridor path networks (auto-generated from dungeon graph)
   - L5: object influence (torches scorch, water seepage, traps cracks)
   - L7: transient FX (combat scars, spell residue)
2. **Dungeon-specific `terrain_influence` configs** — torch scorch radius, water seepage, etc.
3. **Export format compatibility** — dungeon surfaces must use the same splat format as outdoor terrain so the World compositor handles both

**Does NOT**: Own the compositor shader, define the layer stack, or build brush tools.

**Coordinates with**: World (shared compositor shader, shared influence config schema), Terraformer (distance field format compatibility for corridor paths), Splatter (dungeon floor painting via same UI)

---

### Splatter Team (this repo)

**Delivers:** Standalone micro-app for terrain texture authoring, launched as sandboxed iframe.

1. **Layer compositor UI** — visual stack of all 7 layers with blend mode controls
2. **Tier 1 brush tools** — paint, erase, smear, opacity
3. **Tier 2 rule composer** — node/config UI for condition-driven rules (`slope > X -> rock`)
4. **Tier 3 physics painter** — UI for authoring `terrain_influence` config blocks
5. **PathStyleEditor** — per-path material assignment, edge moss, wear, intersection rules
6. **AI Proposals panel** — review/approve/reject companion terrain proposals
7. **Preset library** — shareable named texture rulesets
8. **postMessage API** — bidirectional communication with host (Terraformer or World)
9. **Layer6Data persistence format** — the contract for maker paint overrides

**Does NOT**: Define path geometry, run the compositor at runtime, execute AI logic, or manage permissions.

**Coordinates with**: All three other teams via the postMessage API contract + Layer6Data format.

---

## Shared Contracts

These interfaces cross team boundaries. **All four teams should agree on these before implementation begins.**

| Contract | Between | Format | Defining Team |
|----------|---------|--------|--------------|
| **Baked splat texture** | Terraformer -> World, DungeonMaster | PNG/KTX2 + metadata JSON | Terraformer defines, others consume |
| **Path distance field** | Terraformer -> World, Splatter | R32F texture + spline metadata JSON | Terraformer defines |
| **SplineMeta[]** | Terraformer -> Splatter | JSON: `{ id, name, type, length, controlPoints }` | Co-designed (Terraformer + Splatter) |
| **Layer6Data** | Splatter -> World | JSON/binary: paint strokes + blend modes | Splatter defines, World consumes |
| **terrain_influence config** | World <-> Splatter | JSONB: `{ radius, falloff, textureId, intensity }` | Co-designed (World + Splatter) |
| **postMessage API** | Splatter <-> Hosts | As defined in ADR-001 | Splatter defines, hosts implement |
| **Event log schema** | World -> AI companions, Splatter | ADR-006 (to be drafted) | World defines |
| **MakerPermissions** | World -> Splatter | `{ tier1: bool, tier2: bool, tier3: bool }` | World defines |

---

## Sequencing

```
Phase 0: CONTRACT DESIGN (all teams, 1 session)
  |-- Agree on baked splat format
  |-- Agree on path distance field format
  |-- Agree on SplineMeta[] schema
  |-- Agree on Layer6Data format
  |-- Agree on terrain_influence config schema

Phase 1: FOUNDATION (parallel, no cross-team dependencies)
  |-- Terraformer: Path distance field baking + export
  |-- World: Runtime compositor stub (reads baked splat, outputs to terrain shader)
  |-- DungeonMaster: Surface splatmap extraction from dungeon geometry
  |-- Splatter: Repo setup, postMessage API, Tier 1 brush tools

Phase 2: INTEGRATION (sequential dependencies noted)
  |-- World: Path evaluation shader (needs Terraformer distance field)
  |-- Splatter: PathStyleEditor (needs SplineMeta from Terraformer)
  |-- World: Layer 5 influence system + dirty-flag tracking
  |-- Splatter: Tier 2 rule composer + Tier 3 physics painter

Phase 3: AI & POLISH
  |-- World: Event log + AI terrain API (ADR-006)
  |-- Splatter: AI Proposals panel
  |-- DungeonMaster: Dungeon-specific influence configs
  |-- All: Preset library, community sharing
```

---

## Remaining ADRs Needed

| ADR | Topic | Primary Author Team |
|-----|-------|-------------------|
| **002** | Path System Integration Strategy | Terraformer + World (joint) |
| **003** | SplatPainter Module Boundaries & PathStyleEditor | Splatter |
| **004** | Maker Three-Tier Access Model | World (permissions) + Splatter (UI) |
| **005** | Dirty-Flag Evaluation & Spatial Influence Zones | World |
| **006** | Event Log Schema & AI Companion Terrain API | World |

---

## Risk Flag: DungeonMaster Compatibility

ADR-001 is surface-terrain-focused. DungeonMaster needs the same system for **enclosed geometry** (floors, walls, ceilings). Key concerns:

- The compositor must support non-heightmap surfaces (UV-mapped meshes, not just terrain grids)
- Path distance fields on dungeon floors are corridors, not outdoor trails
- Influence halos wrap around corners (2D distance field may not work in 3D dungeon geometry)

**Recommendation:** ADR-002 should explicitly address dungeon surface compatibility, or a separate ADR-007 should define how the layer model adapts to enclosed geometry.

---

## World Team Commitments

The World team commits to owning these deliverables from the plan above:

1. Runtime compositor (Layers 3, 4, 5, 7)
2. Path evaluation shader (GLSL from ADR-001)
3. Layer 5 influence system + spatial tracking (ADR-005)
4. Event log schema + AI terrain API (ADR-006)
5. Transient FX system (Layer 7)
6. iframe host integration for Splatter
7. `MakerPermissions` schema definition
8. `terrain_influence` config co-design with Splatter team
9. Co-authoring ADR-002 (Path System) with Terraformer team

We are ready to begin Phase 0 (contract design) whenever the other teams are.

---

*Submitted by World Team (poqpoq-world) — 2026-03-08*
*AI Engineer: Claude Opus 4.6 | Technical Lead: Allen Partridge*
