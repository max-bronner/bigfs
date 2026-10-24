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
- Lua syntax checking inside INI script regions.
