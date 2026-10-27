# What to test

Everything `dev/next` adds over `master`: about a hundred PRs, from the
archive core to the object preview. Each section lists where to find a
feature and what to look for, so it can be ticked off against a real
install. Items marked **new** came in the latest round (PRs #83–#92) and
have only been checked with synthetic files so far.

Nothing here has been checked in the game itself. Anything that writes game
files (W3D animations, APT movies, maps, VP6, textures, string tables)
deserves one load in the game as well.

## Setup

- Install the `.vsix` from the latest CI run of `dev/next`, or run
  `npm install && npm run compile` and launch the extension host.
- Open a folder with the game's archives, or with a mod and its archives.
- Settings worth setting first:

| Setting | For |
| --- | --- |
| `bigfs.ini.game` | `rotwk` (default), `bfme2` or `bfme1`: the INI grammar checks follow |
| `bigfs.baseGameFolder` | An untouched install, for Compare with Base Game and Package Mod |
| `bigfs.game.executable`, `bigfs.game.arguments` | Launch Game with Mod |
| `bigfs.explorer.view` | `archives` (default) or `game`, the merged view |
| `bigfs.ini.checkReferences`, `checkAssets`, `checkStrings` | `auto` checks only once the base game is indexed; `on` or `off` force it |
| `bigfs.ffmpegPath`, `bigfs.vp6.keyFrameSeconds` | Convert to VP6 Movie |

## Archives

- [ ] **BIG Archives** view in the explorer lists every `.big`, browsable as
  folders, and reads an archive only when opened.
- [ ] Edit in place: new file and folder, rename (F2), delete (Del), cut,
  copy and paste (Ctrl+X/C/V), duplicate, drag and drop, copy path. Saving
  keeps names, duplicates, header and trailer as shipped; the game still
  loads the archive.
- [ ] **Extract…** a file, a folder and a whole archive; **Add Files…** from
  disk. A name that would escape the target folder is refused.
- [ ] **Pack into BIG Archive…** on a folder in the Explorer.
- [ ] **Override in Folder…** copies an archive file into a mod folder at
  the same path.
- [ ] **Search in BIG Archives…** finds text inside every archive.
- [ ] **Show What the Game Loads** / **Show Every Archive**: the merged view
  shows only the file that wins for each path.
- [ ] An archive written while open, or into a folder created a moment
  before, is still found (fixes #64, #67, #73).

## Mod workflow

- [ ] **Launch Game with Mod** on a folder: starts the game with `-mod`,
  saving open files first; the **Run mod** status bar button appears once
  the executable is set.
- [ ] **Compare with Base Game**: added, changed and unchanged files, a diff
  per changed text file, and for an INI file the changes definition by
  definition (`Body[ModuleTag_Body]/MaxHealth 200 → 220`).
- [ ] **Package Mod…**: the report lists overridden, new and shadowed files
  and open INI errors, then packs one archive without hidden files.
- [ ] **Check Translations**: the labels each language lacks; for a `.str`,
  adding them with another language's text standing in.

## INI language

Open any `.ini`, `.inc` or `.bhav`.

- [ ] Highlighting, outline, folding, completion, hover with engine types
  and game text, go to definition, find references, rename across archives
  and loose folders, `#include` links, `#define` macros.
- [ ] Problems: unknown fields and modules, unclosed blocks, stray `End`,
  missing includes, undefined references, missing game text, missing
  models, animations, textures and sounds (with nearest-name quick fixes).
  **Validate INI Files** checks the whole workspace.
- [ ] Quick fixes: add a missing `End`, remove a stray one, fix a misspelt
  keyword or name, add a missing game-text record.
- [ ] **Format Document** re-indents and touches only whitespace.
- [ ] Hover a `MappedImage` name: the image cut from its texture.
- [ ] Lua in `BeginScript` regions reports syntax errors.
- [ ] Hover a CommandSet name: its buttons with icons, labels, hotkeys;
  hotkey clashes are problems.
- [ ] Audio events: **▶ Play** lens, play links on hover.
- [ ] **Show Call Hierarchy** (Shift+Alt+H) and **Show Type Hierarchy** on a
  definition.
- [ ] **Find Unused Definitions** / **Clear Unused Definitions**.
- [ ] **Duplicate Definition…** (context menu): new name, game text copied.
- [ ] **New Unit, Hero or Building…**: inherit or copy, display name, build
  button in the next free slot, text in the original's string table.
- [ ] **Bulk Edit INI Values…**: blocks, conditions, a field and a formula
  (`round(x * 1.1)`), reviewed as a diff in the refactor preview.
- [ ] **Effective definition** lens on `ChildObject` / `ObjectReskin`: the
  composed object, each line marked with its source; follows edits.
- [ ] **Edit slots** lens on a `CommandSet`: drag buttons between slots,
  clear, add; the slot lines are rewritten in order.
- [ ] **Armor Table**: every armor against every damage type, typing in a
  cell writes the line.
- [ ] **Open Balance Sheet**: sort, filter, double-click to edit at the
  source (inherited values in italics), **Damage/s** column.
- [ ] **new** In `fxlist.ini`, the `Name` of a `ParticleSystem` nugget goes
  to its particle system (F12), finds references, and an unknown name is
  reported; the same for a `Sound` nugget's audio event (#83).
- [ ] **new** Model, animation and texture names are links (Ctrl+click) that
  open the file in its viewer, wherever it lives (#88).
- [ ] **new** Validate retail INI (BFME II or Rise of the Witch-king) and
  compare the count of problems with before: the shipped data should now
  come out nearly clean. Spot-check that `AddEmotion = Name` lines in an
  `EmotionTrackerUpdate` no longer cascade, `End  StateName = Sword` closes
  its block, `StanceTemplate`, `StrategicHUD`, `LODPreset`, `BenchProfile`,
  `OptionGroup` and `WebpageURL` raise nothing, regions in a
  `RegionCampain` `.inc` are accepted, and each `ParticleSystem` block in
  `particlesystem.ini` shows one information note instead of a warning per
  line (until the diagnostics file maps the new `hint` severity it reads as a
  warning). A misspelt field in a known block must still be reported.

## Object preview (new, #87)

In an object's INI, for example Aragorn's:

- [ ] **▶ Preview object** over `Object` / `ChildObject` / `ObjectReskin`:
  the default model, the idle animation playing, the default state's bone
  particle systems on. Other FX are listed, switched off.
- [ ] **▶ Preview state** over a `ModelConditionState`, `AnimationState`,
  `IdleAnimationState` and others: that state's model and first animation;
  an animation state keeps its model state's bone systems.
- [ ] Lightbulb **Preview on the object** on an `AnimationName` line (plays
  that animation), an FX line (runs that FX on the model) and a
  `ParticleSysBone` line (that system on its bone, following the bone as
  the model animates). Also in the editor context menu and as **Preview
  Object Here**.
- [ ] Toggles for Model, Bones (off by default) and every effect; the State
  and Animation pickers switch what is shown.
- [ ] A `ChildObject` shows what it inherits.
- [ ] Previewing the same FX from `fxlist.ini` shows no model.
- [ ] **new** A **Voices** list under the toggles shows every sound field of
  the object (`VoiceSelect`, `VoiceMove`, `VoiceAttack`, `Sound*`, ...),
  inherited ones included, each with a **▶** button. Opening the preview
  plays nothing; one click plays one sound (a name with several variants
  asks which). Needs the game's archives in the workspace.
- Known gap: the panel does not follow edits; reopen it after changing the
  INI.

## Particle preview

**Preview** lens on `FXParticleSystem`, `ParticleSystem` and `FXList`.

- [ ] Orbit, pan, zoom; play, pause, step, restart, speed; emitter motion;
  hotkeys Space, R, `.`, W (wind), H (hollow box), B (A/B).
- [ ] A slider per value; **Apply to INI** writes one undoable edit,
  **Reset** drops them; typing in the block updates the preview.
- [ ] Emission volume handles: drag to size a sphere, cylinder or box.
- [ ] Over-lifetime curves: drag, add and remove colour, alpha and size keys.
- [ ] **Scale** size and time; **A/B**; **Vary ±**; **Save as variant…**.
- [ ] FX list **Timeline**: mute (click), solo (shift-click), drag a delay.
- [ ] **Load**: peaks, averages, per system, fill, the mod's detail-level
  budgets.
- [ ] **New Particle System from Template…** (context menu).
- [ ] **On a model…** picks any W3D and a bone. **new**: the model is now
  drawn textured and lit, the same way as in the W3D viewer (#86).

## W3D models and animations

Open a `.w3d` from an archive or folder.

- [ ] **new** Textures sit right on models that looked wrong before (#90):
  check units, buildings, props and anything with a shader material (BFME
  II-era meshes). Fixed: V orientation, the texture and coordinates of the
  drawn pass, holes from alpha, and glows drawn solid.
- [ ] **new** Opening an animation file (`X_ATKA.w3d`) plays it on the model,
  not on bare bones (#85, #88). The model is the one an object's INI plays
  it on, else found by skeleton name; the info line says which.
- [ ] **new** Bones are off when there are meshes; **B** toggles them (#86).
- [ ] **new** "Used in" under the model lists the INI lines naming the file,
  each a link to the line (#88).
- [ ] The animation list of the skeleton plays on the model; play, pause,
  frame slider.
- [ ] **Edit W3D Animation…**: retime, reverse, ease, trim, rate, written as
  a new file. Load one in the game.

## APT movies

Open an `.apt` (with its `.const` beside it).

- [ ] Characters list, stage, details; sprites play; imports resolve across
  archives in the game's priority.
- [ ] Inspector, picking on the stage (click, double-click to go inside),
  overlays: origin (O), boxes (B), wireframe (W).
- [ ] **Interact** (I): buttons respond to the pointer.
- [ ] Editing: text, colours, bounds, exports, imports, placements, frame
  labels, frames, new characters, geometry and texture import, with undo.
- [ ] ActionScript tabs: edit, compile, add and remove scripts.
- [ ] **Check APT Movies**, **Rename APT Movie…**, **Delete APT Movie…**,
  **New APT Movie…**.
- [ ] Timeline panel: tweens, formulas, fade, remove, show, insert, delete,
  duplicate, reverse, retime; onion skin (N); recognised tweens (purple);
  **Script…**; copy and paste motion, mirrored.
- [ ] **new** Speed instead of a frame rate: 0.05× to 8× of 30 frames/s,
  `[` and `]` (#84).
- [ ] **new** Timeline **labels** row (tooltip lists who jumps there) and
  **script** row (■ stop, ▶ play, ↷ jump, ? branches); hover a jump to
  light its target, click to go there. A frame's script in the details
  lists its jumps as buttons (#89).
- [ ] **new** Action scripts are respected by default: `stop()` stops,
  `gotoAndPlay` jumps, nested clips go on playing. **Play from…** starts at
  frame 0 or a label. **Ignore action scripts** (S) plays every frame in
  order, as before (#92).
- [ ] **new** Clip masks are applied, and the canvas is sized to what they
  show. **Show masks** (M) draws everything, what a mask hides faintly, the
  masks outlined in cyan, the canvas sized to the whole animation (#91).
- [ ] **new** Scripts run in full on an ActionScript machine (ported from
  mint2): variables, conditions, loops, functions, `attachMovie`, text set
  by scripts, `_visible`/`_x`/`_alpha` and the rest. Check a menu or the
  palantir behaves as in the game once the values below are overridden
  (#94).
- [ ] **new** More of the script built-ins run as in the game (ported from
  mint2's apt-player): `attachMovie`, `duplicateMovieClip` and
  `createEmptyMovieClip` take depths from 0 (above anything the timeline
  places) and copy an initial-values object; `swapDepths`,
  `getNextHighestDepth` and `getInstanceAtDepth` agree with `getDepth`;
  `removeMovieClip` leaves clips the timeline placed alone;
  `localToGlobal`/`globalToLocal`, `hitTest` and `getBounds` use the clips'
  boxes; `Color` (`setRGB`, `getRGB`, `setTransform`, `getTransform`) tints a
  clip. Open a menu that tints or stacks clips by script and check the
  colours and stacking match the game.
- [ ] **new** Selecting characters, scrubbing and playing stay as quick
  with scripts respected as with them ignored, and nothing a script does
  breaks the editor: a script that fails or runs away is stopped and
  reported in the log under the stage, and frames whose scripts goto each
  other take turns instead of overflowing (#95).
- [ ] **new** Retail root movies boot: open MainMenu, Palantir, Options and
  LoadScreen; a root script that reads `_root` or `_level0` in its first
  frame runs, and the log under the stage shows no
  `Cannot read properties of undefined`. A first-frame `stop()` stays after
  **Interact**/**Ignore action scripts** restart the movie, and a sprite's
  init actions have run before the first frame, wherever the movie holds
  them.
- [ ] **new** **Engine** panel (top of the right side) lists what the movie
  asks of the game, found while it runs, nothing hard-coded:
  - *Called by the engine*: functions the movie defines but never names
    anywhere else (the palantir's `SetPlayerFaction`,
    `SetPalantirFrameState`); one it also calls itself is under *Other
    functions*. Type the arguments (`evil`, `2`, `true`, `"text"`) and press
    **Call**.
  - *Values*: every variable the movie read from the game's side, with what
    it held, and its `GetExtern`/`extern.` keys; those it never sets are
    marked. A function's own locals and parameters are not listed. Typing in
    a value's field overrides it: the override matches the whole path from
    the root (`side` is `_root.side`, `menu.side` is another value) and is
    written into the movie before and after every script, so `_root.side`
    and `this.side` read it even after the movie writes the name. Numbers
    may be typed as `0x74808E`, `1e3`, `NaN` or `-Infinity`. **Override**
    adds one for a path not read yet (`extern.Key` for an extern).
    **Restart with these overrides** runs the movie again with them;
    **Clear overrides** drops them, not the values calls return. Overrides
    are kept per movie; the filter narrows long lists.
  - *Extern writes*: what the movie itself writes with `extern.Key = v` or
    `ToggleExtern`, shown read-only. They are never saved as overrides;
    `GetExtern` answers your override, else the movie's write, else nothing,
    and `ToggleExtern` flips each time it runs.
  - *Calls to the engine*: `GameCode`, `FSCommand:` and functions nothing
    defines, with a count and the last arguments; each can be given a
    value to return. They are also written to the log under the stage.
- [ ] Palantir check: open `palantir.apt`, call `SetPlayerFaction` with the
  faction name the movie's labels use, and see the matching art; play with
  the values it lists.
- Known gaps: pointer events on plain clips (`onPress` on a sprite) are not
  delivered, only on buttons; `Color`, drag, `hitTest` and `localToGlobal`
  do nothing; the imported library movies' code runs, but nothing loads a
  movie a script asks for by URL.

## String tables, layouts, maps

- [ ] `.str` language (outline, folding, problems) and **Open as Table**;
  `.csf` opens as a table and saves byte for byte; **Convert String Table**.
- [ ] `.wnd`: completion, problems, **Show Layout Preview** (click a window
  to jump to it).
- [ ] Maps (`.map`, `.bse`): relief with objects, world info, time of day,
  players, teams, object properties, scripts on and off, trigger areas,
  lighting. Saved maps load in the game.
- [ ] **new** Maps, Scripts: a **▶** after the sound parameter of
  `PLAY_SOUND_EFFECT`, `PLAY_SOUND_EFFECT_AT`, `SPEECH_PLAY`,
  `MUSIC_PLAY_TRACK_FINITE_TIMES`, `AUDIO_PUSH_MUSIC` and
  `HAS_FINISHED_AUDIO` plays that event; opening the map plays nothing.

## Textures, sound, video

- [ ] TGA and DDS previews with zoom, channels, mip levels; **Export as
  PNG**, **Replace with PNG…**, **Convert to Game Texture…**.
- [ ] WAV (including IMA ADPCM) and MP3 playback.
- [ ] VP6 playback with seeking; **Convert to VP6 Movie…** from a video, an
  image or a folder of frames; the movie plays in the game.

## Where to report

A defect found here is easiest to fix with the file it happened on (its
name and archive), what was expected, and what showed.
