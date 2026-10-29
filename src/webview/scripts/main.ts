import { element } from '../shared/element';
import { createScriptTree } from '../shared/scriptTree';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromScriptsPage, ScriptsMessage } from './protocol';

/** The viewer for standalone `.scb` files: the script tree, read-only. */

const vscode = getVsCodeApi<FromScriptsPage>();
const root = document.getElementById('root')!;

window.addEventListener('message', ({ data }: MessageEvent<ScriptsMessage>) => {
  if (data.kind !== 'scripts') {
    return;
  }
  root.replaceChildren(element('h2', data.name));
  if (data.scripts.some((list) => list.length)) {
    const tree = createScriptTree(data.scripts, undefined, {
      editable: false,
      onPlaySound: (name) => vscode.postMessage({ kind: 'playSound', name }),
      onSetActive: () => undefined,
    });

    tree.open = true;
    root.append(tree);
  } else {
    root.append(element('p', 'This file holds no scripts.', 'muted'));
  }
  data.problems.forEach((problem) =>
    root.append(element('p', problem, 'problems')),
  );
});
vscode.postMessage({ kind: 'ready' });
