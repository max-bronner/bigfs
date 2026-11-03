import * as vscode from 'vscode';
import type { SoundReply } from '../../core/soundClip';

/**
 * Answers a page's `playSound` message: the sound's bytes go back to the
 * page, which plays them itself, or, for a Ctrl or Cmd click, the file opens
 * in an editor and nothing is sent. `near` is the document the page shows.
 */
export const answerSoundRequest = async (
  request: { name?: unknown; id?: unknown; open?: unknown },
  near: vscode.Uri,
  post: (reply: SoundReply) => Thenable<unknown>,
): Promise<void> => {
  if (typeof request.name !== 'string' || !request.name) {
    return;
  }

  const reply = await vscode.commands.executeCommand<SoundReply | undefined>(
    'bigfs.resolveSound',
    {
      name: request.name,
      id: typeof request.id === 'number' ? request.id : undefined,
      open: request.open === true,
    },
    near.toString(),
  );

  if (reply) {
    await post(reply);
  }
};
