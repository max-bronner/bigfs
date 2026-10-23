# bigFS

Browse and edit the BIG archives of the SAGE-engine games (*The Battle for
Middle-earth*, *The Battle for Middle-earth II*, *The Rise of the
Witch-king*, *Command & Conquer: Generals*) directly in VS Code, with
language support for their INI dialect.

bigFS ships no game content. Open a folder holding your own installation or
your mod's archives.

## Features

- **BIG Archives view** in the explorer: every `.big` file in the workspace,
  browsable as folders.
- **Edit in place:** open, save, create, rename, move, copy, delete and
  drag and drop files inside an archive. Each save rewrites the archive
  safely through a temporary file.
- **Extract** files, folders or whole archives to disk, and **add** files
  from disk.
- **SAGE INI language support** for `.ini`, `.inc` and `.bhav`: syntax
  highlighting, outline, folding, hover, completion, go to definition and
  find references across every archive, `#include` links and `#define`
  macros.

## Development

    npm install
    npm run compile
    npm test          # unit tests, then the VS Code integration suite

Tests build their own archives in code; no game file is ever committed.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
