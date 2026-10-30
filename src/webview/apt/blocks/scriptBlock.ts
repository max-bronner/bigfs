import type { AptEdit } from '../../../formats/apt/writer/aptEdit';
import type { FromPage, ToPage } from '../protocol';
import { send } from '../details';
import { getVsCodeApi } from '../../shared/vscodeApi';
import { state } from '../state';
import { blockCard } from './blockCard';
import { action, createField } from './controls';
import { scriptField } from './scriptField';

const vscode = getVsCodeApi<FromPage>();

/**
 * A script block: where the script runs, then its decompiled text as code,
 * edited in place. The text arrives from the extension when the block is
 * opened; "Open in tab" gives it an editor of its own.
 */

/** A script and where it runs, as a script block shows it */
export interface ScriptSite {
  /** When it runs, such as `frame 3` or `on press` */
  label: string;
  /** The block's offset in the `.apt` */
  block: number;
  /** The tab title, and where the script belongs */
  tab: string;
  /** The edit that detaches it; absent when it cannot be detached here */
  remove?: AptEdit;
  /** The controls that set when it runs, for a script on a button condition */
  when?: () => HTMLElement;
  /** What `when` is called; "When" for a condition, "Does" for what a frame script does */
  whenLabel?: string;
  onMove?: (by: -1 | 1) => void;
  open?: boolean;
}

/** The element of an open script block that the text is loaded into */
const host = (block: number): Element | null =>
  document.querySelector(`#details [data-script-block="${block}"]`);

/** Creates the block of a script; its text is asked of the extension when the block opens */
export const scriptBlock = (site: ScriptSite): HTMLElement => {
  const open = action(
    '↗ Open in tab',
    () =>
      vscode.postMessage({
        kind: 'openScript',
        block: site.block,
        label: site.tab,
      }),
    'Open this script in its own editor tab',
  );
  const remove = site.remove;

  open.classList.add('bk-link');
  // A control in the header acts; it does not fold the card
  open.addEventListener('click', (event) => event.stopPropagation());
  return blockCard({
    key: `script:${site.block}`,
    kind: 'script',
    title: site.label,
    summary: '0x' + site.block.toString(16),
    open: site.open,
    actions: [open],
    onMove: site.onMove,
    onRemove: remove && (() => send(remove)),
    body: () => {
      const placeholder = document.createElement('div');

      placeholder.className = 'bk-script-host';
      placeholder.dataset.scriptBlock = String(site.block);
      placeholder.textContent = '…';
      return [
        ...(site.when ? [createField(site.whenLabel ?? 'When', site.when())] : []),
        placeholder,
      ];
    },
    onOpen: () => vscode.postMessage({ kind: 'script', block: site.block }),
  });
};

/** Fills an open script block with the decoded text */
export const showScript = (data: Extract<ToPage, { kind: 'script' }>): void => {
  host(data.block)?.replaceChildren(
    scriptField({
      block: data.block,
      text: data.text,
      mode: data.mode,
      note: data.note,
      onCommit: (text) =>
        vscode.postMessage({ kind: 'scriptEdit', block: data.block, text }),
    }),
  );
};

/** Carries a script's card over, open, to the new block the script was compiled into */
export const scriptSaved = (previous: number, block: number): void => {
  state.drafts.delete(previous);
  state.cards.delete(`script:${previous}`);
  state.cards.set(`script:${block}`, true);
};
