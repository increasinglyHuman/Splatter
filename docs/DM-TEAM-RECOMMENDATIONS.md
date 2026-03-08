# poqpoq // Dungeon Master Team Recommendations

*March 2026 — Response to ADR-001 & Cross-Team Coordination Plan*

---

**From:** BlackBox Dungeon Master Team (`BlackBoxDungeonMaster`)
**Re:** Division of Labor, Coordination Contracts, and DM's Position in the Splat Pipeline

---

## Executive Summary

Dungeon Master is primarily a **consumer** of the terrain texture pipeline, not a producer. Our grid is discrete (12.8m octagonal cells on a 19x19 interleaved array), not continuous terrain. We need textures applied to room floors, corridor walls, and ceilings — but we don't need a full splatmap compositor running per-texel across a heightmap.

Our recommendations focus on keeping DM's integration lightweight while ensuring the shared contracts work for indoor environments, not just open terrain.

---

## 1. DM's Relationship to the Seven-Layer Stack

We agree with the mapping in the Cross-Team Coordination doc (Section: Team 3), with the following clarifications:

| ADR-001 Layer | DM Relevance | Notes |
|---------------|-------------|-------|
| Layer 1 (height/slope mask) | **Low** | Our "geometry mask" is the cell type catalog — room, corridor, pit, water, lava, etc. These are discrete enums, not continuous gradients. |
| Layer 2 (base noise) | **Medium** | Material variation within a cell (aged stone, cracked floor) is useful but can be a simple per-cell noise seed rather than a baked texture. |
| Layer 3 (biome overlay) | **None** | Dungeons don't have seasons. Skip. |
| Layer 4 (path network) | **Low** | Corridors ARE the paths. No separate SDF needed — the octile grid topology IS the distance field. |
| Layer 5 (object influence) | **High** | Torch scorch, water seepage, moss near drains, blood stains near combat zones — this is where dungeons come alive. Same halo system as World. |
| Layer 6 (maker paint) | **High** | Primary creative tool for dungeon makers. Per-face material assignment (floor, each wall segment, ceiling). |
| Layer 7 (transient FX) | **High** | Spell damage, blood splatter, frost, trap residue. Core to dungeon gameplay. |

**Key insight:** DM benefits most from Layers 5, 6, and 7. Layers 1-4 are either handled by our existing grid system or irrelevant to enclosed spaces.

---

## 2. What DM Needs from SplatPainter

### Option A: Texture Catalog Only (Recommended for Phase 2)

SplatPainter provides a **shared texture catalog** — a browsable palette of tileable textures with metadata (material type, tileability, roughness, category tags). DM references textures by ID for per-face material assignment.

This aligns with DM's existing art requirements (~35 tileable textures at P0: 8 floor + 8 wall-solid + 4-8 door + misc). DM doesn't need brush tools or splatmap compositing at the cell level.

**What DM needs from Splatter for this:**
- A `TextureCatalog` module or API that returns available textures with preview thumbnails
- A consistent texture ID scheme shared across all four apps
- Texture metadata: `{ id, name, category, tileScale, roughness, previewUrl, fullUrl }`

### Option B: SplatPainter iframe for Per-Cell Detail (Phase 3, if warranted)

If makers want sub-cell painting (moss creeping across half a floor tile, scorch marks from a specific torch position), DM could host SplatPainter as an iframe in a "detail paint" mode. This would require:

- A `context: 'dungeon'` variant in the `SPLATPAINTER_INIT` payload
- DM exports a per-cell UV-mapped render target instead of a terrain heightmap
- SplatPainter receives a flat rectangle (the cell face) instead of terrain topology

**Our recommendation:** Don't build Option B until makers ask for it. Option A covers 90% of dungeon texturing needs. Start simple.

---

## 3. Recommendations on Shared Contracts

### Contract 1: SDF Format — DM Abstains (Mostly)

Dungeon corridors don't need a separate SDF. Our pathfinding already operates on the octile grid graph (A* over cell adjacency). If World's runtime compositor needs to know "distance to nearest corridor wall" for a dungeon rendered in 3D, we can generate that from our wall state arrays at export time — but it's a derived artifact, not a primary data source.

**Recommendation:** Terraformer should define the SDF format for open terrain. If DM needs to produce a compatible SDF for dungeon corridors, we'll conform to whatever Terraformer specifies in ADR-002. Don't let dungeon edge cases complicate the primary SDF contract.

### Contract 2: `postMessage` API — DM Wants a Seat at the Table

If DM hosts SplatPainter (Option B above), we need the init payload to support a `context: 'dungeon'` mode where:

- `baseSplatUrl` points to a per-cell face render (not a terrain heightmap)
- `pathDistanceFieldUrl` is optional/null (corridors are implicit in geometry)
- `splineMetadata` is empty (no spline curves in dungeons)
- A new `cellGeometry` field provides face dimensions, orientation, and UV mapping

**Recommendation:** SplatPainter's ADR-003 should include a `context` enum that's extensible beyond `'terraformer' | 'world'`. Even if `'dungeon'` isn't implemented in Phase 2, the schema should accommodate it.

### Contract 3: Shared Texture Pipeline — DM Strongly Supports

This is the contract DM cares about most. We need:

1. **One texture format** — resolution, compression, mip strategy. DM currently plans for 512x512 tileable PBR (albedo + normal + roughness). If Terraformer's TextureArrayBuilder uses a different spec, we need to converge.

2. **One asset registry** — DM should be able to look up "dungeon_stone_floor_aged" and get the same texture World uses for cave floors. No duplicated assets across four CDN paths.

3. **Category taxonomy** — textures tagged by environment type (outdoor/indoor/dungeon/cave), surface type (floor/wall/ceiling/path), material (stone/wood/dirt/metal), and condition (new/aged/damaged/mossy).

**Recommendation:** Terraformer defines the texture format (they have the most mature pipeline). Splatter defines the catalog UI and registry API. DM and World consume.

### Contract 4: DM Geometry Abstraction — We'll Draft This

We accept the action item to draft the dungeon-to-7-layer geometry mapping addendum. It will cover:

- How octile cell types map to Layer 1 geometry masks
- How wall state arrays (open/closed/door per wall index) produce face classifications
- How DM exports a "dungeon descriptor" that World or SplatPainter can interpret
- The BBD export format already exists (12 tests passing) — we'll extend it with texture references

---

## 4. Sequencing from DM's Perspective

### Phase 1 (Now): Contracts
- DM drafts the geometry mapping addendum
- DM reviews ADR-002 (SDF) and ADR-003 (postMessage) from a dungeon compatibility standpoint
- DM contributes texture format requirements to the shared pipeline discussion

### Phase 2 (Parallel Build): DM Continues Independent Work
- EnergyMeter (vertical budget bar — next on our roadmap)
- ContentTool + ContentPalette (prop/decor placement)
- Integrate shared TextureCatalog for per-face material assignment
- **No SplatPainter iframe hosting yet** — just texture IDs

### Phase 3 (Integration): DM Connects to World
- BBD export includes texture references from shared catalog
- World's dungeon renderer applies Layer 5/7 effects using DM's geometry
- If demand exists, evaluate SplatPainter iframe hosting for sub-cell detail painting

---

## 5. Open Question: Where Does "Splatter" Live for Dungeons?

The ADR-001 vision has SplatPainter as a standalone iframe tool. For dungeon use cases, the question is whether DM needs Splatter at all, or whether a simpler "material picker" panel built natively in DM's UI is sufficient.

**Our position:** Build the shared TextureCatalog as a standalone module (could live in Splatter repo or as a shared package). DM imports it as a dependency. Full SplatPainter iframe hosting is Phase 3 at earliest.

This keeps DM lean and avoids coupling our editor to an iframe communication layer we don't yet need.

---

## 6. Risk Flags

1. **Texture format divergence** — if each team picks their own texture specs independently, we'll waste months on conversion later. Converge on format in Phase 1.

2. **Over-engineering DM's integration** — DM's discrete cell grid is fundamentally simpler than continuous terrain. Don't force-fit the full 7-layer compositor onto a system that works fine with per-face material IDs.

3. **SplatPainter scope creep** — SplatPainter is already a large undertaking (3 tiers, PathStyleEditor, preset library, AI proposals). Adding dungeon-specific modes should be deferred until the terrain use case is solid.

4. **Shared dependency management** — if TextureCatalog becomes a shared package, who owns versioning? Who handles breaking changes? This needs governance early.

---

*BlackBox Dungeon Master Team*
*Repository: `BlackBoxDungeonMaster` — Octile grid dungeon editor*
*Current state: 129 tests, Phase 3 complete, Phase 4 in progress*
*Contact: DM team via `BlackBoxDungeonMaster` repo*

*poqpoq // DM Team Recommendations // March 2026*
