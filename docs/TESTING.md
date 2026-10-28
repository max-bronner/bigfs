# Manual test guide

Everything `dev/next` adds or changes over `master`, written so it can be
ticked off by hand against a real install and a throwaway mod. Each item says
what it is, the steps, and what should happen. Items are marked **new** (does
not exist on `master`) or **changed** (exists on `master`, behaves differently
now). The automated gate (`npm ci && npm run check-types && npm run lint &&
npm run test:unit`, plus `xvfb-run -a npm test` for the integration suite)
covers the logic with synthetic files; this guide covers what only eyes, a
real window and the game can show.

Nothing here has been verified in the game itself. Anything that writes game
files (archives, W3D animations, APT movies, maps, VP6, textures, string
tables, `.cah`) deserves one load in the game as well.

## Test data you need

- **Game installs, read-only.** One or more of BFME, BFME II and The Rise of
  the Witch-king (ROTWK). Never open an install as your workspace to edit it,
  never edit an archive in it, and never save a file from it. bigFS treats
  `bigfs.baseGameFolder` and `bigfs.underlyingGameFolder` as read-only; the
  only thing to do with them is read, extract or copy out.
- **A test mod folder.** Make an empty folder (for example `~/bigfs-test-mod`)
  and open it as the VS Code workspace. Put into it, by copying out of the
  install (Extract… or Override in Folder…):
  - two or three small `.big` archives of your own (use **Pack into BIG
    Archive…** on a folder of copied files, or copy small archives such as an
    INI or `lang/` one), at least two writable ones;
  - loose INI files (`data/ini/object/*.ini`, `fxlist.ini`,
    `particlesystem.ini`, `commandset.ini`, `commandbutton.ini`,
    `weapon.ini`, `armor.ini`), a few `.str` / `.csf` tables, a `.wnd`;
  - `.apt` movies with their `.const` and `.dat` (MainMenu, Palantir, Options,
    LoadScreen), a few `.w3d` models and animations (a hero such as Aragorn,
    plus a building with several levels of detail), `.tga` / `.dds`, `.wav` /
    `.mp3`, `.vp6`;
  - maps (`.map`, `.bse`, a `.scb`) and one `MyHero_*.cah`.
- **A second mod folder** and, optionally, a second install, to check load
  order (mod over ROTWK over BFME II).
- **Settings to set first** (Settings → Extensions → bigFS): `bigfs.baseGameFolder`
  to the ROTWK install, `bigfs.underlyingGameFolder` to BFME II, `bigfs.ini.game`
  to match. See *Settings* at the end for every setting.
- **FFmpeg** on the PATH (or `bigfs.ffmpegPath`) and a short video, an image
  and a folder of numbered PNG frames for the VP6 conversion.
- Install the `.vsix` from the latest CI run of `dev/next`, or run
  `npm ci && npm run compile` and launch the extension host (F5).
- Keep a clean copy of the test mod to start from: several steps write files.

## Explorer & archives

- [ ] **changed** **BIG Archives view.** Open the test mod folder. The
  *BIG Archives* view in the Explorer lists every `.big` in the workspace as
  folders. Expect: an archive is read only when expanded or opened; the empty
  folder shows "Open a folder…" and a folder without archives shows "No BIG
  archives were found" with a Refresh link.
- [ ] **changed** **Edit in place.** In a writable archive: New File…, New
  Folder…, Rename… (F2), Delete (Del), Cut / Copy / Paste (Ctrl+X/C/V),
  Duplicate, drag and drop, Copy Path, Copy Relative Path, Add Files…,
  Extract… (file, folder, whole archive). Expect: each works and saves;
  names, duplicates, header and trailer stay as shipped; the game still loads
  the archive. A save shows a brief status bar message, not a toast. An
  extract name that would escape the target folder is refused.
- [ ] **changed** **Commands act on the row you click.** Right-click a
  `.tga`/`.dds` in an archive while a different file is open in the editor:
  Export as PNG and Replace with PNG… act on the clicked file. Same for a
  `.png` (Convert to Game Texture…), a `.str`/`.csf` (Convert String Table),
  a folder or archive (New APT Movie…, no picker), an `.apt` (Rename APT
  Movie…, Delete APT Movie…), a video (Convert to VP6 Movie…) and a `.w3d`
  (Edit W3D Animation…). In the game view the winning copy is used.
- [ ] **changed** **Tree keys leave text fields alone.** Focus the tree's
  find box and press F2, Delete, Ctrl+X/C/V: the text field handles them, not
  the tree. Source and disk-folder rows do not offer New File, Add Files and
  the other archive-only entries.
- [ ] **new** **Copy and move between archives.** With two writable archives
  A and B: copy a file and a folder in A, paste on B or a folder in B; then
  cut and paste; then drag. Expect: a name already there asks Replace, Skip or
  Keep Both (Keep Both adds ` copy`); Esc cancels and changes nothing; the
  target archive is saved once; a cut removes the files from the source
  archive afterwards.
- [ ] **new** **Base game as a source.** Copy a file out of a base game
  archive (in `bigfs.baseGameFolder`) into a writable archive: works. Cut or
  drag it: the file stays in the base game and the message says Copied. Paste,
  rename, delete or save into a base game archive: refused with a message that
  says what to do instead (Override in Folder). A workspace folder that is
  also the base game stays writable.
- [ ] **new** **Loose folder into an archive.** Drag a folder from the VS Code
  Explorer into an archive holding some of the same files: the same Replace,
  Skip, Keep Both prompt.
- [ ] **new** **Archive root holds its own folders.** Select an archive and
  some of its folders together and run Extract (or Delete): the archive is
  handled once. Drag an archive onto one of its own folders: refused.
- [ ] **new** **Find Game Installs.** Run **BIG: Find Game Installs** (also
  offered once on first start when `bigfs.baseGameFolder` and
  `bigfs.underlyingGameFolder` are empty). Expect a quick pick of installs
  found through the registry, Program Files, EA app, Origin, and Wine / Proton
  / CrossOver prefixes (Linux, macOS). Picking ROTWK also sets BFME II beneath
  it. Dismissing changes no setting and the start-up offer does not return.
- [ ] **new** **Pack into BIG Archive…** on a folder in the Explorer: a `.big`
  with the folder's files, hidden files and archives left out; the output is
  not defaulted into the base game folder.
- [ ] **new** **Override in Folder…** on an archive file or folder (including
  one from the base game): copies it into a mod folder at the same path.
- [ ] **new** **Search in BIG Archives…** (view title bar): text found inside
  every archive, results open at the match.
- [ ] **new** **Show What the Game Loads** / **Show Every Archive** (title bar
  button; same as `bigfs.explorer.view`): the merged tree lists only the
  winning file for each path; the per-archive tree lists everything.
- [ ] **changed** An archive written while open, or created in a folder a
  moment before, or one that failed mid-write, is still found and read (fixes
  #64, #67, #73). **Refresh** while saving does not empty the view.
- [ ] **changed** Architecture notes (`docs/architecture.md`) name layers that
  exist in `src/`: skim the layer table against the folders.

## Load order & base game

- [ ] **new** **Load order follows the game.** Make a mod folder with a loose
  file and an archive holding the same path, and a second archive `___a.big`
  vs `b.big` with the same path. Show What the Game Loads: the loose file wins
  over every archive of its install; between archives the first path-sorted
  one wins. A mod folder beats ROTWK, which beats BFME II; folders of one
  kind keep workspace folder order.
- [ ] **new** The two different `aptcomponents_001.tga` of ROTWK and BFME II
  resolve to the layer the game loads (open one from an APT or W3D that names
  it).
- [ ] **new** A mod-only or ROTWK-only workspace with
  `bigfs.baseGameFolder` / `bigfs.underlyingGameFolder` set still resolves base
  game files for hovers, previews and links. A mod of loose INI files alone
  appears in the game view.
- [ ] **new** **Compare with Base Game:** added, changed and unchanged files,
  a diff per changed text file, and for an INI file the changes definition by
  definition (`Body[ModuleTag_Body]/MaxHealth 200 → 220`). Cancelling works;
  a file deleted meanwhile is skipped; BFME II layer files and loose base files
  are included, archives bigFS packed are not.
- [ ] **new** **Package Mod…:** the report lists overridden, new and shadowed
  files (a base archive sorting earlier keeps the file unless `-mod` is used)
  and open INI errors counted from the mod folder; then packs one archive
  without hidden files.
- [ ] **new** **Launch Game with Mod** on a folder (Explorer context menu):
  prompts for the executable on first use, saves open files, starts the game
  with `-mod "<folder>"` plus `bigfs.game.arguments`; a **Run mod** status bar
  button appears once `bigfs.game.executable` is set.
- [ ] **new** **Game language.** With one `lang/<Language>.big` installed,
  hover a `DisplayName = OBJECT:…` value: that language's text, nothing asked.
  With two or more installed and `bigfs.language` = `auto`, the first run shows
  one quick pick; reload: not asked again. `*Audio.big` archives are not
  listed. **bigFS: Choose Game Language** switches; hovers, the WND preview
  (reopen) and APT `$KEY` text follow. Setting `bigfs.language` to `German`
  picks it without asking.

## INI language

Open any `.ini`, `.inc` or `.bhav` (language `sage-ini`).

- [ ] **new** Highlighting, outline, folding, completion, hover with engine
  types and game text, go to definition (F12), find references, rename across
  archives and loose folders, `#include` links, `#define` macros.
- [ ] **new** Problems: unknown fields and modules, unclosed blocks, stray
  `End`, missing includes, undefined references, missing game text, missing
  models, animations, textures and sounds (nearest-name quick fixes).
  **Validate INI Files** (view title bar) checks the whole workspace.
- [ ] **changed** **Grammar reads retail the way the game does.** Validate
  retail BFME II or ROTWK INI and compare with the count of problems before:
  nearly clean. `AddEmotion = Name` in an `EmotionTrackerUpdate` does not
  cascade; `End  StateName = Sword` closes its block; `StanceTemplate`,
  `StrategicHUD`, `LODPreset`, `BenchProfile`, `OptionGroup`, `WebpageURL` and
  regions in a `RegionCampain` `.inc` raise nothing; each flat `ParticleSystem`
  block in `particlesystem.ini` shows one information note, not a warning per
  line. A misspelt field in a known block must still be reported.
- [ ] **changed** **Reference checks by block and field**
  (`bigfs.ini.checkReferences`): an undefined `Weapon`, `Upgrade` or `FXList`
  name is information, not a warning; flags, `Filename`, a `MouseCursor`'s
  `Image`, `Frame:`/`FireWhenSkipped` in an `FXEvent` and group names are not
  read as references. Renaming an `Object` also renames the parents named by
  `ChildObject` / `ObjectReskin` headers. Names inside a `#define` are found
  by rename and find references. A rename edits each use once and edits what is
  on screen.
- [ ] **new** Audio references: sound fields resolve into the audio namespace;
  `Multisound`, `DialogEvent`, `MusicTrack`, `AmbientStream`, `StreamedSound`
  names are not reported as missing; `EVA:` and `+SOUND:` prefixes and the
  `name:weight` in `Subsounds` rename and find correctly; `Attack` and `Decay`
  are file links.
- [ ] **new** Quick fixes: add a missing `End`, remove a stray one, fix a
  misspelt keyword or name, add a missing game-text record to the table the
  file already uses.
- [ ] **changed** **Format Document** re-indents and touches only whitespace;
  run it again, then again on a file with unknown keywords: nothing changes.
- [ ] **new** Hover a `MappedImage` name: the image cut from its texture
  (a rotated image is turned back). Hover a CommandSet name: its buttons with
  icons, labels, hotkeys.
- [ ] **changed** **Hotkey clashes** are problems, except a purchase button
  and the ability it unlocks (`NEED_UPGRADE`) sharing a key.
- [ ] **new** Lua in `BeginScript` regions reports syntax errors.
- [ ] **new** **Show Call Hierarchy** (Shift+Alt+H) on a definition: what it
  uses and what uses it; **Show Type Hierarchy**: `ChildObject` and
  `ObjectReskin` parents and children.
- [ ] **changed** **Find Unused Definitions** / **Clear Unused Definitions**:
  only the mod's own files, never objects, upgrades, sciences, special powers,
  command sets, player templates, sounds, EVA events, images, GameData,
  videos or cursors, and nothing under `bigfs.baseGameFolder`. Clear empties
  the list.
- [ ] **new** **Duplicate Definition…** (editor context menu): new name, the
  game-text labels carrying the old name renamed and their text copied.
- [ ] **new** **Effective definition** lens on `ChildObject` /
  `ObjectReskin` (command: **Show Effective Definition**): the composed
  object, each line marked with its source; follows edits.
- [ ] **new** **Edit slots** lens on a `CommandSet X` header (command: **Edit
  CommandSet Slots**): drag buttons between slots (swap), clear, add; slot
  lines rewritten in order. A `CommandSet = X` field inside an Object has no
  lens. Edit the file by hand during a drag: the stale edit is refused with a
  message and the editor refreshes.
- [ ] **new** **Armor Table**: every armor against every damage type; an armor
  with no `DEFAULT` shows 100% greyed; `DEFAULT` follows file order (a type
  written before it is overwritten); typing in a cell writes or adds the line
  (a new `DEFAULT` goes first); an edit made while the file changed by hand is
  refused.
- [ ] **new** **Open Balance Sheet**: sort, filter, double-click to edit at the
  source (inherited values in italics, edited at the parent), **Damage/s**
  column. `#define` macros and `#ADD`/`#SUBTRACT`/`#MULTIPLY`/`#DIVIDE` show
  their number with what is written in the tooltip; a weapon with two damage
  nuggets shows the sum and a matching Damage/s.
- [ ] **new** Links: in `fxlist.ini` a `ParticleSystem` nugget's `Name` goes to
  its system (F12), finds references, and an unknown name is reported; the same
  for a `Sound` nugget's audio event. Model, animation and texture names are
  Ctrl+click links to the file in its viewer, wherever it lives.
- [ ] **new** **Game text:** `OBJECT:Name` labels no string table defines are
  reported (`bigfs.ini.checkStrings`), with a quick fix.
- [ ] **new** **Missing assets** (`bigfs.ini.checkAssets`): with
  `bigfs.baseGameFolder` unset and `auto`, the check stays off and shows a
  one-time message with a button that opens the setting; set it and reload:
  missing models, animations, textures and sounds are reported with nearest
  names as quick fixes. `on` and `off` are taken as set.
- [ ] **new** **Bulk Edit INI Values…**: blocks (`Object *Archer*`),
  conditions (`Side = Rohan; KindOf ~ INFANTRY`), a field
  (`ActiveBody/MaxHealth`) and a formula (`round(x * 1.1)`), reviewed as a
  diff in the refactor preview where changes can be unticked. Values from a
  `#define`, an `#include`d file or a `ChildObject`'s parent are edited where
  defined (the preview says so); an `#ADD` operand is reported as not editable.
- [ ] **changed** **Bulk Edit inside archives:** with INI in a writable
  archive, the same command edits it too: each archive is rewritten once and an
  **Undo** action follows. Values in a base game archive are never written; the
  file is offered for **Override in Folder…**.
- [ ] **new** **New Unit, Hero or Building…**: inherit (`ChildObject`) or copy,
  display name, build button in the next free slot of the command set, text in
  the original's string table.
- [ ] **changed** **New object in archives:** with an original in a writable
  archive, the object, button, slot and text are saved into the archive in one
  save; a copy lands in `data/ini/object/<name>.ini` (or the original's file
  when that is a loaded one), never at the workspace root; an original sitting
  in a stray file (an `.ini` outside `Data\INI\Object` not named by the legend)
  gets its own file in the object folder; a base game original sends the new
  file to a workspace folder and lists the command set and string table that
  need editing.
- [ ] **new** **Audio events:** **▶ Play** lens, and play links on hover (see
  *Audio*).

## STR, CSF & WND

- [ ] **new** `.str` language (sage-str): highlighting, outline of labels,
  folding, problems for duplicate labels, missing `END`, unclosed quotes. Read
  as Windows-1252. A text ending in an escaped backslash followed by another
  record keeps both records.
- [ ] **new** **Open as Table** (editor title) edits a `.str` as a filterable
  table; only changed records are rewritten.
- [ ] **new** `.csf` opens as a table and saves byte for byte. Renaming a
  label to one with `日` or a speech name that cannot be stored is rejected; a
  multi-line CRLF cell edited and left unchanged does not dirty the document.
- [ ] **new** **Convert String Table (.str ⇄ .csf)**. Converting a `.csf`
  containing `日` to `.str` warns, naming the character, instead of writing `?`.
- [ ] **new** **Check Translations:** the labels each language lacks; for a
  `.str`, adding them with another language's text standing in.
- [ ] **changed** **Check Translations inside archives:** a `.str` / `.csf` in
  a writable archive (language from `lang/NAME.big`) is filled and saved with
  it; a base game table is only reported, with an Override in Folder offer;
  labels INI files (loose and in archives) use but no table defines are listed.
- [ ] **new** `.wnd` (sage-wnd): completion of keys, window types and flags,
  problems. **Show Layout Preview** (editor title) beside the text, live; click
  a window to jump to it.
- [ ] **changed** **WND preview draws like the game:** images (resolved through
  `MappedImage` and their textures), check boxes, sliders, list boxes, combo
  boxes by slot, an Enabled / Hilite / Disabled switch with Checked, `TEXT`
  from the string table (chosen language) in its font and colour, each root
  scaled from its own `CREATIONRESOLUTION`. COLOR and BORDERCOLOR fill only a
  slot with no image.

## APT preview

Open an `.apt` (with its `.const` and `.dat` beside it) in **bigFS APT
Movie**.

- [ ] **new** Characters list, stage, details; sprites play; imports resolve
  across archives in the game's priority (mod, ROTWK, BFME II); a movie
  inside an archive opens with its own `.const` / `.dat` even where casing
  differs.
- [ ] **new** Inspector; picking on the stage (click, double-click goes
  inside); overlays origin (O), boxes (B), wireframe (W); **Interact** (I)
  makes buttons respond.
- [ ] **new** Editing with undo: text, colours, bounds, exports, imports,
  placements, frame labels, frames, new text / sprite / shape / image
  characters, geometry and texture import, remove characters.
- [ ] **new** **Every field is editable.** Select a sprite with placements:
  each PlaceObject of the frame shows its flags as checkboxes (untick
  **colour** and the instance draws without its tint; tick it back and the
  stored values return), a character list, matrix, **Multiply** and **Add**
  as R, G, B, A bytes plus a hex word, ratio, name, clip depth and the clip
  events of each clip action. Pick an instance on the stage: the inspector
  shows the same colour rows (written to the record the colour comes from at
  that frame), a character swap, ratio, the **Move** bit and clip depth. A
  button shows each record's states, character, depth, matrix, colour and the
  four unknown floats, and each button script its conditions as checkboxes.
  A Text character shows its matrix and every run; a font its glyph ids; a
  morph its two shapes. Frame labels show flags and frame, background
  colours and init actions are editable and a background colour can be
  added. The movie (#0) shows the word at +36, each import's slot and every
  `.const` item, string or number. Every one of these undoes with Ctrl+Z
  and redoes with Ctrl+Y; save an unedited movie and it is byte for byte the
  same.
- [ ] **new** ActionScript tabs: edit, compile, add and remove scripts.
- [ ] **new** **New APT Movie…** (folder): `.apt`, `.const`, `.dat`.
  **Rename APT Movie…** renames every file of the movie and the imports that
  name it (a dirty tab stops it); **Delete APT Movie…** asks first.
  **Check APT Movies** reports problems for every movie, loose or in an
  archive.
- [ ] **new** Timeline panel: tweens, formulas, fade, remove, show, insert,
  delete, duplicate, reverse, retime; onion skin (N); recognised baked tweens
  (purple, double-click to edit); **Script…**; copy and paste motion, mirrored.
- [ ] **new** Playback speed 0.05× to 8× of 30 frames/s, `[` and `]`.
- [ ] **new** Timeline **labels** row (tooltip lists who jumps there) and
  **script** row (■ stop, ▶ play, ↷ jump, ? branches); hover a jump to light
  its target, click to go there.
- [ ] **new** Action scripts are respected by default: `stop()` stops,
  `gotoAndPlay` jumps, nested clips keep playing. **Play from…** starts at
  frame 0 or a label. **Ignore action scripts** (S) plays every frame.
- [ ] **new** Clip masks are applied and the canvas is sized to what they
  show. **Show masks** (M) draws everything, hidden parts faintly, masks
  outlined in cyan.
- [ ] **new** Scripts run in full on an AVM1 machine: variables, conditions,
  loops, functions, `attachMovie`, text set by scripts, `_visible` / `_x` /
  `_alpha`. Depths from 0 above timeline clips; `swapDepths`, `getDepth`,
  `getNextHighestDepth`, `getInstanceAtDepth`; `removeMovieClip` leaves
  timeline clips; `localToGlobal`, `hitTest`, `getBounds`; `Color` tints
  (`setRGB`, `getRGB`, `setTransform`, `getTransform`).
- [ ] **new** A script that fails or runs away is stopped and reported in the
  log under the stage; frames whose scripts goto each other take turns;
  selecting, scrubbing and playing stay quick with 400 scripted clips.
- [ ] **new** Retail root movies boot: MainMenu, Palantir, Options and
  LoadScreen; a root script reading `_root` / `_level0` in its first frame runs,
  and the log has no `Cannot read properties of undefined`. A first-frame
  `stop()` survives **Interact** / **Ignore** restarts; a sprite's init actions
  have run before the first frame.
- [ ] **changed** Drawing matches the game: an imported texture is found
  through the library (no magenta), colour transforms have multiply and add per
  channel, text is vertically centred, wrapped on words and uses the game's
  font stack, and an empty mask hides nothing.
- [ ] **new** **Engine panel:** *Called by the engine* (type arguments, press
  **Call**); *Values* (override by whole path; `0x74808E`, `1e3`, `NaN`,
  `-Infinity` accepted; **Override** adds one; **Restart with these
  overrides**; **Clear overrides**; filter box); *Extern writes* (read-only,
  never saved as overrides; `GetExtern` answers your override, else the movie's
  write; `ToggleExtern` flips each time); *Calls to the engine* (counted, with a
  return value to give); *Sounds the movie asks for*.
- [ ] **new** Overrides survive: type one, close the movie and the window,
  reopen: it is back; a different movie has its own.
- [ ] **new** Palantir: open `palantir.apt`, call `SetPlayerFaction` with the
  faction name its labels use, see the matching art.
- [ ] **new** `$KEY` text shows the string table's `APT:key` (else `key`); an
  absent key shows `MISSING: 'APT:key'`; `&dropShadow` is not shown.
- [ ] **new** Movies a script loads (`loadMovie`, `loadMovieNum`,
  `unloadMovie`, `getURL`) play in place, with the movie's install in the
  workspace: replaces the clip's content from frame 0; a `_level1` shows above;
  `unloadMovie` leaves it empty; an unfindable or unreadable movie logs
  `loadMovie: <name> not loaded: <reason>`. A load into `_level0` is refused.
- [ ] **new** Movie sounds: *Sounds the movie asks for* lists each
  `FSCommand:PlaySound` event with count and **▶ Play**; the log says "not
  played, Play movie sounds is off". Tick **Play movie sounds** and hover the
  menu's buttons: sounds play. The box is off every time and not remembered.
- [ ] **new** Gadgets and MappedImage surfaces: in a menu with sliders, check
  boxes, list / combo boxes, text entries, scroll bars or progress bars, turn
  on **Interact** and use the controls over the stage (bound to `_value`,
  `_min`, `_max`, `_checked`, `_selected`, `_items`, `_text`); the Engine
  panel's **Gadgets** section lists each with an override field; a clip with
  `_imageName` / `_imageMap` draws its `MappedImage` (open the game's INI so it
  is indexed); an undefined image or unknown `_type` is a labelled dashed box,
  never an error. The Engine panel loads without a movie.
- Known gaps: pointer events on plain clips (`onPress` on a sprite) are only
  delivered to buttons; a movie loaded into `_level0` is refused; a mounted
  movie's own `onLoad` clip events do not run.

## W3D

Open a `.w3d` from an archive or folder (**bigFS Preview**).

- [ ] **changed** Models are textured as the game draws them (units,
  buildings, props, shader materials): correct V orientation, the drawn pass's
  texture and coordinates, holes from alpha, glows not drawn solid.
- [ ] **new** Opening an animation (`X_ATKA.w3d`) plays it on its model: the
  one an object's INI plays it on, else found by skeleton name; the info line
  says which. A skeleton or animation with no model shows its bones.
- [ ] **new** Bones are off when meshes exist; **B** toggles them.
- [ ] **new** "Used in" under the model lists INI lines naming the file, each
  a link to the line.
- [ ] **new** Meshes with the HIDDEN attribute are not drawn; **Show hidden**
  (offered only if the model has one) draws them.
- [ ] **new** HLOD: one level of detail at a time, finest first; the dropdown
  lists each with mesh count and max screen size; the aggregate and proxy lists
  are named under the model.
- [ ] **new** **Show boxes** (offered only with `BOX` chunks): green
  wireframe collision boxes in the bind pose, off by default.
- [ ] **new** Animation list of the skeleton plays on the model: play, pause,
  frame slider.
- [ ] **new** **Edit W3D Animation…** (`.w3d` menu): retime, reverse, ease,
  trim, change rate; written as a new file. Rate must be a whole number from 1
  to 1000 (`12.5`, `0.4`, `0` rejected; `24` works). Load one in the game.

## Maps & scripts

Open a map (`.map`, `.bse`) in **bigFS Map**, and a `.scb` in **bigFS Script
File**.

- [ ] **new** Relief with objects, waypoints, start positions, playable area;
  world info, time of day and sun, players, teams, object properties, scripts
  on and off, trigger areas, lighting. Text with `’` saves. Compressed maps
  save compressed; untouched chunks keep their bytes. Saved maps load in the
  game.
- [ ] **new** Objects: type a template (the list is the workspace's `Object`,
  `ChildObject`, `ObjectReskin` names), **Place object**, click the map. Drag
  it, press `[` and `]` (15°) or **⟲ ⟳**, edit Owner / team, Health, Name, add
  and remove a property with ×, `Delete` removes. Undo and redo each step; save
  and reopen keeps it. New names are added to the map's name table.
- [ ] **new** Waypoints: **Place waypoint** adds `Waypoint <id>`; Alt-click
  from a selected waypoint to another adds an arrow, again removes it; the
  Links list and its × do the same; deleting a waypoint drops its arrows.
  **Waypoint links** hides them.
- [ ] **new** Trigger areas: **New area**, click three points, Enter; select
  from the list or by clicking inside, drag a corner or type coordinates,
  rename, **Add point**, **Delete area**. Scripts and other chunks unchanged.
- [ ] **new** A map from a game install or base game archive shows no placing
  controls and refuses edits with a message.
- [ ] **new** `.scb`: the script tree matches the map view; nothing can be
  edited.
- [ ] **new** Script **▶** after sound parameters (see *Audio*).
- [ ] **changed** Closing a map or CSF editor leaves no errors; reopening
  works.

## Audio

Sound is opt-in: opening a view never plays anything.

- [ ] **new** WAV (including IMA ADPCM) and MP3 playback in **bigFS Preview**.
- [ ] **new** **▶ Play** lens on audio event blocks (AudioEvent, Multisound,
  EVA headers; not `AudioEvent = X` fields), and play links on hover of a
  sound or event name. One click plays one file; several variants (role,
  subsound or side) ask which; an attack is never chained to its body. A name
  with several variants in a map script or voice asks which. **Play Audio
  Event** is the command behind them.
- [ ] **new** Resolution: Multisound subsounds to a depth of four (no loop on a
  cycle), EVA events one per side, DialogEvent / MusicTrack / AmbientStream /
  StreamedSound to their `Filename`, Video to `<stem>_Music` and `<stem>`.
  Ctrl+click on a sound opens it in the audio preview. A missing file points
  ROTWK users at the BFME II install.
- [ ] **new** Map scripts: a **▶** after the sound parameter of
  `PLAY_SOUND_EFFECT`, `PLAY_SOUND_EFFECT_AT`, `SPEECH_PLAY`,
  `MUSIC_PLAY_TRACK_FINITE_TIMES`, `AUDIO_PUSH_MUSIC`, `HAS_FINISHED_AUDIO`
  plays that event.
- [ ] **new** Object preview **Voices** and FX timeline sounds and APT movie
  sounds (see their sections).

## FX, particles & objects

- [ ] **new** **Particle preview** (Preview lens on `FXParticleSystem`,
  `ParticleSystem`, `FXList`; command **Preview Particle System**): orbit, pan,
  zoom; play, pause, step, restart, speed 0.1× to 4×; moving emitter; hotkeys
  Space, R, `.`, W (wind), H (hollow box), B (A/B).
- [ ] **new** A slider per value; **Apply to INI** writes one undoable edit,
  **Reset** drops them; typing in the block updates the preview.
- [ ] **new** Emission volume handles: drag to size a sphere, cylinder or box;
  move a line's ends. Over-lifetime curves: drag, add and remove colour, alpha
  and size keys (written at once, renumbered); drag the end of a size curve.
- [ ] **new** **Scale** size and time; **A/B**; **Vary ±**; **Save as
  variant…**.
- [ ] **new** **Load:** peaks, averages, per system, fill, and the mod's
  `StaticGameLOD` `MaxParticleCount` budgets.
- [ ] **new** **New Particle System from Template…** (editor context menu):
  fire, smoke, sparks, dust cloud, magic glow, flash; name and texture as tab
  stops.
- [ ] **new** **On a model…** picks any W3D and a bone, drawn textured and
  lit, the same as in the W3D viewer.
- [ ] **new** FX list **Timeline**: a bar per nugget; mute (click), solo
  (shift-click), drag a delay. `Sound` rows have a ▶ and a **Play sounds** box
  (off); nothing plays by itself.
- [ ] **changed** **Timeline rows for the other nuggets.** Preview a list with
  a `LightPulse`, a `ViewShake` or `CameraShakerVolume`, a `TerrainScorch` and
  an `FXListAtBonePos`: each gets a row with its delay and key fields. The
  first three show a screen flash, a camera shake and a ring on the ground at
  their delay (repeat with **Restart**, hold still when paused); the last is
  labelled "(not previewed)" with its `FX` and `BoneName`. `BuffNugget`,
  `AttachedModel`, `DynamicDecal`, `TintDrawable` are rows only. The library
  note lists only nuggets that are labelled but not drawn.
- [ ] **new** **Object preview**: **▶ Preview object** over `Object` /
  `ChildObject` / `ObjectReskin` (also **Preview Object Here**): default model,
  idle animation playing, default state's bone particle systems on; other FX
  listed, off. **▶ Preview state** over a `ModelConditionState`,
  `AnimationState`, `IdleAnimationState`: that state's model and first
  animation. Lightbulb **Preview on the object** on an `AnimationName` (plays
  it, `SKELETON.CLIP` names too), an FX line (runs it on the model) and a
  `ParticleSysBone` line (follows the bone). Toggles for Model, Bones (off) and
  every effect; State and Animation pickers; a `ChildObject` shows what it
  inherits; previewing an FX from `fxlist.ini` shows no model.
- [ ] **changed** The object preview tracks its object by definition name:
  edit the INI; the panel redraws (debounced) and stays on the same object
  after lines are inserted above it.
- [ ] **new** **Voices** list: every sound field (`VoiceSelect`, `VoiceMove`,
  `VoiceAttack`, `Sound*`, `EvaEvent*`, `UnitSpecificSounds`), inherited
  included, each with a ▶; opening plays nothing.

## Create-a-Hero (CAH)

- [ ] **new** A loose `MyHero_*.cah` and one inside an archive open in the hero
  form (**bigFS Create-a-Hero**): name, id, class, subclass, three colours, 15
  power slots, bling / upgrade choices, attribute points spent. Class,
  subclass, bling, powers resolve through `CreateAHeroSystem`, `Upgrade`,
  `CommandButton`, `SpecialPower` and the chosen language's labels once the INI
  is indexed; unresolved values show as stored.
- [ ] **new** Edit name and a colour (also id, class, subclass, powers,
  bling), undo and redo, save, reopen: changed. Load the hero in the game: it
  still lists (CRC-32 recomputed, record version 8). A backup / revert works.
- [ ] **new** A file from the install is read-only; Save As writes a copy. A
  truncated `.cah` fails to open with a message.

## Textures, video & other formats

- [ ] **new** TGA and DDS previews (DXT1/3/5, uncompressed) with zoom,
  channels, mip levels. EAR-compressed textures open (no "TGA image type 82").
- [ ] **new** **Export as PNG**, **Replace with PNG…** (written back in the
  texture's own format, mipmaps included), **Convert to Game Texture…**
  (TGA 24/32-bit, DDS DXT1/3/5 or uncompressed).
- [ ] **new** VP6 playback with seeking, alpha over a checkerboard. Seek to the
  end of a movie with alpha (for example a credits movie): no "inter frame
  without a preceding key frame". A 0-byte `.vp6` says "The file is empty".
- [ ] **new** **Convert to VP6 Movie…** from a video, an image or a folder of
  numbered frames: size, frame rate, quality asked; the result is decoded
  before saving and plays in the game. `bigfs.vp6.keyFrameSeconds` = 0 makes
  every frame a key frame.
- [ ] **changed** A preview of an unreadable file shows its error, not a blank
  page. DDS encoding of a 2k texture does not run out of memory.

## Settings

Change each in Settings → Extensions → bigFS and note the effect.

- [ ] **new** `bigfs.ini.game` (`rotwk`, `bfme2`, `bfme1`): grammar checks,
  completion and hovers follow; a few dozen field names differ.
- [ ] **new** `bigfs.ini.checkReferences`, `bigfs.ini.checkStrings` (`auto`,
  `on`, `off`): `auto` checks once the base game is indexed.
- [ ] **new** `bigfs.ini.checkAssets` (`auto`, `on`, `off`): `auto` also needs
  `bigfs.baseGameFolder`, else it stays off with a one-time hint.
- [ ] **new** `bigfs.language` (`auto` or a language such as `English`).
- [ ] **new** `bigfs.explorer.view` (`archives`, `game`).
- [ ] **new** `bigfs.baseGameFolder`, `bigfs.underlyingGameFolder`.
- [ ] **new** `bigfs.game.executable`, `bigfs.game.arguments`.
- [ ] **new** `bigfs.ffmpegPath`, `bigfs.vp6.keyFrameSeconds`.
- [ ] **new** Defaults for `[sage-ini]`, `[sage-str]`, `[sage-wnd]` set file
  encodings (`iso88591`, `windows1252`): open a file with accented characters.

## Command checklist

Every command in `package.json`, found by name in the Command Palette or the
menu shown. Tick once each worked on a real file.

Explorer view and rows:

- [ ] `bigfs.refreshArchives` Refresh (view title)
- [ ] `bigfs.searchArchives` Search in BIG Archives… (title)
- [ ] `bigfs.validateIni` Validate INI Files (title)
- [ ] `bigfs.showGameView` Show What the Game Loads (title)
- [ ] `bigfs.showArchiveView` Show Every Archive (title)
- [ ] `bigfs.newFile` New File…
- [ ] `bigfs.newFolder` New Folder…
- [ ] `bigfs.addFiles` Add Files…
- [ ] `bigfs.extract` Extract…
- [ ] `bigfs.rename` Rename… (F2)
- [ ] `bigfs.delete` Delete (Del)
- [ ] `bigfs.cut` Cut (Ctrl+X)
- [ ] `bigfs.copy` Copy (Ctrl+C)
- [ ] `bigfs.paste` Paste (Ctrl+V)
- [ ] `bigfs.duplicate` Duplicate
- [ ] `bigfs.copyPath` Copy Path
- [ ] `bigfs.copyRelativePath` Copy Relative Path
- [ ] `bigfs.overrideInFolder` Override in Folder…
- [ ] `bigfs.packFolder` Pack into BIG Archive… (Explorer folder)

Mod workflow and game:

- [ ] `bigfs.findGameInstalls` Find Game Installs
- [ ] `bigfs.chooseLanguage` Choose Game Language
- [ ] `bigfs.compareWithBaseGame` Compare with Base Game
- [ ] `bigfs.packageMod` Package Mod…
- [ ] `bigfs.checkTranslations` Check Translations
- [ ] `bigfs.launchGame` Launch Game with Mod (Explorer folder)

INI tools:

- [ ] `bigfs.bulkEditIni` Bulk Edit INI Values…
- [ ] `bigfs.newObject` New Unit, Hero or Building…
- [ ] `bigfs.duplicateDefinition` Duplicate Definition…
- [ ] `bigfs.showEffectiveObject` Show Effective Definition
- [ ] `bigfs.editCommandSet` Edit CommandSet Slots (lens)
- [ ] `bigfs.showArmorTable` Armor Table
- [ ] `bigfs.openBalanceSheet` Open Balance Sheet
- [ ] `bigfs.findUnusedDefinitions` Find Unused Definitions
- [ ] `bigfs.clearUnusedDefinitions` Clear Unused Definitions
- [ ] `bigfs.playAudioEvent` Play Audio Event (lens, hover links)

Previews and editors:

- [ ] `bigfs.previewParticles` Preview Particle System
- [ ] `bigfs.previewObject` Preview Object Here
- [ ] `bigfs.newParticleSystem` New Particle System from Template…
- [ ] `bigfs.openStringTable` Open as Table
- [ ] `bigfs.convertStringTable` Convert String Table (.str ⇄ .csf)
- [ ] `bigfs.showWndPreview` Show Layout Preview
- [ ] `bigfs.exportPng` Export as PNG
- [ ] `bigfs.importImage` Replace with PNG…
- [ ] `bigfs.convertPng` Convert to Game Texture…
- [ ] `bigfs.convertToVp6` Convert to VP6 Movie…
- [ ] `bigfs.editW3dAnimation` Edit W3D Animation…
- [ ] `bigfs.newAptMovie` New APT Movie…
- [ ] `bigfs.renameAptMovie` Rename APT Movie…
- [ ] `bigfs.deleteAptMovie` Delete APT Movie…
- [ ] `bigfs.checkAptMovies` Check APT Movies

Custom editors:

- [ ] `bigfs.preview` bigFS Preview (`.tga`, `.dds`, `.wav`, `.mp3`, `.w3d`, `.vp6`)
- [ ] `bigfs.aptEditor` bigFS APT Movie (`.apt`)
- [ ] `bigfs.strTable` bigFS String Table (`.str`)
- [ ] `bigfs.csfEditor` bigFS CSF String Table (`.csf`)
- [ ] `bigfs.cahEditor` bigFS Create-a-Hero (`.cah`)
- [ ] `bigfs.mapEditor` / `bigfs.mapEditorAny` bigFS Map (`.map`, `.bse`)
- [ ] `bigfs.scriptViewer` bigFS Script File (`.scb`)

Settings (each exercised above): `bigfs.ini.game`, `bigfs.ini.checkReferences`,
`bigfs.ini.checkAssets`, `bigfs.ini.checkStrings`, `bigfs.language`,
`bigfs.explorer.view`, `bigfs.baseGameFolder`, `bigfs.underlyingGameFolder`,
`bigfs.game.executable`, `bigfs.game.arguments`, `bigfs.ffmpegPath`,
`bigfs.vp6.keyFrameSeconds`.

## Where to report

A defect found here is easiest to fix with the file it happened on (its name
and archive), what was expected, and what showed.
