import { Diagnostic, DiagnosticSeverity, Range, workspace } from 'vscode';
import type { EntryLocator } from '../formats/entryLocator';
import { closestNames } from './model/sageIniFormat';
import {
  findAssetReferences,
  missingAssetMessage,
} from './model/sageIniAssets';
import type { AssetKind } from './model/sageIniAssets';
import type { SageDocument } from './model/sageIniParser';

/**
 * Reports models, animations, textures and sounds an INI file names that no
 * archive or folder holds, the commonest cause of a mod that crashes on
 * load or shows nothing. Off unless the base game's files are in reach,
 * where a missing name is a mistake rather than a file the workspace lacks.
 */

export const CHECK_ASSETS_SETTING = 'bigfs.ini.checkAssets';

/** `.w3d` files the base game alone ships many more of */
const AUTO_MINIMUM_MODELS = 200;

const EXTENSIONS: Record<AssetKind, RegExp> = {
  model: /\.w3d$/,
  animation: /\.w3d$/,
  texture: /\.(dds|tga|jpg|png)$/,
  sound: /\.(wav|mp3)$/,
};

/** Per file-name set: the stems of each kind, for suggestions */
const stemCache = new WeakMap<Set<string>, Map<AssetKind, string[]>>();

const stemsOf = (names: Set<string>, kind: AssetKind): string[] => {
  let byKind = stemCache.get(names);

  if (!byKind) {
    byKind = new Map();
    stemCache.set(names, byKind);
  }

  let stems = byKind.get(kind);

  if (!stems) {
    stems = [
      ...new Set(
        [...names]
          .filter((name) => EXTENSIONS[kind].test(name))
          .map((name) => name.replace(/\.[^.]*$/, '')),
      ),
    ];
    byKind.set(kind, stems);
  }
  return stems;
};

/** Whether references are checked, given the setting and what is in reach */
export const shouldCheckAssets = (names: Set<string>): boolean => {
  const mode = workspace
    .getConfiguration()
    .get<'auto' | 'on' | 'off'>(CHECK_ASSETS_SETTING, 'auto');

  if (mode !== 'auto') {
    return mode === 'on';
  }

  let models = 0;

  for (const name of names) {
    if (name.endsWith('.w3d') && ++models >= AUTO_MINIMUM_MODELS) {
      return true;
    }
  }
  return false;
};

/** A warning for every file reference no archive or folder satisfies */
export const getAssetDiagnostics = (
  parsed: SageDocument,
  names: Set<string>,
  source: string,
): Diagnostic[] =>
  findAssetReferences(parsed)
    .filter((reference) =>
      reference.candidates.every((candidate) => !names.has(candidate)),
    )
    .map((reference) => {
      // A model or animation suggests stems; the rest suggest written names
      const written = reference.name.replace(/^.*[\\/]/, '');
      const prefix =
        reference.kind === 'animation'
          ? written.slice(0, written.lastIndexOf('.') + 1)
          : '';
      const asWritten = written.slice(prefix.length);
      const extension = /\.[^.]*$/.exec(asWritten)?.[0] ?? '';
      const suggestions = closestNames(
        asWritten.slice(0, asWritten.length - extension.length).toLowerCase(),
        stemsOf(names, reference.kind),
      ).map((stem) => `${prefix}${stem}${extension}`);
      const diagnostic = new Diagnostic(
        new Range(
          reference.line,
          reference.start,
          reference.line,
          reference.end,
        ),
        missingAssetMessage(reference, suggestions),
        DiagnosticSeverity.Warning,
      );

      diagnostic.source = source;
      return diagnostic;
    });

/** The names the locator knows, when references should be checked at all */
export const assetNamesToCheck = async (
  locator: EntryLocator | undefined,
): Promise<Set<string> | undefined> => {
  if (!locator) {
    return undefined;
  }

  const names = await locator.fileNames();

  return shouldCheckAssets(names) ? names : undefined;
};
