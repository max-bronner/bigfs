import { element } from './element';
import { countScripts, describePlayerList, describeScript } from './scriptTreeText';
import type { ScriptTreeNode, SideEntry, SoundCall } from './scriptTreeText';

/** What the tree does with a click, and whether its active boxes can change a script */
export interface ScriptTreeOptions {
  editable: boolean;
  onPlaySound(name: string): void;
  onSetActive(at: number, active: boolean): void;
}

/** A call as text, with a play button after each parameter that names a sound. */
const callNodes = (call: SoundCall, options: ScriptTreeOptions): Node[] => {
  const nodes: Node[] = [
    document.createTextNode(call.name + (call.parameters.length ? '(' : '')),
  ];

  call.parameters.forEach((parameter, at) => {
    if (at) {
      nodes.push(document.createTextNode(', '));
    }
    nodes.push(document.createTextNode(parameter));
    if ((call.sounds ?? []).includes(at)) {
      const play = element('button', '▶', 'play');

      play.title = `Play ${parameter}`;
      play.onclick = () => options.onPlaySound(parameter);
      nodes.push(play);
    }
  });
  if (call.parameters.length) {
    nodes.push(document.createTextNode(')'));
  }
  return nodes;
};

const joined = (
  calls: SoundCall[],
  separator: string,
  options: ScriptTreeOptions,
): Node[] =>
  calls.flatMap((call, at) => [
    ...(at ? [document.createTextNode(separator)] : []),
    ...callNodes(call, options),
  ]);

const callsAfter = (
  title: string,
  list: SoundCall[],
  options: ScriptTreeOptions,
): Node[] =>
  list.length
    ? [document.createTextNode(`${title} `), ...joined(list, '; ', options)]
    : [];

const renderNodes = (
  nodes: readonly ScriptTreeNode[],
  parent: HTMLElement,
  options: ScriptTreeOptions,
): void => {
  for (const node of nodes) {
    const box = element('input');

    box.type = 'checkbox';
    box.checked = node.active;
    box.title = 'Active';
    box.disabled = !options.editable;
    box.onchange = () => options.onSetActive(node.activeAt, box.checked);
    if (node.kind === 'group') {
      const group = element('details', undefined, 'script');
      const summary = element('summary');

      summary.append(
        box,
        document.createTextNode(
          ` ${node.name}${node.subroutine ? ' (subroutine)' : ''}`,
        ),
      );
      group.append(summary);
      renderNodes(node.children as ScriptTreeNode[], group, options);
      parent.append(group);
    } else {
      const item = element('div', undefined, 'script');
      const label = element('label');

      label.append(box, document.createTextNode(describeScript(node)));
      if (node.comment) {
        label.title = node.comment;
      }
      const detail = element('div', undefined, 'calls');
      const parts = [
        node.conditions.length
          ? [
              document.createTextNode('IF '),
              ...node.conditions.flatMap((and, at) => [
                ...(at ? [document.createTextNode(' OR ')] : []),
                ...joined(and, ' AND ', options),
              ]),
            ]
          : [],
        callsAfter('THEN', node.actions, options),
        callsAfter('ELSE', node.actionsFalse, options),
      ].filter((part) => part.length);

      parts.forEach((part, at) => {
        if (at) {
          detail.append(document.createTextNode(' · '));
        }
        detail.append(...part);
      });
      item.append(label, detail);
      parent.append(item);
    }
  }
};

/**
 * Draws the scripts of every player as a collapsible tree, with a play button
 * after every sound parameter. `sides` names the players when the map has them.
 */
export const createScriptTree = (
  lists: readonly (readonly ScriptTreeNode[])[],
  sides: readonly (readonly SideEntry[])[] | undefined,
  options: ScriptTreeOptions,
): HTMLDetailsElement => {
  const scripts = element('details');

  scripts.append(
    element(
      'summary',
      `Scripts (${lists.reduce((sum, list) => sum + countScripts(list), 0)})`,
    ),
  );
  lists.forEach((list, slot) => {
    if (!list.length) {
      return;
    }
    const player = element('details');

    player.append(
      element(
        'summary',
        describePlayerList(list, sides?.[slot], slot, sides !== undefined),
      ),
    );
    renderNodes(list, player, options);
    scripts.append(player);
  });
  return scripts;
};
