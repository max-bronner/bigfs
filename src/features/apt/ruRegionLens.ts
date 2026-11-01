import * as vscode from 'vscode';
import {
  findRuStyleLines,
  getRunTextureBox,
  parseRu,
} from '../../formats/apt/aptGeometry';

/**
 * A lens over each texture style of a shape's `.ru` file that says which part
 * of its image the run samples and opens the texture with that box drawn on
 * it. Geometry files have no language of their own, so the lens is attached by
 * file name.
 */

const SELECTOR: vscode.DocumentSelector = { pattern: '**/*.ru' };

const describeBox = ([left, top, right, bottom]: number[]) =>
  `${Math.round(left)},${Math.round(top)} to ${Math.round(right)},${Math.round(bottom)} (${Math.round(right - left)}×${Math.round(bottom - top)})`;

/** Registers the lens on `.ru` texture styles */
export const registerRuRegionLens = (): vscode.Disposable =>
  vscode.languages.registerCodeLensProvider(SELECTOR, {
    provideCodeLenses(document) {
      const text = document.getText();
      let runs: ReturnType<typeof parseRu>;

      try {
        runs = parseRu(text);
      } catch {
        return [];
      }
      return findRuStyleLines(text).flatMap((line, index) => {
        const run = runs[index];
        const box = run && getRunTextureBox(run);

        return run?.style.kind === 'texture' && box
          ? [
              new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
                title: `Samples image #${run.style.character}, ${describeBox(box)}: show in texture`,
                command: 'bigfs.showRuRegion',
                arguments: [document.uri, line],
              }),
            ]
          : [];
      });
    },
  });
