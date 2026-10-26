import * as vscode from 'vscode';
import { EASINGS } from '../common/expression';
import { parseW3dAnimations } from '../formats/w3dAnimation';
import type { W3dAnimation } from '../formats/w3dAnimation';
import {
  MAX_NAME,
  easeAnimation,
  retimeAnimation,
  reverseAnimation,
  trimAnimation,
  writeW3dAnimation,
} from '../formats/w3dAnimationEdit';

/**
 * **Edit W3D Animation…** on a `.w3d` file, in an archive or a folder:
 * retime, reverse, ease or trim one of its animations, or change its rate,
 * and write the result as a new animation file beside it, named as the
 * game finds it (`<NAME>.w3d`, the header naming it too). The original is
 * left alone, so an INI line switches to the new one by name.
 */

export type AnimationEdit =
  | { op: 'retime'; frames: number }
  | { op: 'reverse' }
  | { op: 'ease'; easing: string }
  | { op: 'trim'; from: number; to: number }
  | { op: 'rate'; frameRate: number };

export const applyAnimationEdit = (
  animation: W3dAnimation,
  edit: AnimationEdit,
): W3dAnimation => {
  switch (edit.op) {
    case 'retime':
      return retimeAnimation(animation, edit.frames);
    case 'reverse':
      return reverseAnimation(animation);
    case 'ease':
      return easeAnimation(animation, edit.easing);
    case 'trim':
      return trimAnimation(animation, edit.from, edit.to);
    case 'rate':
      if (!(edit.frameRate > 0)) {
        throw new Error('A frame rate above 0');
      }
      return { ...animation, frameRate: edit.frameRate };
  }
};

const targetOf = (target: unknown): vscode.Uri | undefined =>
  target instanceof vscode.Uri
    ? target
    : ((target as { resourceUri?: vscode.Uri } | undefined)?.resourceUri ??
      vscode.window.activeTextEditor?.document.uri);

const number = async (prompt: string, value: number) => {
  const answer = await vscode.window.showInputBox({
    prompt,
    value: String(value),
    validateInput: (text) =>
      Number.isFinite(Number(text)) && Number(text) >= 0
        ? undefined
        : 'A number',
  });

  return answer === undefined ? undefined : Number(answer);
};

const askEdit = async (
  animation: W3dAnimation,
): Promise<AnimationEdit | undefined> => {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: 'Retime',
        detail: `Stretch or squeeze its ${animation.frameCount} frames to another length`,
        op: 'retime',
      },
      { label: 'Reverse', detail: 'Play it backwards', op: 'reverse' },
      {
        label: 'Ease',
        detail: 'Play its frames along an easing curve: slow in, slow out, …',
        op: 'ease',
      },
      { label: 'Trim', detail: 'Keep a range of its frames', op: 'trim' },
      {
        label: 'Frame rate',
        detail: `Play it at another rate than ${animation.frameRate} a second`,
        op: 'rate',
      },
    ] as const,
    { title: `Edit ${animation.name}` },
  );

  switch (choice?.op) {
    case 'retime': {
      const frames = await number('Frames', animation.frameCount);

      return frames === undefined
        ? undefined
        : { op: 'retime', frames: Math.round(frames) };
    }
    case 'reverse':
      return { op: 'reverse' };
    case 'ease': {
      const easing = await vscode.window.showQuickPick(Object.keys(EASINGS), {
        title: 'Easing',
      });

      return easing ? { op: 'ease', easing } : undefined;
    }
    case 'trim': {
      const from = await number('First frame to keep', 0);
      const to =
        from === undefined
          ? undefined
          : await number('Last frame to keep', animation.frameCount - 1);

      return from === undefined || to === undefined
        ? undefined
        : { op: 'trim', from: Math.round(from), to: Math.round(to) };
    }
    case 'rate': {
      const frameRate = await number('Frames a second', animation.frameRate);

      return frameRate === undefined ? undefined : { op: 'rate', frameRate };
    }
    default:
      return undefined;
  }
};

export const registerW3dAnimationCommands = (): vscode.Disposable =>
  vscode.commands.registerCommand(
    'bigfs.editW3dAnimation',
    /** With `edit` and `name`, runs without asking, for automation */
    async (target?: unknown, edit?: AnimationEdit, name?: string) => {
      const uri = targetOf(target);

      if (!uri || !/\.w3d$/i.test(uri.path)) {
        void vscode.window.showInformationMessage('Pick a .w3d file');
        return undefined;
      }
      try {
        const animations = parseW3dAnimations(
          await vscode.workspace.fs.readFile(uri),
        );
        const animation =
          animations.length > 1 && !edit
            ? (
                await vscode.window.showQuickPick(
                  animations.map((each) => ({ label: each.name, each })),
                  { title: 'Which animation?' },
                )
              )?.each
            : animations[0];

        if (!animation) {
          if (!animations.length) {
            void vscode.window.showInformationMessage(
              `${uri.path.slice(uri.path.lastIndexOf('/') + 1)} holds no animation`,
            );
          }
          return undefined;
        }

        const change = edit ?? (await askEdit(animation));

        if (!change) {
          return undefined;
        }

        const newName =
          name ??
          (await vscode.window.showInputBox({
            prompt: `Name of the new animation; INI files name it ${animation.hierarchyName}.<name>`,
            value: `${animation.name}`.slice(0, MAX_NAME - 2) + '_E',
            validateInput: (value) =>
              /^[A-Za-z0-9_]+$/.test(value) && value.length <= MAX_NAME
                ? undefined
                : `Letters, digits and _, at most ${MAX_NAME}`,
          }));

        if (!newName) {
          return undefined;
        }

        const result = applyAnimationEdit(animation, change);
        const file = vscode.Uri.joinPath(
          uri,
          '..',
          `${newName.toLowerCase()}.w3d`,
        );

        await vscode.workspace.fs.writeFile(
          file,
          writeW3dAnimation({ ...result, name: newName.toUpperCase() }),
        );
        void vscode.window.showInformationMessage(
          `${newName.toUpperCase()} written: ${result.frameCount} frames at ${result.frameRate} a second. Name it ${animation.hierarchyName}.${newName.toUpperCase()} in an INI file.`,
        );
        return file;
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
        return undefined;
      }
    },
  );
