import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  commands,
  window,
} from 'vscode';
import type { EntryLocator } from '../entryLocator';
import { settings } from '../../platform/settings';
import { decideAssetCheck } from '../../game/ini-tools/assetCheckPolicy';
import { findClosestNames } from '../../formats/ini/sageIniFormat';
import {
  findAssetReferences,
  formatMissingAssetMessage,
} from '../../formats/ini/sageIniAssets';
import type { AssetKind } from '../../formats/ini/sageIniAssets';
import type { SageDocument } from '../../formats/ini/sageIniParser';

/**
 * Reports models, animations, textures and sounds an INI file names that no
 * archive or folder holds, the commonest cause of a mod that crashes on
 * load or shows nothing. Off unless the base game's files are in reach,
 * where a missing name is a mistake rather than a file the workspace lacks;
 * with no base game folder configured it switches itself off and says so
 * once (`assetCheckPolicy`).
 */

/** File names each kind of asset can be, for suggesting a near miss */
const EXTENSIONS: Record<AssetKind, RegExp> = {
  model: /\.w3d$/,
  animation: /\.w3d$/,
  texture: /\.(dds|tga|jpg|png)$/,
  sound: /\.(wav|mp3)$/,
};

/** Per file-name set: the stems of each kind, for suggestions */
const stemCache = new WeakMap<Set<string>, Map<AssetKind, string[]>>();

const listStems = (names: Set<string>, kind: AssetKind): string[] => {
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

let hasHinted = false;

/** Says once per session why the check is off for want of a base game folder */
const hintNoBaseGame = () => {
  if (hasHinted) {
    return;
  }
  hasHinted = true;
  void window
    .showInformationMessage(
      'bigFS: missing-asset checks are off because no base game folder is set, so every texture and model your mod borrows would be flagged. Set "bigfs.baseGameFolder" to turn them on.',
      'Open Setting',
    )
    .then((choice) => {
      if (choice) {
        void commands.executeCommand(
          'workbench.action.openSettings',
          settings.baseGameFolder.key,
        );
      }
    });
};

/** Whether references are checked, given the setting and what is in reach */
export const shouldCheckAssets = (names: Set<string>): boolean => {
  const mode = settings.iniCheckAssets.get();
  let models = 0;

  if (mode === 'auto') {
    for (const name of names) {
      if (name.endsWith('.w3d')) {
        models++;
      }
    }
  }

  const decision = decideAssetCheck(
    mode,
    Boolean(settings.baseGameFolder.get().trim()),
    models,
  );

  if (decision === 'no-base-game') {
    hintNoBaseGame();
  }
  return decision === 'check';
};

/** Builds a warning for every file reference no archive or folder satisfies */
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
      const suggestions = findClosestNames(
        asWritten.slice(0, asWritten.length - extension.length).toLowerCase(),
        listStems(names, reference.kind),
      ).map((stem) => `${prefix}${stem}${extension}`);
      const diagnostic = new Diagnostic(
        new Range(
          reference.line,
          reference.start,
          reference.line,
          reference.end,
        ),
        formatMissingAssetMessage(reference, suggestions),
        DiagnosticSeverity.Warning,
      );

      diagnostic.source = source;
      return diagnostic;
    });

/** Gets the file names the locator knows, or nothing when references should not be checked at all */
export const getAssetNamesToCheck = async (
  locator: EntryLocator | undefined,
): Promise<Set<string> | undefined> => {
  if (!locator) {
    return undefined;
  }

  const names = await locator.getFileNames();

  return shouldCheckAssets(names) ? names : undefined;
};

/**
 * Builds the asset warnings for one open document, looking on disk again before
 * reporting a name missing, in case the locator never heard of the file
 */
export const getCheckedAssetDiagnostics = async (
  parsed: SageDocument,
  locator: EntryLocator | undefined,
  source: string,
): Promise<Diagnostic[]> => {
  let names = await getAssetNamesToCheck(locator);

  if (!names) {
    return [];
  }

  const missing = () =>
    findAssetReferences(parsed).filter((reference) =>
      reference.candidates.every((candidate) => !names!.has(candidate)),
    );
  const first = missing();

  if (
    first.length &&
    (await locator!.recheck(first.flatMap((reference) => reference.candidates)))
  ) {
    names = await locator!.getFileNames();
  }
  return getAssetDiagnostics(parsed, names, source);
};
