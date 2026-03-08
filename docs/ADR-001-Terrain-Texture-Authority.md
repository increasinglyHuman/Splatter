# poqpoq // Architecture Decision Record

---

# ADR-001 — Terrain Texture Authority & Module Topology

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | March 2026 |
| **Author** | Allen Partridge |
| **Domain** | Terrain · Rendering · World Architecture |
| **Affects** | Terraformer · World · SplatPainter · AI Companions |

---

## Context

poqpoq requires a terrain texture system that is simultaneously a real-time rendering pipeline, a maker-space creative tool, and an AI-readable world-state record. Three existing systems have overlapping concerns that need clear authority boundaries:

- **Terraformer** — heightmap editing, spline/path curve definition, base world geometry
- **World** — runtime simulation, physics config objects, AI companion execution, event sourcing
- **SplatPainter** *(proposed)* — procedural texture generation, layered compositing, user paint tools

Additionally, a camera-relative texture optimizer (already in development) enhances resolution for terrain tiles nearest the player. This system must remain decoupled from whichever module owns texture generation.

The core tension: splat map data has both static (world-gen) and dynamic (runtime AI/physics) origins. A single authority model cannot serve both cleanly. Any solution must also expose creative editing access to makers without requiring engine-level knowledge.

---

## Decision

We adopt a **layered compositor model** with a distributed authority topology across three modules.

### The Seven-Layer Stack

| Layer | Name | Owner Module | Evaluation Timing | TTL |
|-------|------|-------------|-------------------|-----|
| 1 | Height / Slope Mask | Terraformer | World-gen only | Permanent |
| 2 | Base Noise | Terraformer | World-gen only | Permanent |
| 3 | Biome Overlay | World | Slow drift (game-time) | Seasonal |
| 4 | Path Network | World *(reads Terraformer splines)* | Dirty-flag on spline edit | Persistent |
| 5 | AI / Object Influence | World | Dirty-flag on object change | Config-defined |
| 6 | Maker Paint Overrides | SplatPainter | Edit-time write | Persistent |
| 7 | Transient FX | World | Per-frame, TTL decay | Short (seconds–minutes) |

---

## Module Topology & Boundaries

### Terraformer — Geometry & Baked Authority

Terraformer retains ownership of everything that is true at world-creation time and does not change during play.

- Heightmap editing and export
- Spline / path curve definition — curves stay here; downstream modules consume them as read-only data
- Baking Layers 1 & 2 (height/slope mask + base noise) into the base splat texture at world-gen time
- Exporting a **path distance field texture** derived from its own spline data — this is the contract it provides to World

> Terraformer does not evaluate runtime conditions. It knows nothing about physics objects, AI companions, or player actions.

---

### World — Dynamic Layer Authority

World owns everything that changes during a session. It is the runtime compositor — it reads the baked base splat from Terraformer and overlays Layers 3–5 and 7.

- Consumes Terraformer's path distance field and applies path styling rules at runtime (Layer 4)
- Evaluates physics-config object `terrain_influence` blocks and writes influence halos (Layer 5)
- Manages the **event log** — every Layer 5 or Layer 7 write is appended as a timestamped event
- Exposes a terrain state API that AI companions (Artemis et al.) can read and propose writes to
- Handles seasonal / temporal drift of the biome overlay (Layer 3) on game-time ticks
- Runs transient FX (Layer 7) with TTL decay — footprints, spell burns, weather effects

> World does not define path geometry or bake base splats. It consumes baked data and enriches it.

---

### SplatPainter — Micro-Repo, Maker Creative Tool

SplatPainter is a standalone micro-repository that exposes its UI as a **sandboxed iframe**. It can be launched from either Terraformer (during world design) or World (during live editing by makers with appropriate permissions). This isolation keeps it independently deployable, independently versionable, and free of engine dependencies.

**SplatPainter owns:**

- The layered compositor UI — visual representation of all 7 layers with blend mode controls
- **Tier 1** brush tools — direct paint, erase, smear; accessible to all makers
- **Tier 2** rule composer — node/config UI for condition-driven texture rules (e.g. `slope > X → rock`)
- **Tier 3** physics-linked painter — UI for authoring `terrain_influence` config blocks on objects
- **PathStyleEditor** sub-component — per-path material assignment, edge moss creep, wear simulation, intersection rules *(consumes spline metadata from Terraformer via API; does not re-implement curve editing)*
- Preset library — shareable named texture rulesets publishable to the maker community

**SplatPainter does not:**

- Define path geometry or splines — those stay in Terraformer
- Execute AI companion logic — it exposes an AI-proposal review UI only
- Own the runtime compositor — it writes Layer 6 overrides to a format World can consume

---

## SplatPainter iframe Contract

Because SplatPainter is launched as an iframe from two different host contexts, it requires a well-defined `postMessage` API:

```js
// Host → SplatPainter: initialization payload
{
  type: 'SPLATPAINTER_INIT',
  context: 'terraformer' | 'world',
  worldId: string,
  baseSplatUrl: string,          // baked Layer 1+2 texture URL
  pathDistanceFieldUrl: string,  // Terraformer export
  splineMetadata: SplineMeta[],  // curve names, lengths, types
  existingOverrides: Layer6Data, // maker paint already saved
  permissions: MakerPermissions, // tier 1 / 2 / 3 access flags
}

// SplatPainter → Host: save event
{
  type: 'SPLATPAINTER_SAVE',
  layer6Overrides: Layer6Data,
  pathStyleAssignments: PathStyle[],
  terrainInfluenceConfigs: InfluenceConfig[],
}
```

---

## Path System: Hybrid Bake + Runtime

Path curves are defined in Terraformer and exported as a path distance field texture. The **fact** of a path (its geometry) is baked. The **condition** of a path (its surface material, wear, moss creep, frost) is evaluated at runtime by World using rules authored in SplatPainter's PathStyleEditor.

- A maker designs path curves in Terraformer → bakes distance field
- A maker opens SplatPainter (from Terraformer or World) → assigns path styles
- At runtime, World applies those styles against the distance field with live wear data
- Artemis can propose new path style rules via the AI-proposal API — maker reviews in SplatPainter

```glsl
// World runtime path evaluation (per terrain fragment)
float pathDist     = texture(pathDistanceField, uv).r;
float edgeNoise    = noise(uv * 8.0) * pathStyle.edgeVariance;
float wearNoise    = noise(uv * 2.0 + trafficSeed) * pathStyle.wearVariance;
float pathWeight   = 1.0 - smoothstep(0.0, pathStyle.width + edgeNoise, pathDist);
float wornWeight   = pathWeight * trafficIntensity * pathStyle.wearSensitivity;

// Moss creep in from edges, retreat from worn centre
float mossZone    = smoothstep(pathStyle.width * 0.6, pathStyle.width, pathDist);
float mossWeight  = mossZone * pathStyle.mossIntensity * moistureFactor;
```

---

## Camera-Relative Optimizer: Decoupling Confirmed

The camera-relative texture optimizer operates exclusively on the **final composited splat output**. It has no knowledge of which layer produced any given texel value.

- Compositor writes final splat → optimizer reads it → enhances nearest N tiles → GPU renders
- No changes to compositor architecture are required to support optimizer evolution
- If the optimizer needs path proximity for LOD decisions, it should consume the path distance field directly from Terraformer — not route through the compositor

---

## Maker Creative Access Tiers

| Tier | Name | Access Model | Tools Available | Who |
|------|------|-------------|-----------------|-----|
| 1 | Casual Painter | Always available | Brush · Erase · Smear · Opacity | All makers |
| 2 | Rule Composer | Unlocked per world role | Condition nodes · Biome presets · Shareable rulesets | Experienced makers |
| 3 | Physics Painter | Creator / admin only | `terrain_influence` config · AI proposal review · Halo editor | World owners, AI companions *(proposed writes only)* |

---

## AI Companion Integration

Artemis and other companions interact with the terrain texture system through World's event log and terrain state API. They do not write directly to the compositor. All companion-proposed texture changes arrive as **proposal events** that a Tier 3 maker can approve, reject, or modify in SplatPainter.

- Companion plants novel object → World auto-generates a draft `terrain_influence` config block
- Draft config is surfaced in SplatPainter's **AI Proposals panel** (Tier 3 UI)
- Maker approves → config is permanently attached to the object and applied at runtime
- Failed companion commands are logged as `terrain_proposal_failed` events → become feature roadmap items
- Companions can read the event log to understand terrain history: *"what caused this scorch ring?"*

---

## Consequences

**Positive:**

- Clean module boundaries — each system can be developed, tested, and deployed independently
- SplatPainter as a micro-repo enables community contribution without engine access
- Event log gives AI companions a readable world history without bespoke interfaces
- Camera optimizer remains fully decoupled — no changes needed as compositor evolves
- Tier system makes creative tools accessible at every skill level

**Costs & Risks:**

- `postMessage` API between SplatPainter iframe and host requires careful versioning as both evolve
- Path distance field baking adds a step to the Terraformer save pipeline — needs to be fast enough for iterative design
- Dirty-flag evaluation for Layer 5 requires World to track spatial influence zones — O(objects) check on object move
- Three-tier permission model adds auth surface area — permissions must be propagated correctly to SplatPainter init payload

---

*poqpoq · ADR-001 · Terrain Texture Authority & Module Topology · March 2026*
