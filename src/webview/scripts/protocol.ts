import type { ScriptTreeNode } from '../shared/scriptTreeText';

/** The messages the script viewer's page and its editor exchange */

/** What the page sends */
export type FromScriptsPage =
  | { kind: 'ready' }
  | { kind: 'playSound'; name: string };

/** What the editor sends */
export interface ScriptsMessage {
  kind: 'scripts';
  name: string | undefined;
  scripts: ScriptTreeNode[][];
  problems: string[];
}
