# poqpoq // Architecture Decision Record

---

# ADR-002 — Path System Integration & SDF Contract

| Field | Value |
|-------|-------|
| **Status** | Draft — awaiting team review |
| **Date** | March 2026 |
| **Author** | Terraformer Team |
| **Domain** | Terrain · Paths · Texture Compositing |
| **Affects** | Terraformer · World · SplatPainter · Glitch |
| **Depends on** | ADR-001 (Terrain Texture Authority) |

---

## Context

ADR-001 established that path curves are defined in Terraformer and consumed downstream by World (runtime styling), SplatPainter (PathStyleEditor), and Glitch (rendering). The **fact** of a path (geometry) is baked by Terraformer. The **condition** of a path (surface material, wear, moss) is evaluated at runtime by World using rules from SplatPainter.

This ADR defines the data contract between Terraformer (producer) and all consumers: the **path distance field texture** and its companion **spline metadata sidecar**.

### Design Constraints

1. World needs per-fragment distance-to-path for shader evaluation (smoothstep falloff, edge noise)
2. SplatPainter's PathStyleEditor needs per-path identification (different styles per path)
3. Glitch needs the same data for preview rendering
4. DungeonMaster's corridor paths may conform to this format in the future
5. The format must be efficient enough for save-time baking on max-size terrain (1024x1024)
6. WebGL2 compatibility required (no compute shaders assumed)

---

## Decision

Terraformer exports a **two-channel RG16F distance field texture** and a **JSON spline metadata sidecar**. Together, these constitute the path contract.

### 1. Distance Field Texture Format

| Property | Value | Rationale |
|----------|-------|-----------|
| **Dimensions** | Match heightmap resolution (e.g., 1024x1024) | 1:1 UV mapping, no interpolation mismatch |
| **Format** | RG16F (two-channel half-float) | R = distance, G = path ID; half-float avoids R8 banding on wide paths |
| **Encoding** | See channel layout below | |
| **File export** | `pathSDF.bin` (raw Float32 pairs) + `pathSDF.png` (8-bit fallback preview) | Binary for precision, PNG for human inspection |
| **Upload** | `RawTexture` with `TEXTUREFORMAT_RG` / `TEXTURETYPE_HALF_FLOAT` | Babylon.js WebGL2 native support |

#### Channel Layout

```
R channel: Normalized distance to nearest path
  0.0 = on path centerline
  1.0 = at maximum influence distance (maxDistance uniform)
  Values beyond 1.0 are clamped — fragment is outside all path influence

G channel: Path ID index (integer encoded as float)
  0.0 = path index 0 (first path in splineMetadata.paths[])
  1.0 = path index 1
  ...
  N.0 = path index N
  -1.0 = no path (fragment outside all paths)

Maximum 255 distinct paths per terrain.
```

#### Distance Normalization

Distance is normalized against a global `maxInfluenceDistance` value stored in the metadata sidecar. This value equals the maximum `width + falloff` across all paths in the terrain, plus a configurable margin (default: 10 world units).

```
normalizedDistance = clamp(worldDistance / maxInfluenceDistance, 0.0, 1.0)
```

Consumers recover world-space distance by multiplying: `worldDist = texelR * maxInfluenceDistance`.

#### Path ID Resolution

When a fragment is within influence range of multiple paths, the **nearest** path wins. The G channel stores that path's index. Consumers look up the path's style rules via `splineMetadata.paths[pathIndex]`.

For overlapping paths (e.g., a trail crossing a road), the distance field stores the minimum distance. The path ID corresponds to whichever path is closest at that texel. Intersection styling rules are the responsibility of PathStyleEditor (SplatPainter), not the distance field.

### 2. Spline Metadata Sidecar

Exported as `splineMetadata.json` alongside the SDF texture.

```typescript
interface SplineMetadata {
    version: '2.0'
    maxInfluenceDistance: number       // Global normalization constant
    terrainSize: number                // World units (e.g., 1000)
    sdfResolution: number              // Texture resolution (e.g., 1024)
    paths: SplineMeta[]
}

interface SplineMeta {
    index: number                      // Path ID (matches G channel encoding)
    id: string                         // UUID from Terraformer
    name: string                       // Human-readable (auto-generated or user-set)
    type: PathType                     // 'trail' | 'path' | 'road' | 'river'
    closed: boolean                    // Loop?
    length: number                     // Total arc length in world units
    controlPointCount: number          // Number of control points
    avgWidth: number                   // Average half-width across all samples
    avgFalloff: number                 // Average falloff across all samples
    maxWidth: number                   // Maximum half-width (for bounding)
    maxFalloff: number                 // Maximum falloff (for bounding)
    depth: number                      // Max channel depth (rivers only, 0 otherwise)
    boundingBox: {                     // World-space AABB
        min: [number, number, number]
        max: [number, number, number]
    }
    controlPoints: {                   // Full control point data for PathStyleEditor
        position: [number, number, number]
        width: number
        falloff: number
        depth: number
        textureId?: string
    }[]
}

type PathType = 'trail' | 'path' | 'road' | 'river'
```

### 3. BBT Bundle Integration (v2.1)

The BBT export bundle adds two files:

```
terrain.bbt (ZIP)
├── terrain.json          (existing)
├── heightmap.png         (existing)
├── heightmap.r16         (existing)
├── splatmap.png          (existing)
├── zone_table.json       (existing, v2.0+)
├── paths.json            (existing, Phase 5B — raw control point data)
├── pathSDF.bin           (NEW — RG16F distance field, raw binary)
├── splineMetadata.json   (NEW — path metadata sidecar)
├── thumbnail.png         (existing)
└── readme.txt            (existing)
```

`paths.json` (existing `PathSplineJSON[]` export) is retained for backward compatibility. `splineMetadata.json` is the forward-looking format with additional computed fields (length, bounding box, averages).

---

## Baking Algorithm

### Phase 1: Brute-Force (Sprint 5D, correct-first)

```
For each texel (u, v) in the SDF texture:
    worldX = u / sdfResolution * terrainSize
    worldZ = v / sdfResolution * terrainSize

    minDistance = Infinity
    nearestPathIndex = -1

    For each path p (index i):
        For each sample s in p.samplePoints:
            dx = worldX - s.position.x
            dz = worldZ - s.position.z
            dist = sqrt(dx*dx + dz*dz)

            influenceRadius = s.width + s.falloff
            if dist < minDistance AND dist <= influenceRadius:
                minDistance = dist
                nearestPathIndex = i

    R = minDistance == Infinity ? 1.0 : clamp(minDistance / maxInfluenceDistance, 0, 1)
    G = nearestPathIndex (as float)

    Write (R, G) to texture
```

**Complexity:** O(resolution^2 x totalSamples)
**Expected time:** 50-100ms per spline on 1024x1024 terrain (benchmarking pending)

### Phase 2: Jump Flood Algorithm (optimization, if needed)

If brute-force exceeds 200ms on max-size terrain:

1. Seed JFA texture with path sample positions (each seed carries its path index)
2. Run log2(resolution) JFA passes on GPU via WebGL framebuffer ping-pong
3. Final pass computes distance from seed positions and writes RG16F output

**Complexity:** O(resolution^2 x log2(resolution))
**Expected speedup:** 10-20x over brute-force

### Incremental Re-bake

For single-path edits (control point drag, width change):

1. Compute bounding box of edited path + max influence radius
2. Only recompute texels within that bounding box
3. For texels where the edited path was previously nearest: full re-evaluate (may switch to different nearest path)
4. Full re-bake on path add/remove or on export

---

## Consumer Integration Guide

### World: Runtime Path Evaluation Shader

```glsl
uniform sampler2D pathSDF;           // RG16F distance field
uniform float maxInfluenceDistance;   // From splineMetadata.json
uniform int pathCount;               // Number of paths

// Per-path style arrays (from PathStyleEditor via SplatPainter)
uniform vec3 pathBaseColor[32];
uniform float pathWidth[32];
uniform float pathEdgeVariance[32];
uniform float pathWearSensitivity[32];
uniform float pathMossIntensity[32];

void evaluatePath(vec2 uv, inout vec3 color, inout vec3 normal) {
    vec2 sdf = texture(pathSDF, uv).rg;
    float normalizedDist = sdf.r;
    int pathIndex = int(sdf.g + 0.5);  // Round to nearest int

    if (pathIndex < 0 || normalizedDist >= 1.0) return;  // No path influence

    float worldDist = normalizedDist * maxInfluenceDistance;
    float pathW = pathWidth[pathIndex];
    float edgeNoise = noise(uv * 8.0) * pathEdgeVariance[pathIndex];

    // Core path weight (same smoothstep as ADR-001)
    float pathWeight = 1.0 - smoothstep(0.0, pathW + edgeNoise, worldDist);

    // Wear from traffic (Layer 4 runtime data)
    float wornWeight = pathWeight * trafficIntensity * pathWearSensitivity[pathIndex];

    // Moss creep from edges (retreats from worn center)
    float mossZone = smoothstep(pathW * 0.6, pathW, worldDist);
    float mossWeight = mossZone * pathMossIntensity[pathIndex] * moistureFactor;

    // Blend
    vec3 pathColor = pathBaseColor[pathIndex];
    color = mix(color, pathColor, pathWeight * 0.85);
    color = mix(color, vec3(0.2, 0.35, 0.15), mossWeight * 0.4);
    normal = mix(normal, vec3(0.0, 1.0, 0.0), pathWeight * 0.5);
}
```

### SplatPainter: PathStyleEditor Consumption

SplatPainter receives `splineMetadata.json` in the `SPLATPAINTER_INIT` payload (field: `splineMetadata`). PathStyleEditor uses:

- `paths[].index` — maps to G channel for visual highlighting ("show me where this path is")
- `paths[].type` — determines default style preset (trail=dirt, road=gravel, river=wet stone)
- `paths[].controlPoints` — renders path preview in the editor canvas
- `paths[].avgWidth / maxWidth` — scales brush preview to path dimensions

PathStyleEditor does NOT re-implement distance field computation. It reads the pre-baked SDF for preview rendering.

### Glitch: Preview Rendering

Glitch samples the SDF texture identically to World's shader but with simplified styling (no wear, no moss — just base path color from type). The `pathSDF.bin` and `splineMetadata.json` are loaded from the same BBT bundle or served via World's asset URL.

---

## Scope Boundaries

### In Scope (Terraformer)
- Distance field computation (bake)
- Path ID assignment and encoding
- SDF texture export (binary + fallback PNG)
- Spline metadata sidecar generation
- BBT bundle integration

### Out of Scope (Terraformer)
- Runtime path styling (World)
- Path material assignment UI (SplatPainter PathStyleEditor)
- Wear simulation, moss creep, seasonal effects (World Layer 4)
- 3D distance fields for enclosed geometry (DungeonMaster, if ever needed)
- Path intersection styling rules (SplatPainter)

### 2D Assumption

This SDF is a 2D distance field computed in the XZ plane. The Y coordinate (height) is ignored in distance computation, consistent with Terraformer's existing `findNearestSample()` behavior. This is appropriate for heightmap-based terrain where paths follow the surface.

For enclosed 3D geometry (dungeon corridors), the `dimensions` field in metadata should be extended to `'2d' | '3d'`. The 3D variant would require a volumetric distance field (out of scope for this ADR). DungeonMaster's octile grid topology provides its own spatial proximity model and may not need an SDF at all.

---

## Consequences

**Positive:**
- Single data contract serves all three consumers (World, SplatPainter, Glitch)
- RG16F provides sub-texel precision for smooth falloff (no R8 banding)
- Path-ID encoding enables per-path styling without additional textures
- Brute-force-first approach ensures correctness; JFA optimization is additive
- BBT v2.1 is backward compatible (new files are additive)

**Costs:**
- RG16F doubles SDF texture memory vs. single-channel (4 MB vs 2 MB at 1024x1024) — acceptable
- Path-ID limit of 255 per terrain — sufficient for foreseeable use cases
- Brute-force bake may be slow on max-size terrain with many paths — JFA mitigation planned
- Consumers must agree on `maxInfluenceDistance` normalization — metadata sidecar provides this

---

## Review Checklist

- [ ] **World team:** Confirm shader integration example matches your compositor architecture
- [ ] **Splatter team:** Confirm `SplineMeta` interface has all fields PathStyleEditor needs
- [ ] **DungeonMaster team:** Confirm 2D scope acknowledgment is acceptable; flag if corridor SDF is needed sooner
- [ ] **Glitch team:** Confirm `pathSDF.bin` loading is feasible in your asset pipeline
- [ ] **All teams:** Agree on `maxInfluenceDistance` normalization approach

---

*poqpoq · ADR-002 · Path System Integration & SDF Contract · March 2026*
*Author: Terraformer Team (BlackBoxTerrains)*
