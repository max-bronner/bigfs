import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  commands,
  window,
  workspace,
} from 'vscode';
import type { EntryLocator } from '../formats/entryLocator';
import { BASE_SETTING } from '../model/baseGameFolders';
import { decideAssetCheck } from './model/assetCheckPolicy';
import type { AssetCheckMode } from './model/assetCheckPolicy';
import { closestNames } from '../formats/ini/sageIniFormat';
import {
  findAssetReferences,
  missingAssetMessage,
} from '../formats/ini/sageIniAssets';
import type { AssetKind } from '../formats/ini/sageIniAssets';
import type { SageDocument } from '../formats/ini/sageIniParser';

/**
 * Reports models, animations, textures and sounds an INI file names that no
 * archive or folder holds, the commonest cause of a mod that crashes on
 * load or shows nothing. Off unless the base game's files are in reach,
 * where a missing name is a mistake rather than a file the workspace lacks;
 * with no base game folder configured it switches itself off and says so
 * once (`assetCheckPolicy`).
 */

export const CHECK_ASSETS_SETTING = 'bigfs.ini.checkAssets';

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

let hinted = false;

/** Says once per session why the check is off for want of a base game folder */
const hintNoBaseGame = () => {
  if (hinted) {
    return;
  }
  hinted = true;
  void window
    .showInformationMessage(
      'bigFS: missing-asset checks are off because no base game folder is set, so every texture and model your mod borrows would be flagged. Set "bigfs.baseGameFolder" to turn them on.',
      'Open Setting',
    )
    .then((choice) => {
      if (choice) {
        void commands.executeCommand(
          'workbench.action.openSettings',
          BASE_SETTING,
        );
      }
    });
};

/** Whether references are checked, given the setting and what is in reach */
export const shouldCheckAssets = (names: Set<string>): boolean => {
  const configuration = workspace.getConfiguration();
  const mode = configuration.get<AssetCheckMode>(CHECK_ASSETS_SETTING, 'auto');
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
    Boolean(configuration.get<string>(BASE_SETTING)?.trim()),
    models,
  );

  if (decision === 'no-base-game') {
    hintNoBaseGame();
  }
  return decision === 'check';
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

/**
 * The asset warnings for one open document, looking on disk again before
 * reporting a name missing, in case the locator never heard of the file
 */
export const checkedAssetDiagnostics = async (
  parsed: SageDocument,
  locator: EntryLocator | undefined,
  source: string,
): Promise<Diagnostic[]> => {
  let names = await assetNamesToCheck(locator);

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
    names = await locator!.fileNames();
  }
  return getAssetDiagnostics(parsed, names, source);
};
