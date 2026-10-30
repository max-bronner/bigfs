import * as vscode from 'vscode';
import type { EntryLocator } from '../../services/entryLocator';
import { toPlayableAudio } from '../../formats/audio/audioTools';
import { webviewPage } from '../../platform/webview/webviewPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import { resolveAudio } from '../../game/audio/sageAudioResolve';
import type { AudioVariant } from '../../game/audio/sageAudioResolve';
import { AUDIO_KEYWORDS, createAudioLookup } from '../../services/ini/audioLookup';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { registerCommand } from '../../platform/commands';
import type { FromSoundPage, ToSoundPage } from '../../webview/audio/protocol';

/**
 * Sounds played from the INI: a "Play" lens on every audio definition, play
 * links in the hover of a sound variant or of a value naming an event, and
 * one small player panel that plays what it is sent. A WAV stored as IMA
 * ADPCM is decoded first, as the audio preview does.
 *
 * Sound is opt-in: nothing here plays unless clicked, and one click plays
 * one file. A name with several variants (an event's roles, a `Multisound`'s
 * subsounds, an EVA event's sides) asks which; an attack is never chained
 * to its body and decay.
 *
 * What a name plays follows the audio runtime of mint
 * (`crates/sage/audio/src/runtime.rs`); see `sageAudioResolve.ts`.
 */

const ROTWK_HINT =
  "If this is The Rise of the Witch-king, add the BFME II install folder to the workspace; ROTWK's archives hold only its additions.";

const SOUND_EXTENSIONS = ['wav', 'mp3'];

/** The file names a variant may be stored under, the first found playing */
export const soundCandidates = (name: string): string[] => {
  const base = name.replace(/^.*[\\/]/, '').toLowerCase();

  return /\.[a-z0-9]+$/.test(base)
    ? [base]
    : SOUND_EXTENSIONS.map((extension) => `${base}.${extension}`);
};

/** Creates the small player panel, opened on the first sound and reused after */
const createSoundPanel = (extensionUri: vscode.Uri) => {
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
      webview.html = renderHtml(webview, scripts);
    },
    onMessage: (message) => {
      if (message.kind === 'ready') {
        markReady();
      }
    },
  });

  /** Plays the bytes in the panel, opening it first if it is closed */
  const play = async (name: string, bytes: Uint8Array, mime: string) => {
    panel.show({ preserveFocus: true });
    await ready;
    await panel.post({
      kind: 'play',
      name,
      mime,
      data: Buffer.from(bytes).toString('base64'),
    });
  };

  return { play };
};

type SoundPanel = ReturnType<typeof createSoundPanel>;

const renderHtml = (webview: vscode.Webview, scripts: vscode.Uri): string => {
  return webviewPage({
    allow: { media: 'blob:', script: webview.cspSource },
    scriptFiles: [
      webview.asWebviewUri(vscode.Uri.joinPath(scripts, 'sound.js')).toString(),
    ],
    style: `
  body { padding: 10px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  audio { width: 100%; margin: 6px 0 12px; }
  li { cursor: pointer; margin: 2px 0; }
  li:hover { text-decoration: underline; }
  .muted { opacity: 0.7; }
`,
    body: `<strong id="name" class="muted">Nothing played yet</strong>
<audio id="audio" controls></audio>
<div class="muted">Played before</div>
<ul id="history"></ul>`,
  });
};

/** Finds a sound by any of its candidate names and plays it */
const playSound = async (
  soundPanel: SoundPanel,
  locator: EntryLocator,
  name: string,
  near?: vscode.Uri,
): Promise<string | undefined> => {
  const nearUri =
    near ??
    vscode.window.activeTextEditor?.document.uri ??
    vscode.workspace.workspaceFolders?.[0]?.uri;

  for (const candidate of soundCandidates(name)) {
    const bytes = nearUri ? await locator.read(candidate, nearUri) : undefined;

    if (!bytes) {
      continue;
    }
    if (candidate.endsWith('.wav')) {
      await soundPanel.play(candidate, toPlayableAudio(bytes).wav, 'audio/wav');
    } else {
      await soundPanel.play(candidate, bytes, 'audio/mpeg');
    }
    return candidate;
  }
  void vscode.window.showWarningMessage(
    `No ${soundCandidates(name).join(' or ')} in any archive or folder. ${ROTWK_HINT}`,
  );
  return undefined;
};

/** The variants as a quick pick offers them: role, side or subsound, then file */
const toPickItem = (variant: AudioVariant) => ({
  label: variant.label,
  description: variant.file,
  detail: variant.weight === undefined ? undefined : `weight ${variant.weight}`,
  variant,
});

/** Creates the lens on every audio definition block that plays one of its variants */
const createSoundLensProvider = (
  documents: SageIniDocuments,
): vscode.CodeLensProvider => ({
  async provideCodeLenses(document) {
    const parsed = await documents.parse(document);
    const keywords = AUDIO_KEYWORDS.map((keyword) => keyword.toLowerCase());

    return parsed.blocks.flatMap((block) => {
      const name = block.name?.split(/\s+/)[0];

      return name && keywords.includes(block.keyword.toLowerCase())
        ? [
            new vscode.CodeLens(
              new vscode.Range(block.startLine, 0, block.startLine, 0),
              {
                title: '▶ Play',
                command: 'bigfs.playAudioEvent',
                arguments: [name, document.uri.toString()],
              },
            ),
          ]
        : [];
    });
  },
});

export const registerSoundPlayer = (
  extensionUri: vscode.Uri,
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => {
  const soundPanel = createSoundPanel(extensionUri);

  return [
    vscode.languages.registerCodeLensProvider(
      selector,
      createSoundLensProvider(documents),
    ),
    registerCommand(
      'bigfs.playSound',
      (name: string, near?: string) =>
        locator &&
        playSound(
          soundPanel,
          locator,
          name,
          near ? vscode.Uri.parse(near) : undefined,
        ),
    ),
    registerCommand(
      'bigfs.playAudioEvent',
      async (name?: string, near?: string) => {
        if (!locator) {
          return undefined;
        }
        await index.whenReady();

        if (!name) {
          const picked = await vscode.window.showQuickPick(
            AUDIO_KEYWORDS.flatMap((keyword) => index.getNames(keyword)),
            { placeHolder: 'The audio event to play' },
          );

          if (!picked) {
            return undefined;
          }
          name = picked;
        }

        const variants = await resolveAudio(
          name,
          createAudioLookup(index, documents),
        );

        if (!variants.length) {
          void vscode.window.showWarningMessage(`${name} names no sound`);
          return undefined;
        }

        // One click, one file: several variants ask which, never chain
        const picked =
          variants.length === 1
            ? variants[0]
            : (
                await vscode.window.showQuickPick(variants.map(toPickItem), {
                  placeHolder: `${name}: which sound to play`,
                  matchOnDescription: true,
                })
              )?.variant;

        return picked
          ? playSound(
              soundPanel,
              locator,
              picked.file,
              near ? vscode.Uri.parse(near) : undefined,
            )
          : undefined;
      },
    ),
  ];
};
