import * as vscode from 'vscode';
import { decodeIniText } from '../../core/windows1252';
import { expandIniIncludes } from '../../formats/ini/expandIniIncludes';
import { isFragmentPath, parseSageIni } from '../../formats/ini/sageIniParser';
import { readHeroSystem, readTopBlocks } from '../../game/objects/cahSystem';
import type { HeroSystem } from '../../game/objects/cahSystem';
import type { EntryLocator } from '../entryLocator';
import type { SageIniDocuments } from './sageIniDocuments';

/**
 * Reads the create-a-hero tables from the first `CreateAHero*.ini` of the
 * install that holds a `CreateAHeroSystem` block, with the `.inc` files it
 * includes (the classes live there). Nothing when the install has none; a file
 * that cannot be read is skipped.
 */
export const readInstalledHeroSystem = async (
  locator: EntryLocator,
  documents: SageIniDocuments,
): Promise<HeroSystem | undefined> => {
  const schema = await documents.getSchema();
  const readLines = async (name: string) => {
    const bytes = await locator.read(name, vscode.Uri.file('/'));

    return bytes && decodeIniText(bytes).split(/\r?\n/);
  };
  const names = await locator.findNames(
    (name) => /^createahero.*\.ini$/.test(name),
    '**/[Cc]reate[Aa][Hh]ero*.ini',
  );

  for (const name of names) {
    const lines = await readLines(name);

    if (!lines) {
      continue;
    }

    const parsed = parseSageIni(
      await expandIniIncludes(lines, (path) =>
        readLines(path.slice(path.search(/[^\\/]*$/))),
      ),
      schema,
      { isFragment: isFragmentPath(name) },
    );
    const blocks = readTopBlocks(parsed, 'CreateAHeroSystem');

    if (blocks.length) {
      return readHeroSystem(blocks);
    }
  }
  return undefined;
};
