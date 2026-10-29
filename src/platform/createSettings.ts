import type { WorkspaceConfiguration } from 'vscode';

/** The values of the `bigfs.*` settings that are one of a few words */
export type CheckMode = 'auto' | 'on' | 'off';
export type SageGameId = 'rotwk' | 'bfme2' | 'bfme1';
export type ExplorerView = 'archives' | 'game';

/** The part of `workspace.getConfiguration()` the settings read and write through */
export type ConfigurationSource = () => Pick<
  WorkspaceConfiguration,
  'get' | 'update'
>;

/** One contributed setting: reads its value, falling back to the contributed default */
export interface Setting<Value> {
  /** The key as `package.json` contributes it */
  readonly key: string;
  /** The value when the user has set nothing */
  readonly defaultValue: Value;
  get: () => Value;
  /** Writes the value to the given configuration target, or the default one */
  update: (value: Value, target?: number | boolean) => Thenable<void>;
}

const defineSetting =
  (source: ConfigurationSource) =>
  <Value>(key: string, defaultValue: Value): Setting<Value> => ({
    key,
    defaultValue,
    get: () => source().get<Value>(key, defaultValue),
    update: (value, target) => source().update(key, value, target),
  });

/**
 * Builds one typed accessor per setting `package.json` contributes. The
 * defaults repeat the contributed ones, which the unit test compares.
 */
export const createSettings = (source: ConfigurationSource) => {
  const define = defineSetting(source);

  return {
    iniGame: define<SageGameId>('bigfs.ini.game', 'rotwk'),
    iniCheckReferences: define<CheckMode>('bigfs.ini.checkReferences', 'auto'),
    iniCheckAssets: define<CheckMode>('bigfs.ini.checkAssets', 'auto'),
    iniCheckStrings: define<CheckMode>('bigfs.ini.checkStrings', 'auto'),
    language: define<string>('bigfs.language', 'auto'),
    explorerView: define<ExplorerView>('bigfs.explorer.view', 'archives'),
    baseGameFolder: define<string>('bigfs.baseGameFolder', ''),
    underlyingGameFolder: define<string>('bigfs.underlyingGameFolder', ''),
    gameExecutable: define<string>('bigfs.game.executable', ''),
    gameArguments: define<string[]>('bigfs.game.arguments', []),
    ffmpegPath: define<string>('bigfs.ffmpegPath', ''),
    vp6KeyFrameSeconds: define<number>('bigfs.vp6.keyFrameSeconds', 2),
  };
};
