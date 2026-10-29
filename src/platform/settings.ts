import { workspace } from 'vscode';
import type { Disposable } from 'vscode';
import { createSettings } from './createSettings';

/** The `bigfs.*` settings, one typed accessor each */
export const settings = createSettings(() => workspace.getConfiguration());

/** Calls the listener whenever any of the settings changes in the user's configuration */
export const onDidChangeSetting = (
  changed: ReadonlyArray<{ readonly key: string }>,
  listener: () => void,
): Disposable =>
  workspace.onDidChangeConfiguration((event) => {
    if (changed.some(({ key }) => event.affectsConfiguration(key))) {
      listener();
    }
  });
