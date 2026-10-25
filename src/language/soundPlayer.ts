import * as vscode from 'vscode';
import { readWorkspaceText } from './workspaceText';
import type { EntryLocator } from '../formats/entryLocator';
import { toPlayableAudio } from '../tools/audioTools';
import { webviewPage } from '../providers/webviewPage';
import { findAssetReferences } from './model/sageIniAssets';
import type { SageDocument, SageToken } from './model/sageIniParser';
import type { SageIniIndex } from './sageIniIndex';

/**
 * Sounds played from the INI: a "Play" lens on every audio event, play
 * links in the hover of a sound variant or of a value naming an event, and
 * one small player panel that plays what it is sent. A WAV stored as IMA
 * ADPCM is decoded first, as the audio preview does.
 */

/** Definitions whose `Sounds` or `Filename` name audio files */
export const AUDIO_KEYWORDS = [
  'AudioEvent',
  'DialogEvent',
  'MusicTrack',
  'AmbientStream',
  'StreamedSound',
];

const SOUND_EXTENSIONS = ['wav', 'mp3'];

/** The file names a variant may be stored under, the first found playing */
export const soundCandidates = (name: string): string[] => {
  const base = name.replace(/^.*[\\/]/, '').toLowerCase();

  return /\.[a-z0-9]+$/.test(base)
    ? [base]
    : SOUND_EXTENSIONS.map((extension) => `${base}.${extension}`);
};

/** The variants of an audio definition's own lines: `Sounds*` or `Filename` */
export const soundVariants = (lines: string[]): string[] =>
  lines.flatMap((line) => {
    const match = /^\s*(Sounds\w*|Filename)\s*=\s*([^;]*)/i.exec(line);

    if (!match) {
      return [];
    }
    return match[2]
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^"|"$/g, '').replace(/:\d+$/, ''))
      .filter(Boolean);
  });

class SoundPanel {
  private static current?: SoundPanel;
  private readonly panel: vscode.WebviewPanel;
  private ready: Promise<void>;

  public static get(): SoundPanel {
    SoundPanel.current ??= new SoundPanel();
    return SoundPanel.current;
  }

  private constructor() {
    this.panel = vscode.window.createWebviewPanel(
      'bigfs.soundPlayer',
      'Sound',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    let markReady = () => {};

    this.ready = new Promise((resolve) => {
      markReady = resolve;
    });
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.kind === 'ready') {
        markReady();
      }
    });
    this.panel.onDidDispose(() => {
      SoundPanel.current = undefined;
    });
    this.panel.webview.html = renderHtml();
  }

  public async play(name: string, bytes: Uint8Array, mime: string) {
    this.panel.reveal(undefined, true);
    await this.ready;
    await this.panel.webview.postMessage({
      kind: 'play',
      name,
      mime,
      data: Buffer.from(bytes).toString('base64'),
    });
  }
}

const renderHtml = (): string => {
  return webviewPage({
    allow: { media: 'blob:' },
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
    script: `
const vscode = acquireVsCodeApi();
const audio = document.getElementById('audio');
const history = [];
const play = (entry) => {
  document.getElementById('name').textContent = entry.name;
  audio.src = entry.url;
  audio.play().catch(() => {});
};
window.addEventListener('message', ({ data }) => {
  if (data.kind !== 'play') return;
  const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
  const entry = { name: data.name, url: URL.createObjectURL(new Blob([bytes], { type: data.mime })) };
  history.unshift(entry);
  history.splice(12);
  document.getElementById('history').replaceChildren(...history.map((each) => {
    const item = document.createElement('li');
    item.textContent = each.name;
    item.onclick = () => play(each);
    return item;
  }));
  play(entry);
});
vscode.postMessage({ kind: 'ready' });
`,
  });
};

/** Finds a sound by any of its candidate names and plays it */
const playSound = async (
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
      await SoundPanel.get().play(
        candidate,
        toPlayableAudio(bytes).wav,
        'audio/wav',
      );
    } else {
      await SoundPanel.get().play(candidate, bytes, 'audio/mpeg');
    }
    return candidate;
  }
  void vscode.window.showWarningMessage(
    `No ${soundCandidates(name).join(' or ')} in any archive or folder`,
  );
  return undefined;
};

/** The lines of an audio event's definition, from its open editor if any */
const definitionLines = async (
  index: SageIniIndex,
  name: string,
): Promise<string[] | undefined> => {
  for (const keyword of AUDIO_KEYWORDS) {
    const [place] = index.findDefinitions(keyword, name);

    if (place) {
      const text = await readWorkspaceText(place.uri);

      return text.split(/\r?\n/).slice(place.line + 1, place.endLine);
    }
  }
  return undefined;
};

/** INI text in markdown: it must not open a link or a code span of its own */
const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_{}[\]()<>#+!|-]/g, '\\$&');
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

const commandLink = (title: string, command: string, args: unknown[]) =>
  `[${escapeMarkdown(title)}](command:${command}?${encodeURIComponent(JSON.stringify(args)).replace(/[()]/g, (bracket) => (bracket === '(' ? '%28' : '%29'))})`;

/**
 * Play links for a hovered value: a sound variant plays its file, a name of
 * an audio event lists its variants
 */
export const describeSound = async (
  index: SageIniIndex,
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

  const lines = await definitionLines(index, token.text);

  if (!lines) {
    return undefined;
  }

  const variants = soundVariants(lines);

  text.appendMarkdown(
    `${code(token.text)} — ${variants.length} sound${variants.length === 1 ? '' : 's'}\n\n` +
      variants
        .map((variant) =>
          commandLink(`▶ ${variant}`, 'bigfs.playSound', [
            variant,
            documentUri.toString(),
          ]),
        )
        .join(' · '),
  );
  return text;
};

/** A lens on every audio definition that plays one of its variants */
class SoundLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const pattern = new RegExp(
      `^\\s*(${AUDIO_KEYWORDS.join('|')})\\s+(\\S+)`,
      'i',
    );

    for (let line = 0; line < document.lineCount; line++) {
      const match = pattern.exec(document.lineAt(line).text);

      if (match) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: '▶ Play',
            command: 'bigfs.playAudioEvent',
            arguments: [match[2], document.uri.toString()],
          }),
        );
      }
    }
    return lenses;
  }
}

export const registerSoundPlayer = (
  selector: vscode.DocumentSelector,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => [
  vscode.languages.registerCodeLensProvider(selector, new SoundLensProvider()),
  vscode.commands.registerCommand(
    'bigfs.playSound',
    (name: string, near?: string) =>
      locator &&
      playSound(locator, name, near ? vscode.Uri.parse(near) : undefined),
  ),
  vscode.commands.registerCommand(
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

      const variants = soundVariants(
        (await definitionLines(index, name)) ?? [],
      );

      if (!variants.length) {
        void vscode.window.showWarningMessage(`${name} names no sound`);
        return undefined;
      }

      // The game picks one variant at random; so does this
      const variant = variants[Math.floor(Math.random() * variants.length)];

      return playSound(
        locator,
        variant,
        near ? vscode.Uri.parse(near) : undefined,
      );
    },
  ),
];
