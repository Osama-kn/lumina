# Adding models

There are three ways to put a model into Lumina:

1. **Drop a `.glb` onto the page.** Nothing to install. Good for trying a file.
2. **Ship a 3D file with the app.** Put it in `examples/` with an optional details file. Everyone who opens your copy sees it.
3. **Write a model as code.** Describe the shape with maths, like the planets and molecules.

Whichever way you choose, a model ends up as a set of particles, each belonging to a **part**. Each part has a name, a colour, a one-line explanation, and a rule for where it flies when the model comes apart.

## 1. Drop a file

Drag a `.glb` onto the page, or choose **Open 3D file**. It's read on your device and nothing is uploaded.

- Every named object in the file becomes a part. Lumina uses the highest level of the object tree that has at least two names. If the whole file is one object, it's split into up to 6 regions by position.
- If there are more than 12 parts, the smallest ones are merged into their nearest neighbour.
- Names are tidied up: `left_wheel.001` becomes *Left wheel* and `GearBox` becomes *Gear box*.
- Colours come from each object's material. Near-black, near-white and grey materials get a bright colour from Lumina's palette instead, because particles are drawn as glowing light.

## 2. Ship a 3D file with the app

1. **Export a `.glb`.** In Blender, use *File → Export → glTF 2.0* and choose the *glTF Binary* format. Name your objects in the outliner: those names become the labels.
2. **Shrink it if needed.** 200,000 particles don't need millions of triangles or any textures:

   ```bash
   node scripts/slim-glb.mjs my-model.glb examples/my-model.glb 60000
   ```

   This keeps the object names and base colours, drops textures, and thins the triangles to about 60,000. A `.gltf` with a `.bin` file beside it works as input too.
3. **Describe it (optional).** Add `examples/my-model.json`, described below.
4. **Register it.** In `src/models/registry.js`, add a line to `ENTRIES`:

   ```js
   example('my-model', 'My model'),
   ```

   The second argument is the name shown in the model list. It must match `name` in the JSON file if you set one there.
5. **Test it.** Run `npm test`. A test loads every bundled file and checks the rules below. It also checks that every part has an explanation in your details file, so no part is left with the default text.
6. **Credit it.** If the model isn't yours, add its author and licence to `examples/CREDITS.md` and put them in `credit` too.

### The details file

Every field is optional.

```json
{
  "name": "Toy car",
  "blurb": "A wind-up toy car. Pull it apart to see the gears.",
  "scale": 0.9,
  "rotation": [0, 30, 0],
  "credit": "\"Toy Car\" by Someone, CC BY 4.0",
  "parts": {
    "Wheels": {
      "merge": ["Wheel_FL", "Wheel_FR", "Wheel_BL", "Wheel_BR"],
      "info": "Four wheels on two axles. The back pair is driven by the spring.",
      "color": "#7fb2ff",
      "dir": [0, -0.8, 0],
      "spread": 0.4
    },
    "Body": { "info": "The painted tin shell that hides the clockwork." }
  }
}
```

| Field | Meaning |
| --- | --- |
| `name` | Title shown in large type. Defaults to the file name. |
| `blurb` | One line under the title. |
| `scale` | Size multiplier after Lumina fits the model to the screen. Use it if the model looks too big or too small. |
| `rotation` | `[x, y, z]` in degrees, applied in that order before fitting. Use it if the file faces the wrong way. |
| `credit` | Author and licence. |
| `parts` | Keyed by the part's display name. |
| `parts.*.merge` | Object names from the file (as written in the file) that should form this part. Any object whose name, or any parent's name, appears here goes into this part. |
| `parts.*.info` | The sentence shown when someone points at the part. |
| `parts.*.color` | `#rrggbb`. |
| `parts.*.dir` | `[x, y, z]`: where the part flies when the model is fully apart. A length of about 0.5 to 1.5 works well. `y` is up. |
| `parts.*.spread` | How much the part also grows around its own centre (0 means not at all; 0.2 to 0.5 is typical). |

A part key without `merge` matches the object of that (tidied) name: `"Body"` matches an object called `body` or `BODY`.

## 3. Write a model as code

Copy [`src/models/template.js`](../src/models/template.js) into `src/models/procedural/`. It builds a planet with a ring in about 30 lines, and every line is explained. Then:

1. Change `name`, `blurb` and `parts`.
2. Write `build(n, rng)`. It returns `n` entries of `[[x, y, z], partIndex]`. Use `allocate(n, weights)` to split the particles between parts.
3. Use only `rng()` for randomness, so the model looks the same every time.
4. Import it in `src/models/registry.js` and add it to `MODELS`.

`src/models/geometry.js` has helpers for shapes: points on spheres, smooth curves, tubes, boxes and ellipsoids. The existing models in `procedural/` show them in use.

## The rules every model follows

The tests in `tests/unit/models.test.js` check every model, bundled or coded:

- exactly `n` particles, and the same ones every time for the same seed
- every part has particles
- at most 12 parts (the shaders hold 12 colours and rules)
- the model fits on screen: its farthest particle is between 0.5 and 1.8 from the centre
- building 200,000 particles takes less than 1.5 seconds
- every part has an explanation longer than 20 characters

## When a file won't load

| Message | What to do |
| --- | --- |
| *isn't a 3D model Lumina can read* | Lumina reads glTF only. Export as `.glb`. |
| *is compressed (Draco or Meshopt)* | Export again with compression turned off. |
| *uses separate files* | A `.gltf` that points to `.bin` or image files can't be dropped. Export a single `.glb`, or run it through `scripts/slim-glb.mjs`. |
| *has no surfaces* | The file has only points, lines or empty objects. |
| *is too big* | Over 50 MB or 5 million triangles. Shrink it with `scripts/slim-glb.mjs`. |
