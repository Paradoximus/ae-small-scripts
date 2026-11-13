# AE Small Scripts

A dockable **After Effects** panel that turns a folder of ExtendScript files into a column of
buttons, plus the scripts that live in it: pinning 2D layers to 3D ones with perspective
scale, MoGraph-style effectors for layers and text, a delayed-parent rig, a null blended
between two parents, a shape-layer scale reset, and a set of timeline and project helpers.

🇷🇺 [Версия на русском](README.ru.md)

> Windows · After Effects 2025 / 2026 / Beta · the scripts' UI (buttons, tooltips, alerts) is in Russian

- [The panel](#the-panel)
- [Scripts](#scripts)
- [Installation](#installation)
- [Adding your own scripts](#adding-your-own-scripts)
- [Development](#development)
- [Compatibility](#compatibility)
- [License](#license)

## The panel

`Small_Scripts_Panel.jsx` scans one folder and makes a button for every `.jsx` / `.js` file in it.

- The button label and its tooltip — what the script does and what to prepare before running
  it — come from a short header block at the top of each script
  (see [Adding your own scripts](#adding-your-own-scripts)). A script without a header still
  gets a button, labelled with its file name.
- **Reload** rescans the folder without restarting AE: drop a script in, press Reload.
- **Folder…** picks the scripts folder. The choice is stored in AE's preferences.
- **Open dir** opens the folder in Explorer.
- Only the top level of the folder is scanned. To hide a script from the panel, move it into
  any subfolder.

It works docked (installed into *ScriptUI Panels*) or as a floating palette
(*File → Scripts → Run Script File…*).

## Scripts

### 3D and camera

#### 📌 2D ↔ 3D below (Position)

`Pin_2D_layer_to_3D_below.jsx`

Pins the selected 2D layer to the on-screen position of the 3D layer directly below it in
the layer stack. A Position expression projects the 3D layer's anchor point through the active
camera with `toComp()`. The pinned layer stays 2D, so blending modes, 2D effects and layer
order behave as usual. Scale, Rotation and Opacity are left alone.

It is a toggle: run it again on a pinned layer to unpin. The current position is baked in, so
the layer stays exactly where it was on that frame. Handles parented 2D layers and Separate
Dimensions. Silent by design: if the selected layer isn't 2D or there is no 3D layer right
below it, nothing happens.

**Before running:** select a 2D layer with a 3D layer (a null, a solid…) directly beneath it.
To unpin, select the pinned layer and go to the frame you want to keep.

#### 📌 2D ↔ 3D below (Position + Scale)

`Pin_2D_layer_to_3D_below_scale.jsx`

The same pin, plus the 2D layer's Scale follows the size of the 3D layer as seen through the
camera: camera push-ins, zoom, the layer moving in depth, and the Scale of the 3D layer and its
parents. Rotating the 3D layer doesn't change it. The frame you run it on is the calibration
frame: there the 2D layer keeps its current size, and from there it grows and shrinks
proportionally. The layer's own Scale, keyframes included, is multiplied, not replaced. It also
works without a camera layer, through the comp's default camera.

The visible size is the smaller singular value of the screen-space Jacobian of `toComp()` over
the 3D layer's three local axes. For a uniformly scaled layer that is exactly
Scale · zoom / depth, anywhere in the frame, whatever the layer's rotation. The derivation and
the rejected approaches are in [NOTES.md](NOTES.md) (Russian).

Toggle: on a layer pinned with Scale it unpins and bakes both Position and Scale; on a layer
pinned by the Position-only button it adds Scale. The Position-only button unpins both.

**Before running:** select the 2D layer above a 3D layer and go to the frame where the 2D
layer's size looks right.

#### 🔀 Blend parent (A ↔ B)

`Blend_parent_2_layers.jsx`

Creates a 3D null that behaves as if it were parented to two 3D layers at once, with a
weight (it is done with expressions, not real parenting). At **Blend** = 0
the null follows layer A's world transform exactly, at 1 layer B's; in between, position and
scale are interpolated linearly and rotation along the shortest arc (slerp). The parents of A
and B are taken into account. Parent your own layers to this null as to any other parent. The
targets can be changed later in the **Parent A** / **Parent B** layer controls.

**Before running:** select exactly two 3D layers. The first one selected becomes A (Blend 0),
the second B (Blend 1). Don't parent the new null to anything: its transform is computed in
world space.

### Rigs and motion

#### ⏳ Delay children (trail)

`Delay_children_trail.jsx`

The selected null stays the parent, but its children repeat its animation with a lag. The
children's own transforms and keyframes are untouched: expressions only compensate the parent's
transform over the time offset. Delay = **Delay (frames)** on the null × **Delay mult** on each
child (1, 2, 3… from top to bottom by default, a ready-made cascade). Position is compensated
exactly via `toWorld` / `fromWorld`; Rotation and Scale per component, so for a 3D null
rotating on several axes at once the rotation is approximate.

**Before running:** select one animated null (all of its direct children are taken), or the
null plus the children you want. Alt+click the button to remove the expressions and sliders.

#### 🧲 MoGraph effector

`MoGraph_effector.jsx`

A Plain Effector in the spirit of Cinema 4D's MoGraph. The selected layers become clones, and
an effector is created above them: a guide shape layer with a falloff gizmo and controls for

- Position X/Y/Z, Scale %, Rotation X/Y/Z, Opacity %;
- falloff Sphere / Box / Linear / Infinite with ramp easing: Linear, Smooth, and S-curves of
  different steepness biased towards the edge or the center;
- Delay Off / Blend / Spring: lag and spring on the clone's whole motion — its own keyframes,
  its parent's motion and the effector's push. The delay is the same for all clones; falloff
  doesn't affect it.

Each clone gets an **MG Weight** (0–100) computed from its rest position. The offset goes
through the Anchor Point, so the clone's Position and keyframes stay untouched.

The selection decides what happens:

- layers → a new effector with them as clones;
- effector + layers → the layers are added to it;
- effector alone → it is upgraded to the current version (new controls, clone expressions);
- Alt+click → the selected clones are released; if an effector is selected, all of its clones
  are released and the effector is deleted.

#### 🔤 MoGraph text effector

`MoGraph_text_effector.jsx`

The same effector for a text layer. The clones are characters, words or lines, chosen in the
**Clone** menu on the effector and switchable live. The controls are the same as for the layer
effector. Three text animators with Expression Selectors are added to the layer; the source
text is untouched. The glyph layout is measured and baked when you run the script, so after
editing the text, font or size select the effector and run it again.

**Before running:** text layer(s) → create; effector + text layers → add; effector alone →
re-measure; Alt+click → remove.

### Layers and timeline

#### ✗ Deselect parented

`Deselect_parented.js` — deselects every selected layer that has a parent, leaving only the
independent ones selected.

#### Remove gaps between layers

`uplotnit_montazh.js` — sorts the selected layers by start time and moves them so that each
one starts where the previous one ends. Select two or more layers.

#### Fit comp duration to selected layer

`Fit_comp_duration_to_selected_layer.jsx` — sets the comp duration so it ends with the selected
layers, rounded up to a whole frame. Footage with a duration (video, audio, precomps) counts up
to the end of its source, even if the layer is trimmed; stills, solids, shapes and text count
up to their out point. With several layers selected, the latest end wins. The script also tries
to zoom the timeline to fit, but AE exposes no command for that, so that part does nothing
(see [NOTES.md](NOTES.md)).

#### Layer markers → Comp markers

`Layer_markers_2_Comp_markers.jsx` — copies the markers of the selected layer to the comp's
marker track at the same times, with comments, chapters and URLs. Select exactly one layer.

### Project and footage

#### InOut GAPЫ selected footages

`InOut_GAPS_select_footages.js` — lays the footage selected in the Project panel out on one
timeline by **source start timecode**. Each clip is wrapped in its own comp (`WRP__<name>`), the
wrappers are placed in `SEQUENCE_byStartTC` at their timecode, and the gaps are filled: up to
30 s with a black solid named after the gap length, longer ones with a 5-second red solid
carrying a marker with the gap length. Everything goes into the `_WRAPPED_byStartTC` folder;
a report at the end says which timecode field was read. Select two or more footage items.

#### Comp per video layer

`precom_each_layer.js` — for the comp selected in the Project panel, creates a separate comp
for every video footage layer: footage-sized, as long as the layer's visible part, with the
footage offset so that exactly that part plays. The new comps go into a folder named after the
source comp, which itself is not changed. Select exactly one comp in the Project panel.

#### Paste image from clipboard

`paste_image_from_clipboard.jsx` — saves the image on the clipboard to
`<project folder>/imgs_pasted/pasted_<timestamp>.png` and imports it into the `imgs_pasted`
bin. Windows only (it runs PowerShell). The project must be saved, and *Allow Scripts to Write
Files and Access Network* must be on (*Edit → Preferences → Scripting & Expressions*).

#### Rename Panel (open)

`Rename_Panel.jsx` — a palette of rename tools: add the parent folder's name to comps as a
suffix, Find / Replace, and truncate after the first match — with a scope (selection, selected
folder, whole project) and a comps-only filter.

### Shapes

#### Reset shape Scale → 100%

`Reset_shape_layer_scale.jsx` — resets the Scale of shape layers, and of every group inside
them, to 100% by baking it into the geometry: paths, Size and Position of rectangles, ellipses
and stars, stroke width and dashes, Round Corners radius, gradient points, nested group
transforms and Repeaters. The layer looks exactly the same afterwards. Uniform static Scale is
baked exactly; non-uniform Scale comes with a warning, and animated Scale is left as it is.

## Installation

1. Get the files: `git clone https://github.com/Paradoximus/ae-small-scripts.git`, or
   *Code → Download ZIP*.
2. Put `Small_Scripts_Panel.jsx` into the *ScriptUI Panels* folder of every After Effects
   version you use:
   - Windows: `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
   - macOS: `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`

   A symbolic link is better than a copy: the panel then updates with `git pull`. On Windows,
   in PowerShell run as administrator (or with Developer Mode on):

   ```powershell
   $src = "D:\path\to\ae-small-scripts\Small_Scripts_Panel.jsx"   # your clone
   Get-ChildItem "C:\Program Files\Adobe" -Directory -Filter "Adobe After Effects*" | ForEach-Object {
       $dir = Join-Path $_.FullName "Support Files\Scripts\ScriptUI Panels"
       if (Test-Path $dir) {
           $dest = Join-Path $dir "Small_Scripts_Panel.jsx"
           if (Test-Path $dest) { Remove-Item $dest -Force }
           New-Item -ItemType SymbolicLink -Path $dest -Target $src | Out-Null
           "linked: $dest"
       }
   }
   ```

3. Restart AE, open *Window → Small_Scripts_Panel.jsx* and dock it.
4. On first launch the panel reports that the folder isn't found («Папка не найдена»).
   Click **Folder…** and pick the cloned folder. The choice is remembered, separately for each
   AE version.

## Adding your own scripts

Drop a `.jsx` or `.js` file into the folder and press **Reload**. Start it with a header block —
the panel builds the button from it:

```js
/* @ae-script
name:  Button label
desc:  What the script does. Shown in the tooltip.
prep:  |
  - what to select
  - what to open
tags:  layers, timeline
*/

(function () {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) { alert("Open a composition."); return; }
    app.beginUndoGroup("My action");
    // ...
    app.endUndoGroup();
})();
```

- The block comes first in the file; only the first 8 KB are read.
- Keys: `name`, `desc`, `prep`, `tags`. A multi-line value starts with `key: |` and continues
  on lines indented by at least two spaces.
- Full spec (Russian): [README_convention.md](README_convention.md).

## Development

There is no build step: the scripts are plain ExtendScript (ES3) and run as they are.

- `_dev/ae_stub_*.js` — Node stubs of the AE DOM for the non-trivial scripts, e.g.
  `node _dev/ae_stub_pin2d_scale.js`. They walk the script's branches and check the syntax of
  every expression it writes. The MoGraph, Blend parent and Pin 2D + Scale stubs also run the
  generated expressions on a model of AE's layer transforms (and camera, for the pin) and
  compare the results with the expected math. Behavior inside AE itself still has to be checked
  in AE.
- `_dev/hook_check.js` — syntax and header check: `node _dev/hook_check.js --file <path>`.
  It also works as a Claude Code PostToolUse hook (it reads the hook's JSON from stdin).
- [NOTES.md](NOTES.md) — development notes (Russian): the math behind the expressions, rejected
  approaches, AE scripting pitfalls.
- [CLAUDE.md](CLAUDE.md) — conventions and known pitfalls that Claude Code loads into every
  session (Russian).

The stubs need Node.js and nothing else: no npm dependencies.

## Compatibility

Written and used on Windows in After Effects 2025, 2026 and Beta. macOS is untested, and
*Paste image from clipboard* is Windows-only. Expressions target the default JavaScript
expression engine.

## License

[MIT](LICENSE)
