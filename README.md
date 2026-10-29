# Relativity Park: Walking Near the Speed of Light

This edition adds scene-based auto exposure with circular center metering.
In Settings, **Auto exposure** is enabled by default and **Circle diameter**
starts at 20% of the shorter viewport dimension (adjustable from 5% to 100%).
The optional circle outline shows the exact metering region. Disable auto
exposure to use the original manual Exposure setting under Debug.

**HDR tone mapping** is also enabled by default. Its strength slider blends
the original display with a view that keeps the sides visible alongside the
bright center. It compresses the per-pixel relativistic lighting gain in stops,
using source radiance to preserve surface shading and texture contrast. Gain
within one stop is unchanged; larger gains roll off toward three stops. The
unmodified physical radiance still drives center-circle auto exposure. This is
an SDR-compatible visualization, and requires no HDR monitor or float render
target. Extreme recovery smoothly loses chroma toward neutral gray, preventing
vanishing spectral signals from turning into saturated bands or a red wash.
The highlight curve bounds already-white input before its polynomial to avoid
overflow during large exposure changes. Disable HDR for the original display.

**Radiation film** has a separate, explicit reference exposure model in
`js/radiation.js`; visible scene brightness never drives it. A head-on reference
field of 0.1 μGy/h is boosted by ((1 + β) / (1 - β))² (D⁴). The chosen detector
sensitivity is 2 counts/s per μGy/h. Background is about 0.2 counts/s (12 CPM).
The Background radiation switch subtracts the rest field when off, giving
exactly zero audio and zero film overlay at β = 0. Real background is enabled
by default, following the requested background-like behavior.

Film coverage is maxCoverage × level, with a default maximum of 50%. For
x = referenceDose / 0.5 Gy/s, level = 0.75x below x = 1, then
0.75 + 0.25(1 - exp(-3(x - 1))) above it. This keeps the low-dose response
linear, with a smooth first derivative into aesthetic compression only above
the extreme-exposure knee. That reference rate accumulates 10 Gy in 20 seconds.
It is a virtual calibration, not a physical dose inferred from the park, and
does not mean death occurs within 20 seconds. Sources:
[LND detector timing](https://www.lndinc.com/wp-content/uploads/2017/03/LND_71210_download.pdf),
[CDC high-dose context](https://www.cdc.gov/radiation-emergencies/hcp/clinical-guidance/ars.html).

At background levels the overlay produces occasional marks, with no grain
curtain. Clusters, tracks and fogging build with reference exposure. The raster
grain layer supplies coverage while larger marks are bounded at 1,200 particles.
The separate canvas sits below the instruments and is excluded from both
brightness meters; it does not alter relativistic geometry.

The **Incoming light** HUD averages raw, linear scene luminance over the whole
view at 2 Hz, relative to the initial view (reset with R). It uses a separate
48×48 metering pass, so center circle size, exposure, and HDR do not affect it.
**Audible intensity** produces a Poisson arrival process with a 90 μs
nonparalyzable detector recovery time. Expected detected rate is λ/(1 + λτ),
linear at low intensity and naturally saturating at high intensity. There is
no logarithmic low-dose click remapping and no 240-click cap. Pulses are packed
into 50 ms audio blocks, avoiding one AudioNode per hit at thousands of counts/s.
Each tick has the same 12 ms waveform, independent of dose. Sound is enabled
by default, starts on a user gesture, and pauses in hidden tabs. The 100%
volume ceiling uses an exponential amplitude curve over -40 to 0 dB, with
exact mute at zero; a compressor and soft limiter handle overlapping pulses.
Turning the reference rate to zero stops queued sources immediately.
The Settings plot shows forward and sideways D⁴ beaming versus speed on a
logarithmic brightness axis, independently of spectral color changes.

The meter renders a 48×48 crop of the center region at most ten times per
second. It measures log-average luminance after Doppler color and beaming,
before exposure and tone mapping, excluding pixels outside the circle. A
two-byte logarithmic encoding covers 96 stops in a standard RGBA8 target.
WebGL2 pixel-pack buffers and fences read results asynchronously. Exposure
adapts in stops with a 0.3-second time constant, including while paused.

Original simulator: https://github.com/dbrant/relativity by Dmitry Brant.

A special relativity simulator in which **c = 5 km/h**.

Just like in the real world, the speed of light is not attainable, only approachable asymptotically.
The more you speed up, the more relativistic effects will become apparent:
length contraction, time dilation, Terrell rotation, etc. The Doppler effect of light
also becomes apparent, with objects in front of you blueshifted, objects behind you
redshifted, and transverse Doppler effects visible on objects in motion.

[Live demo!](https://rivendell.dmitrybrant.com/relativity)

## Running it

No dependencies and no build step.

```
python -m http.server 8000     # then open http://localhost:8000
```

```
node tools/serve.mjs           # the same, on :8123, with caching turned off
node tools/serve.mjs --stop    # stop it, however it was started
```

Ctrl-C stops it too. `--stop` is there for when it was launched detached and the
shell that started it is gone: it finds the process by command line, which on
Windows `pkill` cannot do — that matches POSIX process names and never sees
`node.exe tools/serve.mjs 8123`. It also stands down by itself after 45 minutes
with no requests, so a forgotten instance does not sit on the port.

Either works. The node one sends `cache-control: no-store`, which saves you
hard-reloading after every edit.

## The computation

Each vertex is asked one question: light arriving at my eye right now, from this
piece of the world — where did it come from, and what happened on the way?

1. Walk back down the past light cone to find when the light
   left. For static scenery that is `distance / c`. For the moving props it means
   solving `g(a) = a − |p(t − a) − eye| / c = 0`, and doing it carefully:
   `g'(a) = 1 + (v·n̂)/c` never reaches zero while `|v| < c`, but it gets to 0.14
   at the corners of a carousel car, which travel at 0.857c. Plain Newton then
   flings the iterate most of the way around the orbit, and since every vertex
   solves independently, neighbours land on different revolutions and tear
   triangles across the scene. Every point of a mover stays within a known radius
   of its reference, so the delay is bracketed, `g` is monotonic, and bisection
   cannot fail; Newton is accepted only when it lands inside the bracket. 24
   iterations, worst error 0.06 px.

2. The boost: take the null 4-vector from that emission event to the eye and
   Lorentz-transform it into the observer's instantaneous rest frame. Everything
   visual falls out of this single step — aberration, Lorentz contraction, and
   Terrell rotation, which is not really a rotation at all but what light delay
   does to an already-contracted object.

3. The boost rescales the null vector, and that ratio is the Doppler factor `D = γ(1 + β·r̂)`.

Color: Each surface color is modelled as a spectral reflectance — a Gaussian lobe over a broad neutral floor —
lit by a 5800 K solar illuminant, shifted by `D`, and re-integrated against the
CIE 1931 color matching functions (Wyman–Sloan–Shirley analytic fits). Because
that whole chain is linear in the three primary weights, the effect at any `D`
collapses to one 3×3 matrix, tabulated over log `D` and handed to the GPU. It is
normalised so `D = 1` is exactly the identity: at rest, nothing is touched.

The rendering of extreme redshift ends in black, which is mostly accurate physically.
Blueshift, on the other hand, is necessarily less accurate: beyond violet, the color
turns into a metallic silver to represent x-rays, then to a bright white to represent
gamma rays of increasing energy.

Brightness uses the bolometric `D⁴` beaming law. Circular scene-based auto exposure,
described above, adjusts the overall exposure while preserving the brightness
gradient within the frame. Turn it off in Settings to see the raw law.

Your own motion integrates through Einstein velocity addition, so holding the key
down adds *rapidity* linearly and you approach `c` without ever arriving — the
velocity readout carries five decimals so you can watch 4.99995 km/h refuse to
become 5.

## Rendering choices

- **Everything is heavily tessellated** (~485k vertices by default). The transform
  is applied per vertex and is strongly non-linear, so straight edges will start to appear curved. A cube drawn with eight vertices would still look like a cube at 0.9c,
  which would be innaccurate.
- **The ground gets its own budget, and it moves.** It is the surface the
  transform punishes hardest — a flat plane of straight edges that the boost
  bends into curves, where the faceting error goes as the square of the angular
  step. It is a polar disc graded exponentially from 1.2 m to 4 km, tessellated
  so the quads stay square.

  The disc is not scenery, it is a tessellation carrier: its grid and mottle are
  computed from world coordinates in the fragment shader, so the mesh can slide
  along with the eye without anything visibly moving. It does exactly that, which
  keeps the finest rings underfoot however far you have walked. Anchored at the
  origin it did not — 500 m out, the spacing beneath you was 7.8 m.

- **Tessellation follows γ.** The angular magnification of aberration is exactly
  `1/D`. Forward that is a compression, so the view ahead needs *less* geometry
  than at rest; astern it is a magnification of `γ(1+β)`, and that is where
  straight edges bend hardest. So the ground steps up a ladder as you accelerate
  — 33k vertices at Low through 650k at Extreme — with two steps of headroom
  above whatever floor you set, and hysteresis on the thresholds so a wobble
  cannot thrash it. Levels are built once and kept, because rebuilding a 650k
  disc mid-acceleration is exactly when a hitch would show. All five ground
  levels are now built and uploaded during startup, yielding between builds.
  Offscreen draws warm their GPU buffers, and a nonblocking fence waits for
  completion before movement starts. Crossing a speed threshold only selects
  an already-prepared mesh.
- **Backface culling is off.** Terrell rotation shows you faces that are pointing
  away from you; culling them would delete the effect.
- **Logarithmic depth.** The apparent scene spans centimetres to tens of
  kilometres once `γ(1+β)` stretches the world ahead.
- **Real time is your proper time.** Your wristwatch ticks with the animation
  frame; the world's clock is the one that runs fast, by exactly `γ`.

## The park

| | |
|---|---|
| the colonnade | the classic corridor; aberration bends it into a tunnel |
| paired rulers | two identical 60 m red-and-white rulers, one along Z and one along X |
| the arches | closed loops, so you can watch a circle become an ellipse |
| the beacons | all flash once per second of *world* time; their apparent rate is a Doppler readout you can perceive |
| the carousel | cars contracted by their own motion, each seen at a different retarded moment |
| the shuttle | slides along X, so its contraction breathes in and out as it goes; its flanks carry a photographic decal |
| the Ferris wheel | gondolas that hang level, so each is in pure translation and its contraction axis sweeps round with the ride |
| two sculptures | STL models on plinths, flanking the colonnade |

At the Ferris wheel or at the carousel, you can see relativistic velocity addition in action. All the
cars run at 0.75 `c` and run in opposite directions on either side, but none of them
move faster than light relative to you, the observer.

The Ferris wheel's structure and its cars are specified in different frames, on purpose. Each
gondola has a rest frame, so it is given at rest and contracted along its own
motion, exactly like a carousel car. The rim does not: a rigidly rotating ring
has no global rest frame to be designed in, which is Ehrenfest's paradox, and
the material genuinely is strained in its own frame. So the rim's *worldlines*
are given directly in the world frame instead. They are subluminal and
self-consistent, which is the whole of what the renderer is entitled to ask.

## STL models

Drop an `.stl` into `objects/` (binary or ASCII) and add an entry to `MODELS` in
`js/scene.js`. Three things happen to it that a plain STL viewer would not bother
with:

- **Weld.** STL stores each triangle's corners independently, so a closed model
  arrives as loose facets. Welding by position gives an indexed mesh and lets
  facet normals be averaged into smooth shading — area-weighted, so slivers do
  not sway the average.
- **Subdivide.** The transform is per vertex and bends straight edges into
  curves, so a long edge is drawn as a chord of the curve it should be. Splitting
  is uniform 4-way through a shared midpoint cache, so neighbours split
  identically and no T-junctions open up at speed. It repeats while the longest
  edge exceeds 22 cm, under a 60k-triangle budget so a coarse model cannot run
  away. The bunny lands at 13,934 vertices, one level in.
- **Fit.** STL carries no units and no agreed up-axis. Blender writes Z-up and
  these arrive about 86 units tall, so a model is rotated to Y-up, scaled to a
  height in metres, centred, and stood on its plinth.

## Controls

On touch screens, use the three buttons along the bottom: hold **Accelerate**
to accelerate forward, **Brake** to slow to a stop, or **Reverse** to accelerate
backward (slowing forward motion first). Let go to coast. Drag the scene to
look around, including while another finger holds a movement button. Controls
release when a touch is cancelled, the app loses focus, or a drawer opens.

`W A S D` or arrow keys to accelerate · mouse cursor to look around while moving · `Space` to stop · `P` pause the world · `Q`/`E` drop and rise · `R` reset to start · `Tab` settings · `H` field guide (help).

The various relativistic effects can be turned on or off with these keys: `L` light-travel delay, `G` aberration and
contraction, `C` Doppler color, `B` relativistic beaming.

## Layout

```
index.html        page and instrument chrome
css/style.css
js/glutil.js      WebGL2 helpers
js/color.js       CIE color matching, Doppler LUT
js/geometry.js    tessellated mesh builders
js/stl.js         STL loading: weld, subdivide, auto-fit
js/shaders.js     the relativistic vertex transform
js/scene.js       the park
js/app.js         controls, dynamics, render loop
objects/          STL models and textures, fetched at load
tools/serve.mjs   dev server, no-cache
```

Requires WebGL 2.
