# Changelog

## Unreleased

- BIG archive explorer with editing, extraction and import; saves keep the
  archive as shipped (names, duplicates, header, trailer).
- Safety: entry names that would escape an extraction folder are refused.
- SAGE INI language support on the games' own grammar, with diagnostics,
  whole-workspace validation, game text on hover and rename.
- Previews for TGA, DDS, WAV and W3D files.
- Mod workflow: pack a folder, override archive files, search archives.
- APT movie editing: text fields, colours, bounds, exports and imports,
  placements, frame labels, frames and duplicated characters, with undo;
  untouched bytes are kept as shipped.
- APT ActionScript as an editable JavaScript-like language, checked to
  compile back to the same code before it is shown; hot-exit backups keep
  movie edits.
- APT timeline panel: tweens with easings, per-property formulas, fading,
  removing and showing for a range, and inserting, deleting, duplicating,
  reversing and retiming frames; onion skin.
- Particle preview: colour, alpha and size curves over a particle's life,
  with draggable, addable and removable keys.
- Particle preview: handles on the emission volume to size it in the view.
- Particle system templates: fire, smoke, sparks, dust cloud, magic glow, flash.
- FX list timeline in the particle preview: nugget bars, mute and solo, drag to delay.
- Particle preview load stats: peaks, averages, per system, fill, detail-level budgets.
- Bulk Edit INI Values: formula changes across matching blocks, reviewed as a diff.
- Effective definition view for ChildObject and ObjectReskin lineages.
- Package Mod: pack with a load-order override report against the base game.
- New Unit, Hero or Building wizard: object, build button, command set slot and text in one go.
- Check Translations: labels each language lacks, filled with stand-in text on request.
- APT timeline recognises baked tweens and edits them as one.
- APT motion scripts: a timeline as a few CSS-like lines, baked into frames.
- APT copy and paste motion, mirrored on request.
- Particle preview: scale a whole effect in size and time.
- Particle preview: A/B against the written values, random variations, save as a variant.
- Particle preview on a model, started at one of its bones.
- Edit W3D Animation: retime, reverse, ease, trim and rate, written as a new animation.
- Armor Table: every armor against every damage type, edited in place.
- CommandSet editor: drag buttons between slots, clear and add.
- Balance sheet: damage-a-second column.
- Compare with Base Game lists INI changes definition by definition and value by value.
- Links between formats: model, animation and texture names in INI open the file in its viewer; the W3D viewer lists the INI lines using the file, and an animation plays on the model its object's INI names.
- Object preview: "Preview object" and "Preview state" lenses, and "Preview on the object" on animation, FX and ParticleSysBone lines. Shows the composed object's model, plays its animations, and runs its FX and bone particle systems on it, each with a toggle.
- One model renderer for the W3D viewer and the particle preview: the particle preview now shows the model textured and lit. Bones toggle with B.
- W3D viewer: an animation file plays on the model drawn on its skeleton, found by name; bones stay a toggle.
- Fix: an FX list's ParticleSystem and Sound nuggets' Name goes to its definition, finds references and is checked.
- APT playback speed from 0.05× to 8× of the game's 30 frames a second, `[` and `]` to change it.
- String tables: `.str` language support and table editor, `.csf` editor,
  and conversion between the two.
- Map editor for `.map` and `.bse`: terrain relief with objects and start
  positions, world info, time of day, players and object properties, with
  RefPack compression both ways.
- W3D animation playback on models and skeletons.
- `.wnd` window layouts: language support and a live layout preview.
- MP3 and VP6 video previews.
- Texture round trips: export TGA/DDS as PNG, replace a texture from a PNG,
  convert PNGs to TGA or DDS.
- Compare a mod with the base game: added, changed and unchanged files with
  diffs.
- Fixed: flaky extraction tests that read an archive a watcher had just reset.
- INI quick fixes, a formatter, and MappedImage hovers that show the image.
- Maps: teams, scripts (switch on/off), trigger areas and lighting edits.
- APT: create new text, sprite, shape and image characters.
- APT: create new movies with exported sprites, and add or remove imports so
  root movies can use them.
- Lua syntax checking inside INI script regions.
- Missing models, animations, textures and sounds reported in INI files,
  with quick fixes.
- Particle preview for particle systems and FX lists, with a slider for
  every value and Apply to INI.
- Launch Game with Mod, with a Run mod status bar button.
- Convert videos and image frames to VP6 movies.
- VP6 conversion codes inter frames with motion search and tuned
  probabilities, about 3 times smaller.
- Find Unused Definitions.
- Hotkey clashes inside CommandSets reported.
- Call and type hierarchy for INI definitions.
- Balance sheet of every unit's numbers, editable in place.
- Duplicate Definition, with its game text copied.
- Missing game-text labels reported, with a fix that adds them.
- CommandSet hover with the button icons, labels and commands.
- Play audio events and sounds from INI files.
