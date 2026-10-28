# bigFS

A VS Code extension for modding the SAGE-engine *Battle for Middle-earth*
titles: BFME, BFME II and The Rise of the Witch-king. It browses and edits
BIG archives, gives the INI, STR and WND dialects language support, and
previews or edits the game's formats (W3D, APT, maps, textures, audio, VP6).

`docs/architecture.md` describes how it is put together; read the section for
the layer you touch before changing it. `docs/conventions.md` says where new
code goes and what shape it takes, and `docs/refactor-plan.md` lists the waves
moving the code into that layout. `docs/TESTING.md` is the manual test
guide for everything `dev/next` adds over `master`.

## Branches and pull requests

- Work goes on **`dev/next`**. Never commit to or open a PR against `master`.
- One feature or fix per branch, branched from the latest `dev/next`, one PR
  into `dev/next`. Keep PRs narrow so parallel work does not collide; if a
  change needs a file another open PR is rewriting, say so in the PR.
- Commit messages follow the history: `type(scope): what the user gets`, then
  prose paragraphs on why and how (no bullet lists), e.g.
  `fix(apt): keep scripts from breaking the editor (#95)`.
- Add every user-visible feature, command or setting to `docs/TESTING.md`
  (marked **new**) and to `README.md` in the same PR.

## The gate

    npm ci && npm run check-types && npm run lint && npm run test:unit

`npm test` adds the integration suite, which starts VS Code and needs a
display (`xvfb-run -a npm test` on Linux). CI runs all of it. Nothing is done
until the gate passes; new behaviour gets a unit test in `src/test/unit`.

## Non-negotiables

1. **No game content in the repository.** No archives, INI, models, textures,
   movies or sounds cut from the games, not even as test fixtures. Tests build
   synthetic files in code (see `src/test/unit` for the pattern). Grammar,
   field names and format layouts are not content.
2. **Never write to a game installation.** Tools that test against a real
   install read it from a path given at runtime and write only to a temporary
   or user-chosen folder.
3. **Untrusted input.** Every parser bounds allocations by the bytes present,
   never by a header count, caps recursion, and fails with a message instead
   of throwing into the editor.
4. **Sound is opt-in.** Nothing plays audio unless the user asked for it: a
   play button, lens or checkbox, or opening the sound file itself. Previews
   that could play sound (FX, objects, APT movies, maps) start muted.
5. Naming and comments follow the `naming` skill. Read it before naming
   anything.

## Source of truth for game behaviour

**mint2** (`github.com/max-bronner/mint2`, Rust) is the owner's engine
reimplementation; skirmish, the interfaces, the game logic and create-a-hero
work there. Where bigFS and mint2 disagree about a format, an INI field's
type, how the game resolves a file, or how the UI draws, mint2 is right.
Useful crates: `crates/sage/ini` and `ini-coverage` (field tables),
`sage/apt`, `apt-player` (AVM1), `sage/wnd`, `core/ui`, `sage/w3d`,
`sage/map`, `sage/terrain`, `sage/audio`, `sage/str`, `sage/cah`,
`sage/save`, `sage/refpack`, `sage/lua`, `sage/campaign`. mint2 is GPL-3.0;
port behaviour and layouts, and credit it in the commit message as the
existing commits do ("ported from mint's apt-player").
