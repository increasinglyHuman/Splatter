# poqpoq // Terrain Texture System — Remaining Work Summary

*Captured March 2026 — follow-on items from ADR-001 session*

---

## Doc Corrections Needed

### ADR-001 .docx — Terraformer Rename
The `.docx` version of ADR-001 uses "TerrainFormer" in several places. The correct product name is **Terraformer** (no camel-case F). Needs a find-and-replace pass before the docx is treated as canonical.

---

## Remaining ADRs to Draft

The following ADRs were outlined during the design session and should each be drafted in full.

---

### ADR-002 — Path System Integration Strategy

**Core question:** How do Terraformer's spline/curve definitions flow into the runtime path texture system?

**Options to evaluate:**
- A: Terraformer bakes paths into splat at world-gen (static)
- B: Path curves are runtime data feeding the compositor via distance field (dynamic)
- C: Hybrid — baked geometry intent + runtime condition/condition styling *(likely decision)*

**Key considerations:**
- Terraformer save pipeline performance impact of baking distance fields
- How path edits mid-session propagate to World without full re-bake
- Whether SplatPainter's PathStyleEditor triggers a distance field refresh or works with cached data

---

### ADR-003 — SplatPainter Module Boundaries & PathStyleEditor Placement

**Core question:** Is PathStyleEditor a sub-component of SplatPainter or a standalone module?

**Key considerations:**
- PathStyleEditor needs spline metadata from Terraformer but paint authority from SplatPainter
- Per-path material assignment, edge moss creep, wear simulation, and intersection rules all live here
- Should intersection handling rules (cobblestone beats dirt; moss always creeps corners) be user-definable or engine-hardcoded?
- Versioning risk: PathStyleEditor schema must stay compatible with both Terraformer spline exports and World's runtime path evaluator

---

### ADR-004 — Maker Three-Tier Access Model

**Core question:** How are Tier 1 / 2 / 3 permissions defined, enforced, and propagated to SplatPainter's iframe init payload?

**Key considerations:**
- Who grants Tier 2 and Tier 3 access — world owner only, or delegatable?
- How permissions survive world sharing / forking (maker publishes world to community)
- Whether Tier 2 rulesets (condition nodes) should be sandboxed to prevent unintended physics coupling
- Preset library governance — who can publish, how are rulesets versioned and deprecated

---

### ADR-005 — Dirty-Flag Evaluation & Spatial Influence Zone Tracking

**Core question:** How does World efficiently track which terrain zones need Layer 5 re-evaluation when objects move or change?

**Key considerations:**
- O(objects) check on every object move is acceptable at low object counts but needs a spatial index at scale
- Candidate structures: grid bucketing, BVH, or R-tree over influence radii
- Threshold: at what object count does naive dirty-flag checking become a frame-time problem?
- Whether influence halos need sub-frame precision or can tolerate 1–2 frame lag
- Moon seed 50m radius example as the benchmark case

---

### ADR-006 — Event Log Schema & AI Companion Terrain API

**Core question:** What is the canonical event log schema, and what read/write surface does World expose to AI companions?

**Key considerations:**
- Event types needed at minimum: `terrain_influence_applied`, `terrain_influence_removed`, `maker_paint_applied`, `transient_fx_created`, `transient_fx_expired`, `terrain_proposal_submitted`, `terrain_proposal_failed`, `terrain_proposal_accepted`
- Retention policy: how long is the full event log kept vs. compacted into a splat snapshot?
- AI read API: spatial query ("what events happened within 30m of this point in the last 10 game-days?")
- AI write API: proposal-only, never direct write — proposal events must include companion ID, confidence, and a plain-language rationale Artemis generates
- How failed commands (`terrain_proposal_failed`) surface to the feature roadmap pipeline

---

## Additional Open Questions (Not Yet ADRs)

These came up during the design session but don't yet have enough definition to become full ADRs:

- **Seasonal drift cadence** — how fast does Layer 3 (biome overlay) shift, and is it driven by world-time, real-time, or player activity?
- **Transient FX TTL configuration** — are TTLs hardcoded per FX type, or configurable per object via `terrain_influence` blocks?
- **SplatPainter versioning strategy** — as a micro-repo launched via iframe, how do Terraformer and World pin to a specific SplatPainter version vs. always pulling latest?
- **Path distance field refresh performance** — benchmark needed: how long does a full distance field bake take on a max-size poqpoq world? Is incremental re-bake (dirty regions only) feasible?
- **Intersection rule UX** — the PathStyleEditor needs a way to visualize and edit what happens where two paths cross; no design exists yet

---

*poqpoq · Terrain Texture System · Remaining Work · March 2026*
