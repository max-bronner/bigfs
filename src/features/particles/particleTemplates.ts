import * as vscode from 'vscode';
import { findParticleDefinitions } from '../../formats/particles/particleIni';
import {
  PARTICLE_TEMPLATES,
  templateSnippet,
} from '../../formats/particles/particleTemplates';

/** The command that inserts a particle system template into an INI file */

/** A definition name not used in the text yet */
const freeName = (text: string, base: string): string => {
  const used = new Set(
    findParticleDefinitions(text).map((each) => each.name.toLowerCase()),
  );
  let name = base;

  for (let count = 2; used.has(name.toLowerCase()); count++) {
    name = `${base}${count}`;
  }
  return name;
};

/**
 * Inserts a template into the active INI file: after the definition the
 * cursor is in, or at the cursor's line
 */
export const registerParticleTemplates = (): vscode.Disposable =>
  vscode.commands.registerCommand(
    'bigfs.newParticleSystem',
    /** `label` picks a template without asking, for automation */
    async (label?: string) => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }

      const named = PARTICLE_TEMPLATES.find(
        (template) => template.label === label,
      );
      const choice = named
        ? { template: named, label: named.label }
        : await vscode.window.showQuickPick(
            PARTICLE_TEMPLATES.map((template) => ({
              label: template.label,
              detail: template.detail,
              template,
            })),
            { placeHolder: 'Start a particle system from…' },
          );

      if (!choice) {
        return;
      }

      const document = editor.document;
      const text = document.getText();
      const line = editor.selection.active.line;
      const inside = findParticleDefinitions(text).find(
        (each) => each.startLine <= line && line <= each.endLine,
      );
      const at = inside ? inside.endLine + 1 : line;
      const position =
        at < document.lineCount
          ? new vscode.Position(at, 0)
          : document.lineAt(document.lineCount - 1).range.end;
      // A blank line between it and the text above, and a line break at the very end
      const above = at > 0 && document.lineAt(at - 1).text.trim() !== '';
      const atEnd = at >= document.lineCount;
      const snippet = templateSnippet(
        choice.template,
        freeName(text, `FX_${choice.label.replace(/\s+/g, '')}`),
      );

      await editor.insertSnippet(
        new vscode.SnippetString(
          (atEnd ? '\n' : '') + (above ? '\n' : '') + snippet,
        ),
        position,
      );
    },
  );
