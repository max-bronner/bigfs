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
- **new** **Create archives and manage them:** right-click a folder (or the
  workspace row) in the view for **New Archive…**, which writes an empty BIG4
  archive and never replaces a file of that name. **Rename…** and **Delete** on
  an archive row rename it on disk and move it to the trash. Names are checked
  before anything is written: no empty, dot, Windows-reserved or
  non-Windows-1252 names, no separators in a single name, no path past 255
  characters, nothing differing from an existing name only in case. Dropped
  files and folders that break these rules are skipped with a message; an
  archive that would pass 4 GiB is refused before it is touched. Dragging
  `.big` files from outside onto a folder row copies them there.
- **Context menu and keys** on a row of the view: **New File…**, **New
  Folder…**, **Add Files…**, **Rename…** (F2), **Delete** (Del), **Cut**
  (Ctrl+X), **Copy** (Ctrl+C), **Paste** (Ctrl+V), **Duplicate**, **Copy Path**
  and **Copy Relative Path**; **Refresh** and **Search in BIG Archives…** sit
  in the view's title bar. Commands act on the row they are run from.
- **Show What the Game Loads** / **Show Every Archive** (the title bar button)
  switch the view between the merged game view and one tree per archive,
  the same as `bigfs.explorer.view`.
- **Extract** files, folders or whole archives, and **add** files from disk.
- **Pack into BIG Archive** on any folder in the Explorer.
- **Launch Game with Mod** starts the game with `-mod "<folder>"` on a folder
  or the workspace, saving open files first; a **Run mod** button sits in
  the status bar once the game is set (`bigfs.game.executable`, extra
  arguments in `bigfs.game.arguments`).
- **Override in Folder** copies archive files into a mod folder at the same
  path.
- **Search in BIG Archives** (the *Search in Archives* view under the
  archive tree, or the command, which takes the selected text as the query)
  finds text inside every archive the way VS Code's search does: results grouped
  by archive and file, each match highlighted with the lines around it
  (adjustable), toggles for case, whole word and regular expression, include
  and exclude globs on entry paths, a live count, results streaming in while
  it runs, and Cancel. A click opens the entry at the match. It reads text
  entries only (INI, STR, WND, Lua, XML and the like) and stops at 5000
  matches, saying so. VS Code's own search and Ctrl+P cannot see inside a
  `bigfs:` folder (their extension points are closed to published
  extensions), which is why this exists.
- **Go to File in Archives…** (`Ctrl+Alt+P`, `Cmd+Alt+P` on a Mac, or the
  title bar of the archive tree) is Ctrl+P for the archives: type part of a file
  name or path, with fuzzy matching that prefers the start of the name, and
  open it. Archives, loose files of every install and mod are listed from the
  index tables alone, recent files come first, and a path several archives hold
  is listed once per archive with the copy the game loads marked. The button on
  a row reveals it in the archive tree.
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
  another language's text standing in until they are translated. Tables
  inside archives are compared too (a `.str` in a writable archive is filled
  and saved with it; one in a base game archive is only reported, with
  Override in Folder offered), and the labels that INI files, loose or in
  archives, use but no table defines are listed.
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
- A lens over each `MappedImage` header, **Edit region in texture**, opens the
  texture with the block's rectangle drawn on it. Drag or resize the box, or
  type its edges, and the `Coords` line is rewritten as an undoable edit of
  the INI document.
- In a shape's `.ru` geometry file, a lens over each `s tc:` texture style
  names the image and box it samples and opens the texture with that box
  selected; dragging it rewrites only that style line.
- Lua in `BeginScript` regions is checked for syntax errors.
- **Duplicate Definition…** (refactor menu, editor context menu) copies the
  definition at the cursor under a new name, renaming the game-text labels
  that carry the old name and copying their text into the string table.
- Hovering a CommandSet name shows its buttons in slot order, each with its
  icon, its label in game text, its hotkey and its command; undefined buttons
  are marked. Slots whose buttons share a hotkey are reported as problems,
  unless they are never on the command bar together: a purchase button and
  the ability it unlocks (`NEED_UPGRADE` on an upgrade or science it buys).
- Audio events get a **▶ Play** lens that plays one of their sounds and an
  **Open file** lens; hovering a sound or an event name gives play and open
  links. Every play button in a preview (voices, FX timeline, script
  parameters, the APT Engine panel) plays in place; Ctrl+click (Cmd on macOS)
  opens the sound file instead, and a second press stops it.
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
  comes from. It works on objects inside writable archives too, and a copy is
  always written to a file the game loads (`Data\INI\Object\<name>.ini`, or
  beside the original when that is one), never to a stray file; for an
  original in a base game archive, which is never changed, the new file goes to
  a folder of the workspace and what else would need editing is listed.
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
  diff to review and untick before applying. INI files inside writable
  archives are edited as well, each archive saved once and undoable; values
  defined in base game archives are never written, and Override in Folder is
  offered for those files. A value
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
- References to a definition that nothing in the workspace defines (a
  `Weapon`, `Upgrade`, `FXList` and the like) are reported as information, so
  a real typo stays visible without alarming on names the engine tolerates
  (`bigfs.ini.checkReferences`).
- **Clear Unused Definitions** empties the list **Find Unused Definitions**
  left in the Problems panel.
- Models, animations, textures and sounds named in INI files are checked
  against every archive and folder once `bigfs.baseGameFolder` is set (until
  then the check stays off and says so once); a missing one is reported with the
  nearest existing names as quick fixes, in the editor and in **Validate INI
  Files** (`bigfs.ini.checkAssets`).

**Object preview**

- **▶ Preview object** over every `Object`, `ChildObject` and `ObjectReskin`
  (also **Preview Object Here** in the editor context menu) opens the object
  with its default model, the idle animation playing and the default state's
  bone particle systems on; other effects are listed, switched off. **▶
  Preview state** over a `ModelConditionState`, `AnimationState` and the like
  shows that state's model and first animation. A lightbulb **Preview on the
  object** on an `AnimationName`, FX or `ParticleSysBone` line plays that
  animation or effect on the model. Toggles for model, bones and every
  effect, and pickers for state and animation. A `ChildObject` shows what it
  inherits.
- **Voices** lists every sound field of the object with a **▶** button each;
  nothing plays unless clicked.
- Model, animation and texture names in an INI file are links (Ctrl+click) to
  the file in its viewer, and the W3D viewer's "Used in" list links back to
  the INI lines naming the file.

**Bone animations**

- **Edit W3D Animation…** on a `.w3d` file, in an archive or a folder:
  retime it to another number of frames, reverse it, play it along an
  easing curve, keep a range of its frames, or change its rate. The result
  is written beside it as a new animation file, named as the game finds it,
  for an INI line to switch to by name.

**The 3D viewer**

- A `.w3d`, **Preview object** and an FX preview all open one viewer: the same
  view, grid and camera, and the same controls in the same place (animation
  list, play, stop, restart, step, time slider, speed, loop, bones, model, hidden
  parts, boxes, grid, level of detail, sky). A `.w3d` opened directly or by
  Ctrl-click shows the model alone; a preview adds its own panels beside it.

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
- **A/B** (`C`) flips the preview between the block as written and with the
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
- **Show Layout Preview** (the `.wnd` editor title button) draws the windows at their creation resolution
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

- **new** Place, move, turn and delete objects on the map: pick a template
  from the workspace's INI definitions and click the map, drag an object to
  move it, **⟲ ⟳** or `[` `]` turn it by 15°, `Delete` removes it. Owner or
  team, health and name are fields; any other property can be added or
  removed. New names are added to the map's name table.
- **new** Waypoints are drawn with their links as arrows. **Place waypoint**
  adds one with the next id, Alt-click another waypoint to add or remove a
  link, and the object panel lists a waypoint's links. Removing a waypoint
  removes its links.
- **new** Trigger areas can be selected, renamed, reshaped (drag a corner or
  type coordinates), added by clicking points on the map, and deleted.
  Chunks the editor does not touch, including `PolygonTriggers`, keep their
  bytes. Maps from a game install open read-only.
- **new** Standalone `.scb` script files open in a read-only viewer with the
  same script tree as the map editor.

**Previews**

- Textures: TGA and DDS (DXT1/3/5, uncompressed), with zoom, channels and mip
  levels. A References panel lists every `MappedImage` and every APT shape
  that uses part of the texture, draws their boxes on it and lets you select
  one and drag, resize or type its region back into the INI or `.ru` file.
  Fit follows the room the image has beside the panel, the image scrolls
  inside its own area so the list stays in view while zoomed, the panel is
  resized by dragging its edge, and **Pop out** moves the editor to its own
  window for more room. **Export as PNG**, **Replace with PNG…** (written back in the
  texture's own format, mipmaps included) and **Convert to Game Texture…**
  for PNGs (TGA 24/32-bit, DDS DXT1/3/5 or uncompressed).
- Sounds: WAV, including IMA ADPCM, which VS Code's own audio preview cannot play. MP3 opens in VS Code's own preview.
- **new** Cursors: `.cur` and `.ani` open in the preview with every image,
  its size and its hotspot (outlined in red); an animated cursor plays its own
  sequence and rates, with play, pause and a step slider.
- **new** **Export Cursor as PNG…** writes a `.cur`, or one or all frames of an
  `.ani`, as PNG (to a file or a folder you pick, never beside the source), and
  **Convert to Cursor…** on a PNG asks for the hotspot and writes a `.cur`
  with alpha.
- **new** **Build Animated Cursor…** (command palette, or the file explorer menu on
  images) puts `.png`, `.tga`, `.cur`, `.ico` or `.ani` files in a list of
  frames: reorder, duplicate or remove them, set each frame's hotspot and
  duration in milliseconds, watch the loop, then **Save as .ani…** to a place
  you choose. All frames must share one size.
- Videos: EA's VP6 movies (`.vp6`), decoded frame by frame with play,
  pause and seeking (dragging the slider follows the pointer and lands on
  the frame you let go on); alpha movies show over a checkerboard.
- **Convert to VP6 Movie…** on a video, an image or a folder of numbered
  PNG/TGA/DDS frames writes an EA VP6 movie the games play: size, frame rate
  and quality are asked for, transparency is kept as an alpha stream, and the
  result is decoded again before it is saved. Frames between key frames
  (`bigfs.vp6.keyFrameSeconds`) are coded as changes from the one before,
  with motion search, and each frame sends the probabilities it needs. Any video FFmpeg reads works
  when FFmpeg is installed (`bigfs.ffmpegPath`); without it, WebM and Ogg.
- Models: W3D in 3D, with their skeleton and textures found in any archive,
  drawn pass by pass with each triangle's own texture, shader, blend and
  depth test, and with the material's colours: emissive glow, tints, vertex
  colours, opacity, unlit surfaces, second texture stages with every detail
  combine, clamped textures and bump offsets. Scrolling, rotating, flipbook
  and environment-mapped textures run on the preview's clock and stop with
  its pause. Parts `housecolor.ini` masks wear a default team colour, and
  normal-mapped meshes show their relief and highlight.
  Any animation plays on any model, by bone number as the game applies it;
  the list shows the skeleton's own clips first and the ones made for other
  skeletons in their own group, and playing one of those says so.
  Animations of the skeleton are listed and play on the model (dense,
  time-coded, adaptive-delta and motion channels); a skeleton or an
  animation file on its own shows its bones. Meshes marked hidden are not
  drawn (a toggle shows them); the levels of detail the HLOD header counts are
  picked from a dropdown with their max screen size when there is more than
  one, and arrays past that count are skipped as the game skips them; the
  aggregate and proxy lists are shown; collision boxes can be drawn as
  wireframes. A **Parts** list turns each mesh on and off, and the object
  preview hides what the object's INI and scripts hide in the shown state, and
  as the game does a write also reaches the parts on bones below the part it names
  (animation state scripts, fired `SubObjectsUpgrade` modules, `TransitionDamageFX`
  lists, `OnCreated` handlers in `scripts.lua`), naming the source and listing what depends on the running
  game. Scripts are read, not run.

**Interface movies (APT)**

- Every character drawn with its shapes, textures and text; sprites play
  frame by frame.
- Edit text fields, colours, bounds, exports, imports, placements, frame
  labels and frames, add frames, duplicate characters and create new text,
  sprite, shape and image characters, with undo.
- **new** Every field the parser reads is editable, with undo: a placement's
  flags (move and each optional field on or off), depth, character (picked
  from a list), matrix, the colour transform's multiply and add as R, G, B, A
  bytes or a hex word, ratio, name, clip depth and clip events; button
  records' states, character, depth, matrix and colour; button action
  conditions; text runs (font, colour, pen offset, height, glyphs) of Text
  characters, added and removed; font glyph ids; morph shapes; frame label
  flags, background colours (added too), init actions and removed depths;
  the movie record's word at +36, import slots and every `.const` item. An
  unedited movie still saves byte for byte, and an edit touches only its
  own fields or appends.
- **new** A text view of the whole movie, `.apt` and `.const` together, for
  people who prefer text: **bigFS: Open APT as Text** (editor title,
  palette or the `.apt` context menu) switches to it and **Reopen as Visual
  Editor** switches back. One record a line, indented by what holds it,
  character ids explicit, numbers exact, and every script decompiled in a
  fence; see [docs/apt-text-format.md](docs/apt-text-format.md). Highlighting
  (scripts too), an outline, folding, and hover and go to definition on
  character ids. Saving turns the differences into the editor's own edits,
  so only the edited fields change and an unedited text leaves the movie
  byte for byte; a text that does not parse or cannot be saved is
  underlined and the movie is left as it was. Works for loose movies and
  movies in writable archives; base game movies open read-only.
- **Check APT Movies** checks every movie of the workspace, loose or in an
  archive, for integrity problems and reports what it found; **Rename APT Movie…** and
  **Delete APT Movie…** (on an `.apt`, in the Explorer or an archive) rename
  or remove a movie together with its `.const` and `.dat`, and update the
  imports that name it.
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
- **new** Engine images: surfaces no movie names get what the game supplies, the
  main menu's logo and shell background, the faction icon and a black portrait,
  in place of their magenta squares. The Engine panel shows each with a field to
  change it to any `MappedImage` or texture file, kept per movie with the other
  answers.
- **new** Engine suggestions: where the engine feeds a movie a value out of the
  game's INI, the Engine panel field is still plain text but offers the
  INI's values to pick from. The palantir's `SetPalantirFrameState` offers
  `_good` and `_evil` with the sides each shows, `SetFaction` (the all-heroes
  button) and `SetPlayerFaction` offer the player templates' `Side` values, and
  faction icon, rank icon and command button picture fields offer the
  `MappedImage`s the game binds there. Nothing is offered without a game
  loaded. Hovering a field says where the game takes its value from.
  The same goes for create-a-hero power, class and type icons, hero-row and
  unit portraits, spell book pictures and the `MultiplayerColor` swatches of
  the score and loading screens' colour externs. Values the engine itself fixes
  are offered too, with the evidence in the tooltip: power cell, icon slot and
  show/hide states, the score screen's mode, save/load mode, game types, true
  and false externs and a view's `_AnimMode`.
- **new** `View3D` surfaces (ported from mint's `view3d.rs`): a clip naming a W3D
  model in `_RenderObj` draws it, found through the game's load order, through
  the model's own camera and following `_AnimMode` and `_Frame`, in the clip's
  place in paint order, so masks and fades apply. Models load when shown, at most
  16 at a time; a missing one is a labelled box. Scrolling, rotating and
  flipbook materials of the model move with the stage's clock.
- **new** Engine gadgets (ported from mint's apt-player and apt-viewer): a clip
  whose `_type` (or `_Load` template) names a slider, check box, list box,
  combo box, text entry, scroll bar or progress bar gets a working control
  over the stage, bound to variables of the clip (`_value`/`_min`/`_max`,
  `_checked`, `_selected` and `_items` separated by `|`, `_text`). A clip
  with `_imageName` (or `_imageMap`) draws that `MappedImage` from the INI
  index and its texture. Any other `_type` is a labelled placeholder. The
  Engine panel has a **Gadgets** section listing each one with its bound
  values, overridable like any other value.
- **changed** The details, inspector and timeline panels are a block
  editor: every record (movie header, character, frame, placement, button
  record, action, export, import, `.const` item) is a collapsible card with a
  type icon, id or name and summary, its fields as labelled typed inputs
  (numbers, colour swatch with R, G, B, A, flag toggles, character pickers
  with search), and VS Code theme colours throughout.
- **new** **＋ Add block** menus offer only the record kinds that fit the
  spot; frame items and button records reorder by drag handle or Alt+↑ and
  Alt+↓ (each one undo step); cards duplicate and delete inline; and the
  keyboard moves between cards, opens and closes them and reorders.
- **new** Script blocks show the decompiled ActionScript in place as a
  highlighted code field. It compiles when you leave it, underlines the error
  and writes nothing until it compiles; **Open in tab** is still on each
  script block. The toolbar's **Text view** button asks for the whole movie
  as text.
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
  given a return value. Overrides and the calls you make are kept per movie,
  and a restarted movie makes those calls again once it has settled.
- Tweens already baked into a movie are recognised: a run of frames in
  which an instance follows one easing curve shows as a purple bar, its
  tooltip saying what moves from where to where, and a double-click opens
  it in the tween form with its easing, to change it as one tween.

## Commands, settings and editors

Every command is in the Command Palette as **BIG: …** (or **bigFS: …**) where
it makes sense without a selection; the rest sit in the context menu of the
row, file or editor they act on.

| Command | Where | Does |
| --- | --- | --- |
| Refresh, Search in BIG Archives…, Go to File in Archives…, Validate INI Files, Show What the Game Loads, Show Every Archive | BIG Archives title bar | Rescan, search, validate, switch view |
| New File…, New Folder…, Add Files…, Extract…, Rename…, Delete, Cut, Copy, Paste, Duplicate, Copy Path, Copy Relative Path, Override in Folder… | archive row context menu | Edit archives |
| Pack into BIG Archive…, Launch Game with Mod | Explorer folder menu | Build and run a mod |
| Find Game Installs, Choose Game Language, Compare with Base Game, Package Mod…, Check Translations, Open Balance Sheet, Armor Table, Find Unused Definitions, Clear Unused Definitions, Check APT Movies | Command Palette | Workspace tools |
| Convert String Table (.str ⇄ .csf), Open as Table | `.str`/`.csf` menu, editor title | String tables |
| Show Layout Preview | `.wnd` editor title | WND preview |
| Export as PNG, Replace with PNG…, Convert to Game Texture… | `.tga`/`.dds`/`.png` menu | Textures |
| Export Cursor as PNG… | `.cur`/`.ani` menu | Cursors |
| Convert to Cursor… | `.png` menu | Cursors |
| Build Animated Cursor… | palette, `.png`/`.cur`/`.tga` file menu | Cursors |
| Convert to VP6 Movie… | video, image or folder menu | VP6 |
| Edit W3D Animation… | `.w3d` menu | Bone animations |
| New APT Movie…, Rename APT Movie…, Delete APT Movie… | folder or `.apt` menu | APT movies |
| **new** Open APT as Text, Reopen as Visual Editor | APT editor title, `.apt` menu, text view title | APT text view |
| Preview Particle System, Preview Object Here, New Particle System from Template…, Bulk Edit INI Values…, Show Effective Definition, New Unit, Hero or Building…, Duplicate Definition…, Edit CommandSet Slots, Play Audio Event | INI editor menu and lenses | INI tools |

| Setting | Default | Does |
| --- | --- | --- |
| `bigfs.ini.game` | `rotwk` | Grammar for `rotwk`, `bfme2` or `bfme1` |
| `bigfs.ini.checkReferences`, `bigfs.ini.checkAssets`, `bigfs.ini.checkStrings` | `auto` | Report undefined references, missing assets, undefined game text (`auto`, `on`, `off`) |
| `bigfs.language` | `auto` | Game text language |
| `bigfs.explorer.view` | `archives` | `archives` or `game` view |
| `bigfs.baseGameFolder`, `bigfs.underlyingGameFolder` | empty | Untouched installs, the lowest load-order layers |
| `bigfs.game.executable`, `bigfs.game.arguments` | empty | What Launch Game with Mod starts |
| `bigfs.ffmpegPath`, `bigfs.vp6.keyFrameSeconds` | empty, `2` | VP6 conversion |

| Editor | Opens |
| --- | --- |
| bigFS Preview | `.tga`, `.dds`, `.wav`, `.w3d`, `.vp6`, `.cur`, `.ani` |
| bigFS APT Movie | `.apt` |
| bigFS String Table, bigFS CSF String Table | `.str`, `.csf` |
| bigFS Create-a-Hero | `.cah` |
| bigFS Map | `.map`, `.bse` |
| bigFS Script File | `.scb` |

Languages: `sage-ini` (`.ini`, `.inc`, `.bhav`), `sage-str`, `sage-wnd`,
`apt-script` (`.aptscript`), **new** `apt-text` (`.apttext`, the APT text
view).

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
