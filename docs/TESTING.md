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
| `bigfs.ini.checkReferences`, `checkAssets`, `checkStrings` | `auto` checks only once the base game is indexed (`checkAssets` also needs `bigfs.baseGameFolder`, else it stays off with a one-time hint); `on` or `off` force it |
| `bigfs.ffmpegPath`, `bigfs.vp6.keyFrameSeconds` | Convert to VP6 Movie |

## Archives

- [ ] **BIG Archives** view in the explorer lists every `.big`, browsable as
  folders, and reads an archive only when opened.
- [ ] Edit in place: new file and folder, rename (F2), delete (Del), cut,
  copy and paste (Ctrl+X/C/V), duplicate, drag and drop, copy path. Saving
  keeps names, duplicates, header and trailer as shipped; the game still
  loads the archive.
- [ ] **new** Copy between archives: with two writable archives, copy (or
  cut) a file and a folder in one, paste on the other archive or a folder in
  it, and drag the same. A name already there asks Replace, Skip or Keep
  Both (Keep Both adds ` copy`); Cancel (Esc) changes nothing. The target
  saves once; a cut removes the files from the source archive.
- [ ] **new** Copy a file out of a base game archive (`bigfs.baseGameFolder`)
  into a workspace archive: it works. Cut or drag it: the file stays in the
  base game and the message says Copied. Pasting into a base game archive is
  refused.
- [ ] **new** Drag a loose folder from the Explorer into an archive that
  holds some of the same files: the same Replace, Skip, Keep Both prompt.
- [ ] **new** **BIG: Find Game Installs** (and once on first start with
  `bigfs.baseGameFolder` and `bigfs.underlyingGameFolder` empty) lists the
  installs found on the machine: registry, Program Files, EA app, Origin,
  and Wine/Proton prefixes on Linux and macOS. Picking ROTWK also sets BFME II
  beneath it. Dismissing the pick changes no setting and it is not offered
  again at start.
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
  adding them with another language's text standing in. Also compares
  tables inside archives (a `.str` in a writable archive is filled and saved
  with it; a base game table is only reported, with an Override in Folder
  offer), and lists labels INI files use that no table defines. **new**

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
- [ ] **Format Document** re-indents and touches only whitespace; running it
  again changes nothing, even on a file with unknown keywords.
- [ ] Hover a `MappedImage` name: the image cut from its texture.
- [ ] Lua in `BeginScript` regions reports syntax errors.
- [ ] Hover a CommandSet name: its buttons with icons, labels, hotkeys;
  hotkey clashes are problems, except a purchase button and the ability it
  unlocks (`NEED_UPGRADE`) sharing a key. **new**
- [ ] Audio events: **▶ Play** lens, play links on hover.
- [ ] **Show Call Hierarchy** (Shift+Alt+H) and **Show Type Hierarchy** on a
  definition.
- [ ] **Find Unused Definitions** / **Clear Unused Definitions**: only the
  mod's own files, never objects, upgrades, sciences, command sets, player
  templates, sounds, EVA events or GameData; nothing from the base game
  folder. **new**
- [ ] **Duplicate Definition…** (context menu): new name, game text copied.
- [ ] **New Unit, Hero or Building…**: inherit or copy, display name, build
  button in the next free slot, text in the original's string table.
  With an original in a writable archive the object, button, slot and text
  are saved into the archive; a copy lands in `data/ini/object/<name>.ini`
  (or the original's file when that is under `data/ini/object`), never at the
  workspace root; with a base game original the new file goes to a workspace
  folder and the rest is listed. **new**
- [ ] **Bulk Edit INI Values…**: blocks, conditions, a field and a formula
  (`round(x * 1.1)`), reviewed as a diff in the refactor preview. Values from
  a `#define`, an `#include`d file or a `ChildObject`'s parent are edited
  where defined; an `#ADD` operand is reported as not editable. INI inside
  writable archives is edited too (one undoable save per archive); values in
  a base game archive are offered for Override in Folder instead. **new**
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
- [ ] **new** FX list **Timeline** rows for the other nuggets. Preview a list
  with a `LightPulse`, a `ViewShake` or `CameraShakerVolume`, a
  `TerrainScorch` and an `FXListAtBonePos`: the first three show a screen
  flash, a camera shake and a ring on the ground at their delay (they repeat
  with **Restart**, hold still when paused); the last is greyed
  "(not previewed)" with its `FX` and `BoneName`. A `Sound` row still plays
  only from its ▶ or the **Play sounds** box.
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
- [ ] **new** Meshes with the HIDDEN attribute are not drawn; **Show hidden**
  (only offered when the model has one) draws them.
- [ ] **new** A model with an HLOD draws one level of detail at a time, the
  finest first. The dropdown lists each level with its mesh count and max
  screen size; picking one redraws only that level. Under the model the
  aggregate and proxy lists are named.
- [ ] **new** **Show boxes** (only offered when the file has `BOX` chunks)
  draws the collision boxes as green wireframes; off by default. Boxes are
  drawn in the bind pose, not following an animation.
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
- [ ] **new** Gadgets (ported from mint's apt-player): in a menu with
  sliders, check boxes, lists or combo boxes, turn on **Interact** and use the
  controls over the stage; the **Gadgets** section of the Engine panel lists
  each with its `_value`, `_checked`, `_selected`/`_items`, `_text` and an
  override field, and the movie reads what you set. A clip with `_imageName`
  draws its `MappedImage` (open the game's INI so it is indexed); a name with
  no definition, and a `_type` the preview does not know, show as a labelled
  dashed box and never an error.
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
- [ ] **new** Movies a script loads play in place (ported from mint's
  apt-player `load.rs`). Open a movie whose script calls `loadMovie`,
  `loadMovieNum`, `unloadMovie` or `getURL` with a clip or level target (the
  retail in-game hero select does, into a slot of the palantir) with the
  movie's install in the workspace. The loaded movie (its `.apt` and
  `.const` found in the load order, like imports) replaces the clip's
  content and plays from frame 0; a level (`_level1`) shows above the
  movie; `unloadMovie` leaves the clip empty. The log under the stage names
  each load. A movie no install holds, or one that does not read, shows
  `loadMovie: <name> not loaded: <reason>` and nothing throws.
- [ ] **new** Movie sounds (ported from mint's apt-player/`expose.rs`). In
  the Engine panel, **Sounds the movie asks for** lists each event a
  `FSCommand:PlaySound` (or `GameCode` with a `PlaySound` command) asked
  for, with a count and a **▶ Play** button that plays it through the sound
  player. The log shows `movie sound: <event> (not played, Play movie sounds
  is off)`. Tick **Play movie sounds** and hover the menu's buttons: each
  sound plays as it is asked. The box is off every time the editor is
  opened and is not remembered.
- Known gaps: pointer events on plain clips (`onPress` on a sprite) are not
  delivered, only on buttons; `Color`, drag, `hitTest` and `localToGlobal`
  do nothing; a movie loaded into `_level0` is refused, and a mounted
  movie's own `onLoad` clip events do not run.

## Game language (new)

- [ ] **new** With one `lang/<Language>.big` installed, hover a `DisplayName =
  OBJECT:...` value: the text is that language's, and nothing is asked.
- [ ] **new** With two or more installed (and `bigfs.language` on `auto`),
  the first run shows one quick pick listing them. Reload: it does not ask
  again. `*Audio.big` archives are not listed.
- [ ] **new** **bigFS: Choose Game Language** switches the language; hovers,
  the WND preview (reopen it) and APT `$KEY` text follow. Setting
  `bigfs.language` to `German` (say) picks it without asking.
- [ ] **new** In an APT movie, a `$KEY` text field shows the string table's
  `APT:key` text (else `key`); an absent key shows `MISSING: 'APT:key'`, and
  `&dropShadow` is not shown.
- [ ] **new** Type an override in the Engine panel, close the movie and the
  window, reopen: the override is back. A different movie has its own.
- [ ] **new** A movie inside an archive opens with its `.const` and `.dat`
  from that archive even where their names differ in casing.

## String tables, layouts, maps

- [ ] `.str` language (outline, folding, problems) and **Open as Table**;
  `.csf` opens as a table and saves byte for byte; **Convert String Table**.
- [ ] **new** `.cah`: a loose `MyHero_*.cah` and one inside an archive open
  in the hero form. Name, class, subclass, colours, powers and bling show the
  game's text once the INI is indexed. Edit the name and a colour, undo and
  redo, save, and load the hero in the game: it still lists (the checksum was
  recomputed). A file from the install is read-only and Save As writes a copy.
  A truncated `.cah` fails to open with a message.
- [ ] `.wnd`: completion, problems, **Show Layout Preview** (click a window
  to jump to it).
- [ ] Maps (`.map`, `.bse`): relief with objects, world info, time of day,
  players, teams, object properties, scripts on and off, trigger areas,
  lighting. Saved maps load in the game.
- [ ] **new** Maps, Scripts: a **▶** after the sound parameter of
  `PLAY_SOUND_EFFECT`, `PLAY_SOUND_EFFECT_AT`, `SPEECH_PLAY`,
  `MUSIC_PLAY_TRACK_FINITE_TIMES`, `AUDIO_PUSH_MUSIC` and
  `HAS_FINISHED_AUDIO` plays that event; opening the map plays nothing.

- [ ] **new** Maps, Objects: type a template (the list is the workspace's
  `Object`, `ChildObject` and `ObjectReskin` names) and **Place object**, click
  the map: the object appears selected. Drag it, press `[` and `]`, edit
  Owner / team, Health and Name, add and remove a property with ×. Delete
  with `Delete`. Undo and redo each step; save and reopen keeps it.
- [ ] **new** Maps, Waypoints: **Place waypoint** adds one named
  `Waypoint <id>`; Alt-click from a selected waypoint to another adds an arrow,
  again removes it; the Links list and its × do the same. Deleting a waypoint
  drops its arrows. **Waypoint links** hides them.
- [ ] **new** Maps, Trigger areas: **New area**, click three points, Enter;
  select it in the list or by clicking inside it, drag a corner, rename,
  **Add point**, **Delete area**. Scripts and other chunks are unchanged.
- [ ] **new** A map opened from a base game archive shows no placing
  controls and refuses edits with a message.
- [ ] **new** `.scb`: opens in **bigFS Script File**, the script tree matches
  the map view, the **▶** buttons play, nothing can be edited.

## Textures, sound, video

- [ ] TGA and DDS previews with zoom, channels, mip levels; **Export as
  PNG**, **Replace with PNG…**, **Convert to Game Texture…**.
- [ ] WAV (including IMA ADPCM) and MP3 playback.
- [ ] VP6 playback with seeking; **Convert to VP6 Movie…** from a video, an
  image or a folder of frames; the movie plays in the game.

## Where to report

A defect found here is easiest to fix with the file it happened on (its
name and archive), what was expected, and what showed.
