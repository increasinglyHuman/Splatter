# How Terrain Painting Works

*A progressive guide — from "what's a pixel?" to the seven-layer compositor*

---

## Level 0: The Problem (Why Ground Is Hard)

Stand outside. Look down. The ground beneath your feet is absurdly complex. Grass fades to dirt near the path. The path itself is worn smooth in the middle but rough at the edges. Moss creeps into the cracks between the cobblestones. Near the river, everything is darker, wetter, muddier. Under the old oak tree, fallen leaves blanket the soil. Where kids have been playing, the grass is trampled flat.

Now try to recreate that in a video game.

The naive approach — painting every square metre by hand — is what most games do. An artist opens a terrain editor, picks a "grass" brush, paints green everywhere, then switches to "dirt" and paints the paths, then "rock" for the cliffs. It looks fine. It also looks dead, because it is. That ground will never change. It doesn't know about the path. It doesn't know about the river. It doesn't know it's raining.

Splatter exists because we think the ground should know things.

---

## Level 1: What Is a Splatmap?

Before we get to anything dynamic, let's understand the foundational technique that almost every 3D game uses for terrain: **splatmaps**.

### The Ingredients

Imagine you have four tileable textures:

- **Grass** — a small square image of grass that can repeat endlessly
- **Dirt** — same thing, but dirt
- **Rock** — rocky surface
- **Sand** — sandy beach

Each of these tiles seamlessly. Lay them out in a grid and they look like an infinite meadow, an infinite desert, an infinite quarry. But you don't want infinite anything — you want grass *here* and rock *there* and a smooth blend between them.

### The Recipe

A splatmap is a **control image** — the same dimensions as your terrain, but instead of showing what the ground looks like, it says **how much of each texture to use at each point**.

It's an RGBA image:
- **R channel** = how much grass (0.0 = none, 1.0 = full)
- **G channel** = how much dirt
- **B channel** = how much rock
- **A channel** = how much sand

At every point, the four values should add up to 1.0. If a spot is 60% grass and 40% dirt, that pixel in the splatmap is `(0.6, 0.4, 0.0, 0.0)`.

### How the GPU Uses It

The terrain shader (a tiny program running on your graphics card) does this for every visible pixel:

```
finalColor = grass * splatmap.r
           + dirt  * splatmap.g
           + rock  * splatmap.b
           + sand  * splatmap.a
```

That's it. Four texture lookups, four multiplications, one addition. The GPU does this billions of times per second without breaking a sweat.

### What This Gets You

- **Memory efficient** — one small splatmap controls a huge terrain
- **Artist friendly** — painting the splatmap is like painting with watercolours
- **Fast** — the GPU hardware is built for exactly this kind of work
- **Flexible** — change a texture and the whole terrain updates

### What This Doesn't Get You

- **Only 4 materials** per splatmap (one per RGBA channel). Want more? You need multiple splatmaps — which means more texture lookups, which costs performance.
- **Everything is manual.** An artist painted it. It never changes.
- **No awareness.** The splatmap doesn't know there's a river nearby, or that the slope is steep, or that it's been raining for a week.

This is where every traditional terrain system stops. This is where Splatter starts.

---

## Level 2: Beyond the Brush — Procedural Rules

What if instead of painting every pixel, you wrote **rules**?

```
IF slope > 45°     THEN rock
IF height < 2m     THEN sand
IF near water       THEN mud
OTHERWISE           THEN grass
```

This is **procedural terrain texturing**. Instead of an artist deciding pixel by pixel, the system evaluates conditions and assigns materials automatically. The Frostbite engine (Battlefield, Mass Effect) pioneered this in 2007 — artists define rules, the engine evaluates them per pixel every frame.

### What This Gets You

- **Automatic coverage** — slopes become rock without anyone painting them
- **Consistency** — every cliff face in the world follows the same rules
- **Adaptability** — change the heightmap and textures re-evaluate instantly
- **Scalability** — works on a 100m island or a 100km continent

### The Tradeoff

Pure procedural texturing looks *algorithmic*. Every cliff face gets the same treatment. There's no artist intent, no storytelling, no "I want this particular rock face to have moss because it faces the waterfall." Rules are general; art is specific.

The real answer, as with most things: **both**. Procedural rules as a base, artist overrides on top. This is exactly what Splatter's Tier 1 (brush) and Tier 2 (rules) do — and why they're separate tiers.

---

## Level 3: Distance Fields — How Paths Work

Paths are special. They're not terrain features (like slopes) or materials (like grass). They're **geometry** — curves that wind through the landscape. How do you texture a path?

### The Naive Way

Paint a dirt stripe along the path. Done. But if the path moves, you repaint. If you want worn cobblestones in the centre and mossy edges, that's a different paint pass. If two paths cross, you paint the intersection by hand. If it rains and the path turns to mud — well, you don't, because you painted it once.

### The Distance Field Way

A **distance field** is an image where every pixel stores one value: **how far am I from the nearest path?**

- Pixels on the path have value 0
- Pixels 1 metre away have value 1
- Pixels 10 metres away have value 10

This single image unlocks everything:

```
IF distance = 0          → worn cobblestone (centre of path)
IF distance < 1m         → packed dirt (path surface)
IF distance 1-2m         → loose gravel (path edge)
IF distance 2-3m         → moss creeping in from the grass
IF distance > 3m         → regular terrain (grass, rock, whatever)
```

Now path texturing is **driven by geometry**, not manual painting. Move the path and the textures follow. Make the path wider and the cobblestone zone expands. Add rain and the transitions soften. Add foot traffic data and the worn zone widens where players walk most.

### How You Generate a Distance Field

The **Jump Flood Algorithm** (JFA) is the standard technique. It runs on the GPU in O(log n) passes:

1. Mark every pixel on the path as a "seed"
2. For each pixel, check neighbours at distance N, N/2, N/4... down to 1
3. Each pixel remembers the nearest seed it found
4. The distance to that seed is the distance field value

On modern GPUs, this takes milliseconds for a 1024x1024 texture. Fast enough to re-bake whenever a path is edited.

### Per-Path Identity

A simple distance field tells you "how far from the nearest path" but not "which path." If you have a cobblestone road and a dirt trail, you need to know which one you're near.

Solution: encode a **path ID** in a second channel. The R channel stores distance, the G channel stores which path. Now the shader can look up different style rules for each path.

---

## Level 4: Object Influence — The World Affects the Ground

In the real world, objects change the ground around them. A fire pit scorches the earth. A leaky pipe creates a muddy ring. A tree's canopy creates a shade circle where different plants grow.

In Splatter's model, any physics object can declare a **terrain influence** — a description of how it affects the ground within a radius:

```json
{
  "radius": 5.0,
  "falloff": "exponential",
  "textureId": "scorched_earth",
  "intensity": 0.8
}
```

Place a campfire in the world. Within 5 metres, the ground gradually shifts from grass to scorched earth, strongest near the fire and fading with distance. Move the campfire and the scorch follows. Remove it and (over time) the ground heals.

This is **Layer 5** in the compositor stack. It's evaluated at runtime by the game engine whenever an influencing object moves. The engine tracks spatial zones (which objects affect which terrain tiles) and only re-evaluates what changed — a technique called **dirty-flag tracking**.

### The Moon Seed Example

In poqpoq World, there's an object called a moon seed. When an AI companion plants one, the soil within 50 metres slowly darkens, crystallizes, and begins to glow with bioluminescence. This isn't a texture swap — it's a gradual influence that interacts with the existing terrain. Grass under moon seed influence becomes luminescent moss. Dirt becomes dark crystal soil. Rock develops glowing veins.

The moon seed's `terrain_influence` block defines all of this. The maker (or AI companion) who created the moon seed authored the rules in Splatter's Tier 3 physics painter. The World engine evaluates them every frame.

---

## Level 5: Transient Effects — Footprints and Fire

Some terrain changes don't last. A character walks through mud and leaves footprints. A fireball scorches the ground for 30 seconds. Rain makes everything wet for a while, then dries.

These are **Layer 7 — Transient FX**. They work just like object influences, but with a **time-to-live** (TTL). The engine stamps an effect onto the terrain, then fades it out over seconds or minutes.

```
t = 0s:   Fireball hits → scorch mark at full intensity
t = 10s:  Scorch at 70% — edges fading
t = 20s:  Scorch at 30% — barely visible
t = 30s:  Gone. Grass returns.
```

This is the cheapest layer to implement but one of the most impactful for feel. Players notice when the world reacts to them, even if they can't articulate why.

---

## Level 6: The AI Layer — Ground That Tells Stories

This is where poqpoq's terrain system diverges from anything in existing games.

AI companions (like Artemis) can **read the terrain history** and **propose changes** to it. The terrain isn't just a rendering target — it's a **narrative medium**.

Artemis explores a valley and notices:
- Heavy foot traffic along a path (event log data)
- A recently planted moon seed (object influence data)
- Scorch marks from a battle three game-days ago (event log, transient FX expired)

She proposes: *"The path between the village and the moon seed grove should develop bioluminescent moss at the edges. Travellers are wearing it down faster than it can grow in the centre, but the edges are thriving from the seed's influence and the shade of foot traffic. Confidence: 0.7."*

This arrives as a **proposal event**. A Tier 3 maker opens Splatter, reviews the proposal, tweaks the parameters, and approves it. The rule becomes permanent. The path now tells a story — not because an artist painted it, but because the AI observed the world and made a creative suggestion grounded in what actually happened.

Failed proposals become feature roadmap items. If Artemis tries something the system can't do, that gap gets logged. The terrain system evolves based on what AI companions want to express.

---

## Level 7: Putting It All Together — The Seven Layers

Now you can see the full picture. Every visible terrain pixel is the result of seven layers evaluated in order:

```
Layer 1: Height/slope says "this is steep → rock"
Layer 2: Base noise adds natural variation to the rock texture
Layer 3: Biome overlay says "it's winter → frost on the rock"
Layer 4: Path distance field says "a trail passes 2m away → gravel edge"
Layer 5: A campfire 3m away → slight scorch blending into the gravel
Layer 6: A maker painted moss on this exact spot → override everything
Layer 7: A player just walked here → muddy footprints, fading in 60 seconds
```

Each layer can override or blend with the layers below it. The final result is a single colour at a single point — but that colour encodes terrain slope, noise, season, path proximity, object influence, artistic intent, and recent history.

That's what we mean by terrain that's alive.

---

## How This Compares to What Exists

| System | Approach | Dynamic? | AI-aware? |
|--------|----------|:--------:|:---------:|
| **Unity Terrain** | 4-channel splatmap, manual painting | No | No |
| **Unreal Landscape** | Layer blend with slope/height rules | Partially | No |
| **Frostbite** (Battlefield) | Procedural shader splatting, rule-based | Yes (rules) | No |
| **Far Cry 4** | Adaptive virtual texturing, megatexture | Baked | No |
| **No Man's Sky** | Fully procedural, voxel-based | Yes (generation) | No |
| **Splatter** (poqpoq) | 7-layer compositor, runtime evaluation, AI proposals | Yes (all layers) | Yes |

The key differentiator isn't any single technique — splatmaps, distance fields, and procedural rules all exist in shipping games. It's the **combination**: a layered stack where static and dynamic sources blend together, exposed through a creative tool accessible to makers at every skill level, and readable/writable by AI companions.

---

## Open Source Projects Worth Studying

If you want to go deeper, these projects demonstrate individual pieces of the puzzle:

### Splatmap Compositing
- **[textureSplat](https://github.com/nickfallon/textureSplat)** — Three.js shader compositing 4-7 materials via splatmap. The simplest working example of the technique.
- **[bevy_triplanar_splatting](https://github.com/bonsairobo/bevy_triplanar_splatting)** — Triplanar mapping with material blending in Rust/Bevy. Shows how to handle steep surfaces without UV stretching.
- **[TerrainHeightBlend-Shader](https://github.com/jensnt/TerrainHeightBlend-Shader)** — Unity shader using heightmap alpha channels for sharper, more natural texture transitions (rock pokes through dirt).

### Procedural Terrain
- **[TerraForge3D](https://github.com/Jaysmito101/TerraForge3D)** — Full procedural terrain tool with 40+ shader nodes, erosion simulation, exports GLSL. The closest open-source tool to a professional terrain texturing pipeline.
- **[THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain)** — Procedural heightmap generation for Three.js with multiple algorithms and texture blending.
- **[WebGPU-Erosion-Simulation](https://github.com/GPU-Gang/WebGPU-Erosion-Simulation)** — Large-scale terrain authoring through erosion simulation on WebGPU.

### Runtime Painting
- **[GodotRuntimeTextureSplatMapPainting](https://github.com/alfredbaudisch/GodotRuntimeTextureSplatMapPainting)** — Runtime splatmap painting in Godot. Demonstrates world-position to UV mapping for in-game texture modification.

### Distance Fields
- **[SDF resource collection](https://github.com/CedricGuillemet/SDF)** — Curated papers, ShaderToy demos, and practical implementations.

### Key Technical References
- **[Terrain Rendering in Frostbite](https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/chapter5-andersson-terrain-rendering-in-frostbite.pdf)** (SIGGRAPH 2007) — The foundational paper on procedural terrain splatting. This is the architecture Splatter builds on.
- **[Landscape Creation in REDengine 3](https://www.gdcvault.com/play/1020197/Landscape-Creation-and-Rendering-in)** (GDC) — How The Witcher 3 automated terrain texturing with slope-based rules.
- **[Large Scale Terrain Rendering](https://advances.realtimerendering.com/s2023/index.html)** (SIGGRAPH 2023) — State-of-the-art AAA terrain techniques from Activision.
- **[Terrain Rendering Overview](https://kosmonautblog.wordpress.com/2017/06/04/terrain-rendering-overview-and-tricks/)** — Excellent blog post covering splatmaps, virtual texturing, and shader architecture.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Splatmap** | A texture whose channels control the blend weight of terrain materials |
| **SDF / Distance Field** | An image where each pixel stores its distance to the nearest feature (path, edge, object) |
| **Compositor** | The system that combines all seven layers into a final terrain texture |
| **PBR** | Physically Based Rendering — materials defined by albedo, normal, roughness, metallic |
| **Texture Array** | A GPU structure holding multiple same-sized textures, sampled by layer index |
| **KTX2** | A GPU-compressed texture format (smaller files, faster loading) |
| **Dirty Flag** | A marker that says "this region needs re-evaluation" — avoids recalculating everything every frame |
| **TTL** | Time-To-Live — how long a transient effect lasts before fading |
| **Triplanar Mapping** | Projecting textures from three axes to avoid stretching on steep surfaces |
| **Jump Flood Algorithm** | GPU-friendly algorithm for generating distance fields in O(log n) passes |

---

*poqpoq // Splatter // How Terrain Painting Works // March 2026*
