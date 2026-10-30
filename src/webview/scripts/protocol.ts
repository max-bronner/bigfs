import type { ScriptTreeNode } from '../shared/scriptTreeText';

/** The messages the script viewer's page and its editor exchange */

/** Messages the script viewer's page sends to its editor */
export type FromScriptsPage =
  | { kind: 'ready' }
  | { kind: 'playSound'; name: string };

/** Message the editor sends with the scripts read from the open file */
export interface ScriptsMessage {
  kind: 'scripts';
  name: string | undefined;
  scripts: ScriptTreeNode[][];
  problems: string[];
}
