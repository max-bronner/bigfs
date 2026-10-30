import * as vscode from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import { createLineReader, resolveSlots } from '../../services/ini/commandSetPreview';
import { hotkeyClashes } from '../../game/ini-tools/hotkeys';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';

/**
 * Warns on CommandSet slots whose buttons share a hotkey, in every open INI
 * file: the game takes the first and the other cannot be pressed from the
 * keyboard. The hotkey is the letter after `&` in the button's game text.
 */

const DELAY_MS = 500;

/** Creates the watcher that checks open INI files for hotkey clashes as they change */
export const watchHotkeyClashes = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable => {
  const collection =
    vscode.languages.createDiagnosticCollection('sage-ini-hotkeys');
  const pending = new Map<string, NodeJS.Timeout>();

  const check = async (document: vscode.TextDocument) => {
    if (document.languageId !== SAGE_INI_LANGUAGE) {
      return;
    }

    const version = document.version;
    const parsed = await documents.parse(document);
    const sets = parsed.blocks.filter((block) =>
      /^commandset$/i.test(block.keyword),
    );

    if (!sets.length) {
      collection.delete(document.uri);
      return;
    }
    await index.whenReady();

    const linesOf = createLineReader();
    const diagnostics: vscode.Diagnostic[] = [];

    for (const set of sets) {
      const slots = parsed.statements
        .filter(
          (statement) =>
            statement.line > set.startLine &&
            statement.line < set.endLine &&
            /^\d+$/.test(statement.keyword.text) &&
            statement.values[0],
        )
        .map((statement) => ({
          slot: Number(statement.keyword.text),
          button: statement.values[0].text,
          token: statement.values[0],
          line: statement.line,
        }));
      const resolved = await resolveSlots(index, slots, linesOf);
      const clashes = hotkeyClashes(resolved);

      resolved.forEach((slot, place) => {
        const others = clashes.get(slot.slot);

        if (!others) {
          return;
        }

        const { token, line } = slots[place];
        const names = others
          .map(
            (other) =>
              `${other} (${resolved.find((each) => each.slot === other)?.button})`,
          )
          .join(', ');
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(line, token.start, line, token.end),
          `Hotkey '${slot.hotkey}' is also used by slot ${names}`,
          vscode.DiagnosticSeverity.Warning,
        );

        diagnostic.source = 'bigFS';
        diagnostics.push(diagnostic);
      });
    }
    if (!document.isClosed && document.version === version) {
      collection.set(document.uri, diagnostics);
    }
  };

  const checkSoon = (document: vscode.TextDocument) => {
    const key = document.uri.toString();

    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        void check(document).catch(() => undefined);
      }, DELAY_MS),
    );
  };

  vscode.workspace.textDocuments.forEach(checkSoon);

  const subscriptions = [
    collection,
    vscode.workspace.onDidOpenTextDocument(checkSoon),
    vscode.workspace.onDidChangeTextDocument(({ document }) =>
      checkSoon(document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) =>
      collection.delete(document.uri),
    ),
  ];

  return {
    dispose: () => {
      pending.forEach((timeout) => clearTimeout(timeout));
      subscriptions.forEach((subscription) => subscription.dispose());
    },
  };
};
