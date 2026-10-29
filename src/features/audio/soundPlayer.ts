import * as vscode from 'vscode';
import { createParseCache } from '../../services/ini/workspaceText';
import type { EntryLocator } from '../../services/entryLocator';
import { toPlayableAudio } from '../../formats/audio/audioTools';
import { webviewPage } from '../../platform/webview/webviewPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import { findAssetReferences } from '../../formats/ini/sageIniAssets';
import {
  audioDefinitionOf,
  resolveAudio,
} from '../../game/audio/sageAudioResolve';
import type {
  AudioLookup,
  AudioVariant,
} from '../../game/audio/sageAudioResolve';
import { forEachBlock } from '../../formats/ini/sageIniParser';
import type { SageDocument, SageToken } from '../../formats/ini/sageIniParser';
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

/** Definitions that name audio files, directly or through other events */
export const AUDIO_KEYWORDS = [
  'AudioEvent',
  'DialogEvent',
  'MusicTrack',
  'AmbientStream',
  'StreamedSound',
  'Multisound',
  'NewEvaEvent',
  'PredefinedEvaEvent',
];

/** A movie's definition, followed to the events its file stem names */
const VIDEO_KEYWORD = 'Video';

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

/** How long a parsed file serves lookups before it is read again */
const PARSE_REUSE_MS = 5000;

/** Finds audio definitions by name through the index, reading them from their files */
export const createAudioLookup = (
  index: SageIniIndex,
  documents: SageIniDocuments,
): AudioLookup => {
  const cache = createParseCache(documents);
  let cachedAt = Date.now();

  return async (name) => {
    // Files are parsed once per burst of lookups, so an edit shows within seconds
    if (Date.now() - cachedAt > PARSE_REUSE_MS) {
      cache.clear();
      cachedAt = Date.now();
    }
    for (const keyword of [...AUDIO_KEYWORDS, VIDEO_KEYWORD]) {
      const [place] = index.findDefinitions(keyword, name);
      const parsed = place && (await cache.get(place.uri));

      if (!place || !parsed) {
        continue;
      }

      let found: ReturnType<typeof audioDefinitionOf> | undefined;

      forEachBlock(parsed.blocks, (block) => {
        if (!found && block.startLine === place.line) {
          found = audioDefinitionOf(parsed, block);
        }
      });
      if (found) {
        return found;
      }
    }
    return undefined;
  };
};

/** The variants as a quick pick offers them: role, side or subsound, then file */
const toPickItem = (variant: AudioVariant) => ({
  label: variant.label,
  description: variant.file,
  detail: variant.weight === undefined ? undefined : `weight ${variant.weight}`,
  variant,
});

/** INI text in markdown: it must not open a link or a code span of its own */
const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_{}[\]()<>#+!|-]/g, '\\$&');
/** Links a hover lists before pointing to the lens instead */
const HOVER_LINKS = 12;

const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

const commandLink = (title: string, command: string, args: unknown[]) =>
  `[${escapeMarkdown(title)}](command:${command}?${encodeURIComponent(JSON.stringify(args)).replace(/[()]/g, (bracket) => (bracket === '(' ? '%28' : '%29'))})`;

/**
 * Play links for a hovered value: a sound variant plays its file, a name of
 * an audio event lists its variants
 */
export const describeSound = async (
  lookup: AudioLookup,
  parsed: SageDocument,
  line: number,
  token: SageToken,
  documentUri: vscode.Uri,
): Promise<vscode.MarkdownString | undefined> => {
  const reference = findAssetReferences(parsed).find(
    (each) =>
      each.kind === 'sound' &&
      each.line === line &&
      each.start <= token.start &&
      token.start < each.end,
  );
  const text = new vscode.MarkdownString();

  text.isTrusted = { enabledCommands: ['bigfs.playSound'] };

  if (reference) {
    text.appendMarkdown(
      `${code(reference.name)} — sound\n\n${commandLink('▶ Play', 'bigfs.playSound', [reference.name, documentUri.toString()])}`,
    );
    return text;
  }

  const variants = await resolveAudio(token.text, lookup);

  if (!variants.length) {
    return undefined;
  }

  const shown = variants.slice(0, HOVER_LINKS);

  text.appendMarkdown(
    `${code(token.text)} — ${variants.length} sound${variants.length === 1 ? '' : 's'}\n\n` +
      shown
        .map(
          (variant) =>
            `${variants.length > 1 ? `${escapeMarkdown(variant.label)}: ` : ''}${commandLink(`▶ ${variant.file}`, 'bigfs.playSound', [variant.file, documentUri.toString()])}`,
        )
        .join(variants.length > 1 ? '\n\n' : ' · ') +
      (variants.length > shown.length
        ? `\n\n…and ${variants.length - shown.length} more; use the Play lens`
        : ''),
  );
  return text;
};

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
