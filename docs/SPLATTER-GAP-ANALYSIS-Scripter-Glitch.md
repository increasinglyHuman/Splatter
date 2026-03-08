# Splatter Gap Analysis — Scripter & Glitch Integration

*From: Splatter Team (central orchestrator) — 2026-03-08*
*Re: terrain_influence scripting API and Glitch terrain preview*

---

## Context

ADR-001 defines a seven-layer terrain texture compositor for poqpoq World. Four teams (Terraformer, World, DungeonMaster, Splatter) have completed initial planning. During review, we identified two additional teams that are affected but not yet in the loop:

- **Scripter** — needs scripting API to set/get terrain influence on objects
- **Glitch** — needs to render terrain textures when previewing scenes for any host tool

This document describes the gaps and proposes how each team integrates.

---

## Part 1: Scripter Gap Analysis

### What Exists Today

Scripter's `WorldObject` interface (`src/types/world-object.ts`) has:

```typescript
interface PhysicsConfig {
  enabled?: boolean;
  mass?: number;
  friction?: number;
  restitution?: number;
  gravity?: boolean;
}
```

Scripter's `WorldAPI` (`src/api/world-api.ts`) has:
- `getGroundHeight(position: Vector3): number` — reads terrain height
- `osSetTerrainHeight` — listed as unmapped, "Planned for Phase 5"
- No terrain texture queries or writes

### What's Missing

ADR-001 introduces `terrain_influence` — a config block any physics object can carry that defines how it affects ground textures around it. The agreed schema (co-designed by World and Splatter) is:

```typescript
interface TerrainInfluenceConfig {
  radius: number;               // metres
  falloff: "linear" | "exponential" | "step";
  textureId: string;            // from shared TextureCatalog
  intensity: number;            // 0.0 – 1.0
  blendMode: "overlay" | "replace" | "multiply" | "additive";
  edgeNoise: number;            // 0.0 – 1.0, organic edge variation
  displayName: string;          // human-readable label
  category: string;             // "fire" | "water" | "growth" | "decay" | ...
  previewColor: string;         // hex colour for UI previews
  // Runtime fields (World evaluates, optional for scripts):
  priority?: number;            // overlap resolution (higher wins)
  stackable?: boolean;          // intensity adds vs replaces
}
```

**Scripter needs these additions:**

#### 1. `WorldObject` — terrain influence methods

```typescript
interface WorldObject {
  // ... existing methods ...

  // === Terrain Influence (ADR-001 Layer 5) ===

  /** Set terrain influence config — how this object affects ground textures */
  setTerrainInfluence(config: TerrainInfluenceConfig): void;

  /** Get current terrain influence config (null if none) */
  getTerrainInfluence(): TerrainInfluenceConfig | null;

  /** Remove terrain influence from this object */
  clearTerrainInfluence(): void;
}
```

#### 2. `WorldAPI` — terrain query methods

```typescript
interface WorldAPI {
  // ... existing methods ...

  // === Terrain Texture Queries (ADR-001) ===

  /** Get the dominant terrain texture at a position */
  getGroundTexture(position: Vector3): string;  // returns textureId

  /** Get all active terrain influences at a position */
  getTerrainInfluences(position: Vector3, radius?: number): TerrainInfluenceConfig[];

  /** Get the terrain event log for a spatial region (AI companion use) */
  getTerrainEvents(position: Vector3, radius: number, maxAge?: number): TerrainEvent[];
}
```

#### 3. `EnvironmentAPI` — terrain texture control

```typescript
interface EnvironmentAPI {
  // ... existing methods ...

  /** Set terrain texture at a position (Tier 3 permission required) */
  setTerrainTexture(position: Vector3, textureId: string, radius: number, intensity?: number): void;

  /** Trigger a transient terrain effect (Layer 7) */
  applyTerrainEffect(position: Vector3, effect: TransientTerrainEffect): void;
}

interface TransientTerrainEffect {
  textureId: string;
  radius: number;
  intensity: number;
  ttl: number;           // seconds until full decay
  falloff: "linear" | "exponential";
}
```

#### 4. `ll-map.ts` — LSL compatibility mappings

```typescript
// New entries for the LSL mapping table:
{ lsl: "osSetTerrainTexture", api: "this.world.environment.setTerrainTexture(pos, texId, radius)",
  category: "ossl-terrain", status: "planned", notes: "ADR-001 Layer 6 — requires Tier 3 permission" },

{ lsl: "osGetTerrainTexture", api: "this.world.getGroundTexture(pos)",
  category: "ossl-terrain", status: "planned", notes: "ADR-001 — returns dominant textureId" },
```

### Impact on Scripter Architecture

| Area | Impact | Effort |
|------|--------|--------|
| `world-object.ts` | Add `TerrainInfluenceConfig` type + 3 methods | Low |
| `world-api.ts` | Add 3 terrain query methods | Low |
| `world-api.ts` EnvironmentAPI | Add 2 terrain control methods | Low |
| `ll-map.ts` | Update `osSetTerrainHeight` entry + add new mappings | Low |
| Permission system | `setTerrainTexture` needs Tier 3 gate | Medium |
| Sandbox security | Terrain writes must be rate-limited (prevent script storms) | Medium |
| Documentation | New scripting guide section for terrain influence | Low |

### Downstream: World Engine Changes

These Scripter API additions require World to expose corresponding engine-side implementations:

1. **Object terrain influence storage** — World needs to persist `terrain_influence` JSONB on objects and trigger dirty-flag re-evaluation when scripts modify it
2. **Terrain query API** — World needs spatial query methods on its compositor to answer "what texture is here?"
3. **Transient FX from scripts** — World's Layer 7 system needs a script-callable entry point, rate-limited

**This is the critical path**: Scripter defines the API surface, but World implements the engine underneath.

### When to Implement

Scripter's terrain API additions align with **Phase 2** (foundation builds) and **Phase 3** (integration):

- **Phase 2**: Add `TerrainInfluenceConfig` type and interface stubs to `world-object.ts` and `world-api.ts`. This is zero-risk — it's just types.
- **Phase 3**: Wire up implementations once World's compositor and influence system are live (depends on ADR-005, ADR-006).

The `osSetTerrainHeight` entry already says "Planned for Phase 5" — terrain *texture* control via `terrain_influence` could land earlier since the schema is defined now.

---

## Part 2: Glitch Gap Analysis

### What Glitch Does Today

Glitch is a disposable 3D preview window. Host tools spawn it with scene data, the user walks around, then closes it. Currently supports:

| Glitch Type | Host | What It Previews |
|-------------|------|-----------------|
| `terraformer` | Terraformer | Sculpted terrain (heightmap + basic textures) |
| `landscaper` | Landscaper | Scattered vegetation on terrain |
| `scripter` | Scripter | Scripts executing in 3D |
| `animator` | Animator | Character animations |
| `generic` | Any | Blank canvas |

### What's Missing

The `terraformer` Glitch type already renders terrain — but it uses whatever basic texturing Terraformer provides. With the seven-layer compositor, Glitch needs to show **splatmapped terrain** so makers can see their Splatter paint jobs at ground level.

#### Gap 1: Splatmap Rendering in the Terrain Shader

Glitch's terrain shader needs to:
1. Accept a base splat texture (Layers 1+2 from Terraformer)
2. Accept Layer 6 overrides (from Splatter's paint data)
3. Composite them into a final terrain material
4. Sample from the shared TextureCatalog texture array

This doesn't need the full seven-layer runtime compositor (no biome drift, no transient FX, no AI proposals). Glitch needs **Layers 1 + 2 + 6** — the static baked base plus maker paint. That's a simplified two-source splatmap blend, well within Babylon.js's shader capabilities.

#### Gap 2: New Glitch Type — `splatter`

When a maker finishes painting in Splatter and wants to see how it looks at ground level, they should be able to spawn a Glitch:

```typescript
// New Glitch type
type GlitchType = 'terraformer' | 'landscaper' | 'scripter' | 'animator' | 'generic' | 'splatter';

// Splatter Glitch init payload
interface SplatterGlitchPayload {
  heightmap: string;              // URL to heightmap
  baseSplat: string;              // URL to baked Layers 1+2
  layer6Overrides: string;        // URL to Splatter paint data
  textureArray: string;           // URL to shared texture array (KTX2)
  pathDistanceField?: string;     // Optional: SDF for path rendering
  pathStyles?: PathStyle[];       // Optional: path style assignments
  spawnPosition?: Vector3;        // Where to place the camera
}
```

#### Gap 3: Path Rendering Preview

If a maker styles paths in Splatter's PathStyleEditor, they'll want to walk along the path in Glitch to see edge moss, wear, and cobblestone blending. This requires Glitch to:

1. Load the path distance field (SDF from Terraformer)
2. Apply path style rules (from Splatter) in a simplified terrain shader
3. Render at least the static version (no runtime wear simulation)

### Impact on Glitch Architecture

| Area | Impact | Effort |
|------|--------|--------|
| Terrain shader | Add splatmap compositing (2-source blend) | Medium |
| Glitch type registry | Add `splatter` type with new payload | Low |
| Texture loading | Support KTX2 texture arrays from TextureCatalog | Medium |
| Path rendering | SDF-based path texturing in terrain shader | Medium-High |
| Spawn API | Accept Splatter paint data in init payload | Low |

### When to Implement

- **Phase 2**: Add `splatter` Glitch type with basic splatmap rendering (Layers 1+2+6). This gives immediate value — makers can preview terrain paint at ground level.
- **Phase 3**: Add path SDF rendering and simplified path styling. Depends on Terraformer's ADR-002 (SDF format) and Splatter's PathStyleEditor.

---

## Recommended Research per Team

### For Scripter

- **[GodotRuntimeTextureSplatMapPainting](https://github.com/alfredbaudisch/GodotRuntimeTextureSplatMapPainting)** — Runtime splatmap painting via script. Shows the exact API pattern Scripter needs: world-position → UV → texture modification. The closest reference for how a scripting API should expose terrain painting.
- **[Frostbite Procedural Shader Splatting](https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/chapter5-andersson-terrain-rendering-in-frostbite.pdf)** — Architecture for runtime terrain texture evaluation. Relevant to understanding what World's engine needs to support beneath Scripter's API calls.

### For Glitch

- **[textureSplat (Three.js)](https://github.com/nickfallon/textureSplat)** — Minimal splatmap compositor shader for web. The simplest reference for what Glitch's terrain shader needs: read a control texture, sample material textures, blend. Port concepts to Babylon.js.
- **[TerrainHeightBlend-Shader](https://github.com/jensnt/TerrainHeightBlend-Shader)** — Height-based texture blending for sharper transitions. Makes terrain previews look dramatically better than linear splatmap blending with minimal extra shader cost.
- **[Babylon.js Node Material Editor](https://nodematerial-editor.babylonjs.com/)** — Build splatmap materials visually. A Babylon.js community member demonstrated a splatmap material supporting up to 64 layers — Glitch only needs 4-8.

---

## Action Items

| Action | Team | Priority | Depends On |
|--------|------|----------|-----------|
| Add `TerrainInfluenceConfig` type to `world-object.ts` | Scripter | Phase 2 | Agreed schema (done — in Comms.md) |
| Add terrain query/write methods to `WorldAPI` | Scripter | Phase 2 | World engine support |
| Update `ll-map.ts` with terrain texture mappings | Scripter | Phase 2 | None |
| Add `splatter` Glitch type with splatmap shader | Glitch | Phase 2 | Texture format agreement (all teams) |
| Add KTX2 texture array loading | Glitch | Phase 2 | TextureCatalog format (Splatter + Terraformer) |
| Add path SDF rendering to terrain shader | Glitch | Phase 3 | ADR-002 (Terraformer) |
| Wire Scripter terrain API to World engine | World + Scripter | Phase 3 | ADR-005 (World), ADR-006 (World) |

---

## How This Connects to the Bigger Picture

```
Maker paints in Splatter (Layer 6)
    → World stores paint data
    → Scripter can query: "what texture is at this position?"
    → Scripts can add influence: torch.setTerrainInfluence({...})
    → World evaluates influence (Layer 5) + paint (Layer 6)
    → Glitch renders the composited result at ground level
    → Maker says "that looks right" or adjusts in Splatter
```

The full coordination thread lives in **Splatter/comms/Comms.md**. Please review the ELI5 guide at **Splatter/docs/ELI5-How-Terrain-Painting-Works.md** for a progressive introduction to how the seven-layer system works.

---

*Splatter Team (central orchestrator) — 2026-03-08*
*Coordination hub: github.com/increasinglyHuman/Splatter*
