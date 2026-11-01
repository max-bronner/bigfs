import * as vscode from 'vscode';
import type { EntryLocator } from '../../services/entryLocator';
import { toPlayableAudio } from '../../formats/audio/audioTools';
import { renderSoundPage } from './renderSoundPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import { findSoundFile } from '../../game/audio/findSoundFile';
import { AUDIO_KEYWORDS, createAudioLookup } from '../../services/ini/audioLookup';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { registerCommand } from '../../platform/commands';
import { describeError } from '../../core/errors';
import type { PlaySoundRequest, SoundReply } from '../../core/soundClip';
import type { FromSoundPage, ToSoundPage } from '../../webview/audio/protocol';

/**
 * Sounds played from the INI and for the other pages: a "Play" lens and an
 * "Open file" lens on every audio definition, play links in the hover of a
 * sound variant or of a value naming an event, and one small player panel
 * for the sounds no page of its own asked for.
 *
 * A page that has a play button asks `bigfs.resolveSound` for the bytes and
 * plays them itself, in place, from its own click; the panel exists only
 * because an INI lens has no page. A WAV stored as IMA ADPCM is decoded
 * first, as the audio preview does.
 *
 * Sound is opt-in: nothing here plays unless clicked, and one click plays
 * one file: an event with several variants plays its `Sounds` entry, and the
 * hover lists the others. An attack is never chained to its body and decay.
 *
 * What a name plays follows the audio runtime of mint
 * (`crates/sage/audio/src/runtime.rs`); see `sageAudioResolve.ts`.
 */

const ROTWK_HINT =
  "If this is The Rise of the Witch-king, add the BFME II install folder to the workspace; ROTWK's archives hold only its additions.";

/** What a page sends to have a sound resolved: its press, and the file it is near */
type SoundRequest = Pick<PlaySoundRequest, 'name' | 'id' | 'open'>;

/** Creates the small player panel, opened on the first sound and reused after */
const createSoundPanel = (
  extensionUri: vscode.Uri,
  onRequest: (request: SoundRequest) => void,
) => {
  const scripts = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  let ready = Promise.resolve();
  let markReady = () => {};

  const panel = createSingletonPanel<FromSoundPage, ToSoundPage>({
    viewType: 'bigfs.soundPlayer',
    title: 'Sound',
    column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    options: {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [scripts],
    },
    render: ({ webview }) => {
      ready = new Promise((resolve) => {
        markReady = resolve;
      });
      webview.html = renderSoundPage(webview, scripts);
    },
    onMessage: (message) => {
      if (message.kind === 'ready') {
        markReady();
      } else if (message.kind === 'playSound') {
        onRequest(message);
      }
    },
  });

  /** Sends the sound to the panel, opening it first if it is closed */
  const play = async (reply: SoundReply) => {
    panel.show({ preserveFocus: true });
    await ready;
    await panel.post(reply);
  };

  /** Answers a press in the panel */
  const answer = (reply: SoundReply) => panel.post(reply);

  return { play, answer };
};

/** Converts a file's bytes to what the page's Web Audio decodes: PCM WAV or MP3 */
const toSoundClip = (file: string, bytes: Uint8Array) =>
  file.endsWith('.wav')
    ? {
        file,
        mime: 'audio/wav',
        data: Buffer.from(toPlayableAudio(bytes).wav).toString('base64'),
      }
    : { file, mime: 'audio/mpeg', data: Buffer.from(bytes).toString('base64') };

/** Creates the lens on every audio definition block that plays one of its variants, or opens its file */
const createSoundLensProvider = (
  documents: SageIniDocuments,
): vscode.CodeLensProvider => ({
  async provideCodeLenses(document) {
    const parsed = await documents.parse(document);
    const keywords = AUDIO_KEYWORDS.map((keyword) => keyword.toLowerCase());

    return parsed.blocks.flatMap((block) => {
      const name = block.name?.split(/\s+/)[0];

      if (!name || !keywords.includes(block.keyword.toLowerCase())) {
        return [];
      }

      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
      const argumentsOf = [name, document.uri.toString()];

      return [
        new vscode.CodeLens(range, {
          title: '▶ Play',
          tooltip: 'Plays the sound here; the next lens opens its file',
          command: 'bigfs.playAudioEvent',
          arguments: argumentsOf,
        }),
        new vscode.CodeLens(range, {
          title: 'Open file',
          command: 'bigfs.openSound',
          arguments: argumentsOf,
        }),
      ];
    });
  },
});

/**
 * Registers the sound lenses and the `bigfs.playSound`, `bigfs.openSound`,
 * `bigfs.playAudioEvent` and `bigfs.resolveSound` commands. Without a
 * locator the commands do nothing.
 */
export const registerSoundPlayer = (
  extensionUri: vscode.Uri,
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => {
  const warned = new Set<string>();
  let lastNear: vscode.Uri | undefined;

  const getNear = (near?: string) =>
    (near ? vscode.Uri.parse(near) : undefined) ??
    lastNear ??
    vscode.window.activeTextEditor?.document.uri ??
    vscode.workspace.workspaceFolders?.[0]?.uri;

  /** Finds what a name plays and returns it ready for a page, or opens its file */
  const resolve = async (
    request: SoundRequest,
    near: vscode.Uri | undefined,
  ): Promise<SoundReply | undefined> => {
    const { name, id } = request;

    if (!locator || !near) {
      return undefined;
    }
    lastNear = near;
    await index.whenReady();

    try {
      const file = await findSoundFile(
        name,
        createAudioLookup(index, documents),
        async (candidate) => !!(await locator.findUri(candidate, near)),
      );

      if (!file) {
        const message = `No sound file for ${name} in any archive or folder.`;

        if (!warned.has(name)) {
          warned.add(name);
          void vscode.window.showWarningMessage(`${message} ${ROTWK_HINT}`);
        }
        return { kind: 'sound', name, id, error: message };
      }
      if (request.open) {
        await vscode.commands.executeCommand('bigfs.openAsset', [file], near.toString());
        return undefined;
      }

      const bytes = await locator.read(file, near);

      return bytes
        ? { kind: 'sound', name, id, clip: toSoundClip(file, bytes) }
        : { kind: 'sound', name, id, error: `${file} could not be read` };
    } catch (error) {
      return { kind: 'sound', name, id, error: describeError(error) };
    }
  };

  const soundPanel = createSoundPanel(extensionUri, (request) => {
    void resolve(request, getNear()).then(
      (reply) => reply && soundPanel.answer(reply),
    );
  });

  /** Plays a name in the panel, or opens its file */
  const playInPanel = async (name: string, near?: string, open?: boolean) => {
    const reply = await resolve({ name, open }, getNear(near));

    if (reply) {
      await soundPanel.play(reply);
    }
  };

  return [
    vscode.languages.registerCodeLensProvider(
      selector,
      createSoundLensProvider(documents),
    ),
    registerCommand('bigfs.playSound', (name: string, near?: string) =>
      playInPanel(name, near),
    ),
    registerCommand('bigfs.openSound', (name: string, near?: string) =>
      playInPanel(name, near, true),
    ),
    registerCommand(
      'bigfs.resolveSound',
      (request: SoundRequest, near: string) => resolve(request, getNear(near)),
    ),
    registerCommand(
      'bigfs.playAudioEvent',
      async (name?: string, near?: string) => {
        if (!locator) {
          return undefined;
        }
        await index.whenReady();

        if (!name) {
          name = await vscode.window.showQuickPick(
            AUDIO_KEYWORDS.flatMap((keyword) => index.getNames(keyword)),
            { placeHolder: 'The audio event to play' },
          );
        }
        return name ? playInPanel(name, near) : undefined;
      },
    ),
  ];
};
