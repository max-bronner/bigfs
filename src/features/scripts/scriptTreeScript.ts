/**
 * Page code that draws a map's scripts as a tree: players, groups, scripts
 * with their conditions and actions, a play button after every sound
 * parameter. The page defines \`vscode\` and \`element\` first; this is used
 * by the map editor and by the viewer for standalone \`.scb\` files.
 */
export const SCRIPT_TREE_SCRIPT = /* js */ `
/** The scripts of every player as a collapsible tree; \`options.editable\` lets the active boxes change them */
const scriptTree = (lists, sides, options) => {
  const scripts = element('details');
  const count = (nodes) => nodes.reduce((sum, node) => sum + (node.kind === 'group' ? count(node.children) : 1), 0);
  scripts.append(element('summary', 'Scripts (' + lists.reduce((sum, list) => sum + count(list), 0) + ')'));
  /** A call as text, a play button after each parameter that names a sound */
  const callNodes = (call) => {
    const nodes = [document.createTextNode(call.name + (call.parameters.length ? '(' : ''))];
    call.parameters.forEach((parameter, at) => {
      if (at) nodes.push(document.createTextNode(', '));
      nodes.push(document.createTextNode(parameter));
      if ((call.sounds || []).includes(at)) {
        const play = element('button', '▶', 'play');
        play.title = 'Play ' + parameter;
        play.onclick = () => vscode.postMessage({ kind: 'playSound', name: parameter });
        nodes.push(play);
      }
    });
    if (call.parameters.length) nodes.push(document.createTextNode(')'));
    return nodes;
  };
  const joined = (calls, separator) => calls.flatMap((call, at) => [...(at ? [document.createTextNode(separator)] : []), ...callNodes(call)]);
  const calls = (title, list) => list.length ? [document.createTextNode(title + ' '), ...joined(list, '; ')] : [];
  const render = (nodes, parent) => {
    for (const node of nodes) {
      const box = element('input');
      box.type = 'checkbox';
      box.checked = node.active;
      box.title = 'Active';
      box.disabled = !options.editable;
      box.onchange = () => vscode.postMessage({ kind: 'edit', edit: { kind: 'scriptActive', at: node.activeAt, active: box.checked } });
      if (node.kind === 'group') {
        const group = element('details', undefined, 'script');
        const summary = element('summary');
        summary.append(box, document.createTextNode(' ' + node.name + (node.subroutine ? ' (subroutine)' : '')));
        group.append(summary);
        render(node.children, group);
        parent.append(group);
      } else {
        const item = element('div', undefined, 'script');
        const label = element('label');
        label.append(box, document.createTextNode(node.name + (node.oneShot ? ' · once' : '') + (node.subroutine ? ' · subroutine' : '') + (node.difficulties.length < 3 ? ' · ' + node.difficulties.join('/') : '')));
        if (node.comment) label.title = node.comment;
        const detail = element('div', undefined, 'calls');
        const parts = [
          node.conditions.length ? [document.createTextNode('IF '), ...node.conditions.flatMap((and, at) => [...(at ? [document.createTextNode(' OR ')] : []), ...joined(and, ' AND ')])] : [],
          calls('THEN', node.actions),
          calls('ELSE', node.actionsFalse),
        ].filter((part) => part.length);
        parts.forEach((part, at) => {
          if (at) detail.append(document.createTextNode(' · '));
          detail.append(...part);
        });
        item.append(label, detail);
        parent.append(item);
      }
    }
  };
  lists.forEach((list, slot) => {
    if (!list.length) return;
    const side = sides && sides[slot];
    const owner = side && side.find((entry) => entry.key === 'playerName');
    const player = element('details');
    player.append(element('summary', (owner && owner.value.value ? owner.value.value : (sides ? 'Player ' : 'Script list ') + (slot + 1)) + ' (' + count(list) + ')'));
    render(list, player);
    scripts.append(player);
  });
  return scripts;
};
`;

/** Page code of the viewer for standalone `.scb` files */
export const SCRIPT_FILE_VIEW_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
${SCRIPT_TREE_SCRIPT}
window.addEventListener('message', ({ data }) => {
  if (data.kind !== 'scripts') return;
  const root = document.getElementById('root');
  root.replaceChildren(element('h2', data.name));
  if (data.scripts.some((list) => list.length)) {
    const tree = scriptTree(data.scripts, undefined, { editable: false });
    tree.open = true;
    root.append(tree);
  } else {
    root.append(element('p', 'This file holds no scripts.', 'muted'));
  }
  data.problems.forEach((problem) => root.append(element('p', problem, 'problems')));
});
vscode.postMessage({ kind: 'ready' });
`;

