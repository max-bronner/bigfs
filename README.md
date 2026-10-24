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
- **Extract** files, folders or whole archives, and **add** files from disk.
- **Pack into BIG Archive** on any folder in the Explorer.
- **Launch Game with Mod** starts the game with `-mod "<folder>"` on a folder
  or the workspace, saving open files first; a **Run mod** button sits in
  the status bar once the game is set (`bigfs.game.executable`, extra
  arguments in `bigfs.game.arguments`).
- **Override in Folder** copies archive files into a mod folder at the same
  path.
- **Search in BIG Archives** finds text inside every archive.
- **Compare with Base Game** lists what the workspace adds and changes
  against an untouched install (`bigfs.baseGameFolder`), each side after
  the game's load order, with a diff for every changed text file.
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
  whitespace; embedded scripts stay as written.
- Hovering a `MappedImage` name shows the image, cut from its texture.
- Lua in `BeginScript` regions is checked for syntax errors.
- Models, animations, textures and sounds named in INI files are checked
  against every archive and folder; a missing one is reported with the
  nearest existing names as quick fixes, in the editor and in **Validate INI
  Files** (`bigfs.ini.checkAssets`).

**Particle preview**

- A **Preview** lens on every `FXParticleSystem`, `ParticleSystem` and
  `FXList` block opens a live 3D preview with the system's textures: orbit,
  pan and zoom, play, pause, step, restart, speed from 0.1× to 4×, a moving
  emitter, the emission volume drawn as a wireframe.
- Every number in the block gets a slider. Sliders change the preview only;
  **Apply to INI** writes them back as one undoable edit, **Reset** drops
  them. Typing in the block updates the preview as well.
- Slave systems, per-particle attached systems, terrain-collision events and
  an FX list's `ParticleSystem` nuggets (offset, count, delay) play along.
- The simulation follows the Generals engine's rules as BFME keeps them, at
  30 frames a second; where the game's rule is not settled (wind strength,
  hollow boxes) the reading is a switch, with `W` and `H` as hotkeys.
  Model (`DRAWABLE`) particles are drawn as markers and streaks as sprites.

**String tables**

- `.str` files get their own language: highlighting, an outline of labels,
  folding, and problems for duplicate labels, missing `END` and unclosed
  quotes. They are read as Windows-1252, as the game reads them.
- **Open as Table** edits a `.str` as a filterable table; only the records
  you change are rewritten.
- `.csf` files open as the same table and save back byte for byte.
- **Convert String Table** turns a `.str` into a `.csf` and back.

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

**Previews**

- Textures: TGA and DDS (DXT1/3/5, uncompressed), with zoom, channels and mip
  levels. **Export as PNG**, **Replace with PNG…** (written back in the
  texture's own format, mipmaps included) and **Convert to Game Texture…**
  for PNGs (TGA 24/32-bit, DDS DXT1/3/5 or uncompressed).
- Sounds: WAV, including IMA ADPCM, and MP3.
- Videos: EA's VP6 movies (`.vp6`), decoded frame by frame with play,
  pause and seeking; alpha movies show over a checkerboard.
- Models: W3D in 3D, with their skeleton and textures found in any archive.
  Animations of the skeleton are listed and play on the model (dense,
  time-coded, adaptive-delta and motion channels); a skeleton or an
  animation file on its own shows its bones.

**Interface movies (APT)**

- Every character drawn with its shapes, textures and text; sprites play
  frame by frame.
- Edit text fields, colours, bounds, exports, imports, placements, frame
  labels and frames, add frames, duplicate characters and create new text,
  sprite, shape and image characters, with undo.
- Create whole new movies (**New APT Movie…** on a folder): an `.apt`,
  `.const` and `.dat` with exported empty sprites, ready for a root movie to
  import with **Add import** in its movie panel.
- ActionScript as a small JavaScript-like language, editable and compiled
  back to bytecode; see [docs/apt-scripts.md](docs/apt-scripts.md). A script
  is only offered once compiling it is checked to give back the same code,
  and blocks you do not change keep their bytes as shipped.

## Development

    npm install
    npm run compile
    npm test          # unit tests, then the VS Code integration suite

Tests build their own archives in code; no game file is ever committed.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
