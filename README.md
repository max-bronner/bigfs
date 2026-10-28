# bigFS

Browse and edit the BIG archives of the SAGE-engine games (*The Battle for
Middle-earth*, *The Battle for Middle-earth II*, *The Rise of the
Witch-king*, *Command & Conquer: Generals*) directly in VS Code, with
language support for their INI dialect.

bigFS ships no game content. Open a folder holding your own installation or
your mod's archives.

## Features

**Archives**

- **BIG Archives view** in the explorer: every `.big` file in the workspace,
  browsable as folders.
- **Edit in place:** open, save, create, rename, move, copy, delete and drag
  and drop files inside an archive. A save rewrites the archive through a
  temporary file and keeps names, duplicates and the header layout as the
  game shipped them.
- **new** **Copy and move between archives:** cut, copy and paste, or drag,
  files and folders from one archive into another writable one (a loose
  folder dragged in from the Explorer works too). Names the target already
  holds ask to replace, skip or keep both, and the target is saved once.
  Copying out of the read-only base game is allowed; moving out of it copies.
- **new** **Find Game Installs:** with `bigfs.baseGameFolder` unset, a quick
  pick offers the BFME, BFME II and ROTWK installs found through the
  registry (`reg query`), the usual Program Files, EA app and Origin
  folders, and Wine, Proton and CrossOver prefixes on Linux and macOS.
  Nothing is written until you pick one; **BIG: Find Game Installs** asks
  again later. The folders are only read.
- **Extract** files, folders or whole archives, and **add** files from disk.
- **Pack into BIG Archive** on any folder in the Explorer.
- **Launch Game with Mod** starts the game with `-mod "<folder>"` on a folder
  or the workspace, saving open files first; a **Run mod** button sits in
  the status bar once the game is set (`bigfs.game.executable`, extra
  arguments in `bigfs.game.arguments`).
- **Override in Folder** copies archive files into a mod folder at the same
  path.
- **Search in BIG Archives** finds text inside every archive.
- **Load order** follows the game: a loose file beats every archive of its
  install, archives go by their path below it (`___a.big` before `b.big`, the
  first holding a file wins), and installs are layered by the marker file in
  their folder: a mod, then ROTWK (`lotrbfme2ep1.exe`), then BFME II
  (`lotrbfme2.exe`). `bigfs.baseGameFolder` (with `bigfs.underlyingGameFolder`
  beneath it, found from the registry on Windows when empty) is the lowest
  layer, so a mod-only workspace still resolves the base game's files. Folders
  of one kind, such as two mods, keep their workspace folder order.
- **Compare with Base Game** lists what the workspace adds and changes
  against an untouched install (`bigfs.baseGameFolder`), each side after
  the game's load order, with a diff for every changed text file, and
  for a changed INI file what it changes definition by definition: those
  it adds and drops, and in each the values it changes, named by where
  they sit (`Body[ModuleTag_Body]/MaxHealth 200 → 220`).
- **Package Mod…** packs the mod folder into one archive after a report:
  against the base game, which files it overrides, which are new, and which
  a base archive would keep because it sorts before the archive's name (in
  the game folder the first archive by name wins; with `-mod` the mod always
  does), plus the INI errors found by checking the folder's files. Hidden files and archives
  are left out.
- **Check Translations** compares the workspace's string tables language by
  language (from `lang/german/…`-style paths, else a `.csf` header) and
  lists the labels each lacks; for a `.str` table it can add them with
  another language's text standing in until they are translated.
- **Game view** (`bigfs.explorer.view`): one merged tree of only the files the
  game loads, after its own priority rules, beside the default per-archive
  view.

**INI language support** for `.ini`, `.inc` and `.bhav`

- Structure from the games' own field tables (via [mint](https://github.com/max-bronner/mint2)),
  for Rise of the Witch-king or BFME II (`bigfs.ini.game`).
- Problems panel: unknown fields and modules, unclosed blocks, stray `End`,
  missing includes. **BIG: Validate INI Files** checks the whole workspace.
- Highlighting, outline, folding, completion, hover with engine types and the
  game's own text for string labels, go to definition, find references and
  rename across archives and loose mod folders, `#include` links and
  `#define` macros.
- Quick fixes: add a missing `End`, remove a stray one, and correct a
  misspelt keyword or name to the close ones the game knows.
- **Format Document** re-indents from the block structure, touching only
  whitespace; embedded scripts stay as written, and formatting again never
  changes the result.
- Hovering a `MappedImage` name shows the image, cut from its texture.
- Lua in `BeginScript` regions is checked for syntax errors.
- **Duplicate Definition…** (refactor menu, editor context menu) copies the
  definition at the cursor under a new name, renaming the game-text labels
  that carry the old name and copying their text into the string table.
- Hovering a CommandSet name shows its buttons in slot order, each with its
  icon, its label in game text, its hotkey and its command; undefined buttons
  are marked. Slots whose buttons share a hotkey are reported as problems,
  unless they are never on the command bar together: a purchase button and
  the ability it unlocks (`NEED_UPGRADE` on an upgrade or science it buys).
- Audio events get a **▶ Play** lens that plays one of their sounds, as the
  game picks one; hovering a sound or an event name gives play links.
- **new** The object preview lists every `Voice*` and `Sound*` field of the
  object, inherited ones included, each with its own **▶** button; the
  preview stays muted otherwise.
- Game-text labels such as `OBJECT:Name` that no string table defines are
  reported, with a quick fix that adds the record to the table the file
  already uses (`bigfs.ini.checkStrings`).
- **Find Unused Definitions** lists, in the Problems panel, every weapon,
  armor, FX list, particle system, locomotor, command button and similar
  definition in the mod's own files that no INI file references. Kinds that
  maps, scripts or the engine name (objects, upgrades, sciences, special
  powers, command sets, player templates, sounds, announcer events, images,
  GameData) are never listed, nor is anything under `bigfs.baseGameFolder`.
- **New Unit, Hero or Building…** makes a new object from an existing one:
  inherit (`ChildObject`) or copy, its own display name, and a copy of the
  button that builds the original, added to the next free slot of that
  command set. The new game text goes into the string table the original's
  comes from; what lives inside an archive is listed to do by hand.
- **Edit slots** lens on every `CommandSet`: its buttons in their slots as
  the player sees them, with icon, game text and hotkey, clashes marked.
  Drag a button to another slot (it swaps with what is there), clear a
  slot, or add a button to an empty one; the set's slot lines are written
  again in order.
- **Armor Table** shows every armor against every damage type any of them
  names, in one grid: resists tinted green, weaknesses red, a type an armor
  does not write shown greyed from its `DEFAULT`. Typing in a cell writes
  that armor's line, or adds it.
- **Bulk Edit INI Values…** changes many values by one formula: pick blocks
  (`Object *Archer*`), conditions (`Side = Rohan; KindOf ~ INFANTRY`), a
  field (`ActiveBody/MaxHealth`) and a formula of `x` and the block's own
  fields (`round(x * 1.1)`). Every change opens in the refactor preview as a
  diff to review and untick before applying. Loose INI files only. A value
  written as a `#define` macro, in an `#include`d file or inherited by a
  `ChildObject` from its parent is edited where it is defined (the preview
  says so); one that cannot be, such as an `#ADD` call, is reported.
- **Effective definition** lens on every `ChildObject` and `ObjectReskin`:
  the object as the game composes it from its parents, each line marked
  with where it comes from and what it replaced (fields override, modules
  by tag, `RemoveModule`/`ReplaceModule`, a new `WeaponSet` or `ArmorSet`
  clearing the inherited ones). It follows edits to the files involved.
- **Show Call Hierarchy** (Shift+Alt+H) on a definition shows what it uses,
  down through weapons, FX lists and particle systems, and what uses it.
  **Show Type Hierarchy** follows ChildObject and ObjectReskin parents and
  children.
- Models, animations, textures and sounds named in INI files are checked
  against every archive and folder once `bigfs.baseGameFolder` is set (until
  then the check stays off and says so once); a missing one is reported with the
  nearest existing names as quick fixes, in the editor and in **Validate INI
  Files** (`bigfs.ini.checkAssets`).

**Bone animations**

- **Edit W3D Animation…** on a `.w3d` file, in an archive or a folder:
  retime it to another number of frames, reverse it, play it along an
  easing curve, keep a range of its frames, or change its rate. The result
  is written beside it as a new animation file, named as the game finds it,
  for an INI line to switch to by name.

**Particle preview**

- A **Preview** lens on every `FXParticleSystem`, `ParticleSystem` and
  `FXList` block opens a live 3D preview with the system's textures: orbit,
  pan and zoom, play, pause, step, restart, speed from 0.1× to 4×, a moving
  emitter, the emission volume drawn as a wireframe with handles: drag them
  to size a sphere, cylinder or box, or move a line's ends.
- Every number in the block gets a slider. Sliders change the preview only;
  **Apply to INI** writes them back as one undoable edit, **Reset** drops
  them. Typing in the block updates the preview as well.
- **Scale** makes a whole effect bigger or longer and keeps it the same
  effect: size × scales every length and speed, time × stretches every
  duration and key and slows the rates to match (speeds ÷ k, gravity ÷ k²,
  damping d^(1/k)). Previewed like the sliders until applied.
- **On a model…** shows the effect on any W3D model of the workspace or
  its archives, drawn shaded, started at a bone you pick in its bind pose,
  the way a unit carries an effect on a bone.
- **A/B** (`B`) flips the preview between the block as written and with the
  values being tried; **Vary ±** nudges every value by up to a percentage
  to try variations; **Save as variant…** writes the values as a new system
  after this one, which keeps its own.
- **Over lifetime** curves for a system: colour keys as a gradient, alpha
  keys as a min-max band, size as the game grows it. Drag keys along and up
  or down, pick a key's colour, add and remove keys (written at once,
  renumbered), and drag the end of a size curve to set the `SizeRate` that
  reaches it.
- **New Particle System from Template…** (editor context menu) inserts a
  working system to start from: fire, smoke, sparks, dust cloud, magic glow
  or flash, with its name and texture as tab stops.
- An FX list's preview has a **Timeline**: a bar per nugget from its
  `InitialDelay` for as long as it emits and its particles live, lit while
  it runs, with the playhead. Click a name to mute it, shift-click to play
  it alone, drag a bar to move its delay. `Sound` nuggets get a play button
  (nothing plays unless asked). The other nuggets are listed with their
  delay and key fields: `LightPulse` is approximated as a screen flash,
  `ViewShake` and `CameraShakerVolume` as a camera shake, `TerrainScorch` as
  a ring on the ground, and `FXListAtBonePos`, `BuffNugget`,
  `AttachedModel`, `DynamicDecal` and the rest are labelled only, as in
  mint's FX viewer. The approximations show when and roughly how big, not
  the game's own look.
- **Load**: live particles and systems now, at peak and on average, per
  system, how much of the view the billboards cover, and the peak against
  each `MaxParticleCount` the mod's `StaticGameLOD` blocks allow.
- Slave systems, per-particle attached systems, terrain-collision events and
  an FX list's `ParticleSystem` nuggets (offset, count, delay) play along.
- The simulation follows the Generals engine's rules as BFME keeps them, at
  30 frames a second; where the game's rule is not settled (wind strength,
  hollow boxes) the reading is a switch, with `W` and `H` as hotkeys.
  Model (`DRAWABLE`) particles are drawn as markers and streaks as sprites.

**Balance sheet**

- **BIG: Open Balance Sheet** lists every unit and building with its side,
  cost, build time, command points, health, vision, speed, armor and
  primary weapon's damage, range and delay, read across all INI files.
- Sort by any column, filter by name, weapon, armor or side.
- Double-click a value to change it where it is written; a child's
  inherited value is shown in italics and edited at its parent, and a
  weapon value notes how many templates share it.
- A **Damage/s** column works out the primary weapon's damage a second
  (`Damage × 1000 / DelayBetweenShots`), to sort units by it.

**String tables**

- `.str` files get their own language: highlighting, an outline of labels,
  folding, and problems for duplicate labels, missing `END` and unclosed
  quotes. They are read as Windows-1252, as the game reads them.
- **Open as Table** edits a `.str` as a filterable table; only the records
  you change are rewritten.
- `.csf` files open as the same table and save back byte for byte.
- **Convert String Table** turns a `.str` into a `.csf` and back.

**Create-a-Hero files** (`.cah`)

- **new** `MyHero_<id>.cah` files, loose or inside a BIG archive, open in a
  form showing the hero's name, id, class and subclass, the three colours, the
  15 power slots, the bling and upgrade choices, and the attribute points
  spent. Class, subclass, bling, power and special-power names resolve through
  the `CreateAHeroSystem`, `Upgrade`, `CommandButton` and `SpecialPower`
  definitions and the string labels of the chosen game language; whatever does
  not resolve is shown as stored.
- **new** Name, id, class, subclass, colours, powers and bling are editable
  with undo and redo. Saving recomputes the CRC-32 trailer exactly as mint's
  `mint-sage-cah` does (the game drops a hero whose checksum is wrong) and
  writes record version 8. Files from a game install are read-only; use Save As.

**Window layouts** (`.wnd`)

- Highlighting, outline of windows, folding, completion of keys, window
  types and status and style flags, and every structural problem at once.
- **Show Layout Preview** draws the windows at their creation resolution
  beside the text, live; click a window to jump to it.

**Maps** (`.map`, `.bse`)

- The terrain as a shaded relief with objects, waypoints, start positions
  and the playable area; click an object to select it.
- Size, border, playable area, height range, players and every chunk at a
  glance.
- Edit the world info (name, description, weather...), the time of day and
  each time of day's sun (ambient, colour, direction), each player's and
  team's settings, and every object's template, position, angle and
  properties.
- The map's scripts per player, with their conditions and actions, each
  switchable on or off; trigger areas drawn on the terrain. Compressed maps are saved compressed again; nothing an edit
  does not touch changes.
- **new** A **▶** button after every script parameter that names a sound or
  music track (`PLAY_SOUND_EFFECT`, `SPEECH_PLAY`, `AUDIO_PUSH_MUSIC`, ...)
  plays it through the INI audio events of the workspace. Nothing plays
  unless clicked.

**Previews**

- Textures: TGA and DDS (DXT1/3/5, uncompressed), with zoom, channels and mip
  levels. **Export as PNG**, **Replace with PNG…** (written back in the
  texture's own format, mipmaps included) and **Convert to Game Texture…**
  for PNGs (TGA 24/32-bit, DDS DXT1/3/5 or uncompressed).
- Sounds: WAV, including IMA ADPCM, and MP3.
- Videos: EA's VP6 movies (`.vp6`), decoded frame by frame with play,
  pause and seeking; alpha movies show over a checkerboard.
- **Convert to VP6 Movie…** on a video, an image or a folder of numbered
  PNG/TGA/DDS frames writes an EA VP6 movie the games play: size, frame rate
  and quality are asked for, transparency is kept as an alpha stream, and the
  result is decoded again before it is saved. Frames between key frames
  (`bigfs.vp6.keyFrameSeconds`) are coded as changes from the one before,
  with motion search, and each frame sends the probabilities it needs. Any video FFmpeg reads works
  when FFmpeg is installed (`bigfs.ffmpegPath`); without it, WebM and Ogg.
- Models: W3D in 3D, with their skeleton and textures found in any archive.
  Animations of the skeleton are listed and play on the model (dense,
  time-coded, adaptive-delta and motion channels); a skeleton or an
  animation file on its own shows its bones. Meshes marked hidden are not
  drawn (a toggle shows them); the HLOD's levels of detail are picked from a
  dropdown with their max screen size, one drawn at a time, and its aggregate
  and proxy lists are shown; collision boxes can be drawn as wireframes.

**Interface movies (APT)**

- Every character drawn with its shapes, textures and text; sprites play
  frame by frame.
- Edit text fields, colours, bounds, exports, imports, placements, frame
  labels and frames, add frames, duplicate characters and create new text,
  sprite, shape and image characters, with undo.
- Create whole new movies (**New APT Movie…** on a folder): an `.apt`,
  `.const` and `.dat` with exported empty sprites, ready for a root movie to
  import with **Add import** in its movie panel.
- Text fields written as `$KEY` show the game's text: `APT:key` is tried,
  then `key`, and a key neither has shows `MISSING: 'APT:key'` as the game
  does; a trailing `&dropShadow` is style and not shown. A movie's own
  `.const` and `.dat` are read from its own archive first, whatever their
  casing there, and imports resolve in the game's load order (mod, ROTWK,
  BFME II).
- Movies a script loads (`loadMovie`, `loadMovieNum`, `unloadMovie`,
  `getURL` to a clip or level) are found in the game's load order like an
  import (`.apt` and `.const`) and play inside the target clip or level; one
  that cannot be found or read is a line in the log. Sounds a movie asks for
  (`FSCommand:PlaySound`) are listed in the Engine panel with a play button;
  the **Play movie sounds** checkbox, off at every start, lets them play as
  the movie asks.
- ActionScript as a small JavaScript-like language, editable and compiled
  back to bytecode; see [docs/apt-scripts.md](docs/apt-scripts.md). A script
  is only offered once compiling it is checked to give back the same code,
  and blocks you do not change keep their bytes as shipped.
- A timeline panel under the stage: depths by frames, with labels and
  scripts marked. Select a range of frames, at one depth or all, and set it
  once instead of frame by frame: a tween to an end pose with an easing, a
  formula per property (`x0 + 120*t`, `y0 - 40*sin(t*pi)`), fade out,
  remove or show, and insert, delete, duplicate, reverse or retime frames.
  Frames the change leaves alone keep their records as shipped. Onion skin
  (**N**) draws the frames either side faintly.
- **Script…** writes the timeline as a few lines, like a CSS animation, and
  bakes them into frames: `depth 3, frames 0-20: x 0 -> 120 easeOut;
  alpha 1 -> 0`, `y = y0 - 40 * sin(t * pi)`, `fade`, `hide`, `show`,
  `retime 20`. It starts as the tweens found in the movie, runs as one
  undoable edit, and names the line that is wrong.
- **Copy motion** remembers how a depth moves over a range, relative to its
  first frame; **Paste motion** plays it on another depth or range from
  that one's own pose, and **Paste ↔ / ↕** mirrors it.
- The preview runs the movie's ActionScript on a small AVM (ported from
  mint's player): frame, button and clip-event scripts with variables,
  conditions, functions and the MovieClip methods. **Ignore action
  scripts** (S) plays every frame in order instead; **Play from…** starts
  at a label.
- The **Engine** panel is the game's side of the movie: what its code
  reaches for while it runs, found as it runs. Functions only the engine
  calls (the palantir's `SetPlayerFaction`) get a field per argument and a
  **Call** button; every variable it reads, and its `GetExtern` keys, can
  be overridden, winning over what the movie holds; calls into the engine
  (`GameCode`, `FSCommand:`) are counted with their arguments and can be
  given a return value. Overrides are kept per movie.
- Tweens already baked into a movie are recognised: a run of frames in
  which an instance follows one easing curve shows as a purple bar, its
  tooltip saying what moves from where to where, and a double-click opens
  it in the tween form with its easing, to change it as one tween.

## Game language

A game's languages are the `lang/<Language>.big` archives of its install
(`English.big`, ...); the `*Audio.big` ones hold speech and are ignored. Each
holds its own string table. **bigFS: Choose Game Language** picks which one
labels resolve against, and the `bigfs.language` setting (default `auto`)
names it directly. With `auto`, the only installed language is used; when
several are installed, bigFS asks once and remembers the answer for the
workspace. The language applies to INI `DisplayName` hovers, APT `$KEY` text
and the WND preview's text.

## Development

    npm install
    npm run compile
    npm test          # unit tests, then the VS Code integration suite

Tests build their own archives in code; no game file is ever committed.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
