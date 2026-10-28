import * as vscode from 'vscode';
import type { EntryLocator } from '../services/entryLocator';
import { findAnimation, parseW3dAnimations } from '../formats/w3d/w3dAnimation';
import { buildW3dScene } from '../formats/w3d/w3dScene';
import { createToolRegistry } from '../services/toolRegistry';
import { EffectLibrary } from './effectLibrary';
import { composeEffective } from './effectiveObjectView';
import { focusAt, readObjectScene } from '../game/objects/objectScene';
import { parseSageIni } from '../formats/ini/sageIniParser';
import type { SageDocument } from '../formats/ini/sageIniParser';
import { particlePageHtml } from './particlePreview';
import type { SageIniDocuments } from '../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../services/ini/sageIniIndex';
import { readWorkspaceText } from '../services/ini/workspaceText';
import type { FromPage, ToPage } from '../webview/particles/protocol';

/**
 * The object preview: an object as the game composes it, on the particle
 * preview's page - its model, the animations its states play, and the FX
 * and particle systems on it, each with a toggle. Opened from anywhere in
 * the object, it opens on that place: a state shows that state, an
 * animation line plays that animation, an FX line plays that FX on the
 * model. The same FX opened from its FX list has no object around it.
 */

const TEMPLATE = /^(object|childobject|objectreskin)$/i;
const STATE =
  /^\s*(Default)?(Model)?ConditionState\b|^\s*(Idle)?AnimationState\b|^\s*TransitionState\b/i;
/** Definitions an object's effects may reach between them */
const MAX_EFFECT_REFERENCES = 512;

/** The object template written around a line */
const objectAt = (parsed: SageDocument, line: number) =>
  parsed.blocks.find(
    (block) =>
      TEMPLATE.test(block.keyword) &&
      block.startLine <= line &&
      line <= block.endLine,
  );

/** The object template a name defines, wherever it has moved to in the file */
const objectNamed = (parsed: SageDocument, name: string) =>
  parsed.blocks.find(
    (block) =>
      TEMPLATE.test(block.keyword) &&
      block.name?.split(/\s+/)[0].toLowerCase() === name.toLowerCase(),
  );

/** How long after an edit the preview is drawn again */
const REDRAW_DELAY = 300;

class ObjectPreview {
  private static readonly panels = new Map<string, ObjectPreview>();

  private readonly panel: vscode.WebviewPanel;
  private readonly library: EffectLibrary;
  private readonly tools = createToolRegistry();

  public static async show(
    context: vscode.ExtensionContext,
    documents: SageIniDocuments,
    index: SageIniIndex,
    locator: EntryLocator | undefined,
    uri: vscode.Uri,
    line: number,
  ): Promise<void> {
    const parsed = parseSageIni(
      (await readWorkspaceText(uri)).split(/\r?\n/),
      await documents.getSchema(),
    );
    const object = objectAt(parsed, line);

    if (!object) {
      void vscode.window.showInformationMessage(
        'Put the cursor inside an Object, ChildObject or ObjectReskin',
      );
      return;
    }

    const name = object.name?.split(/\s+/)[0] ?? 'Object';
    const key = `${uri.toString()}#${name.toLowerCase()}`;
    const preview =
      ObjectPreview.panels.get(key) ??
      new ObjectPreview(context, documents, index, locator, uri, name, key);

    ObjectPreview.panels.set(key, preview);
    preview.focusOffset = line - object.startLine;
    preview.panel.reveal(undefined, true);
    if (preview.isReady) {
      await preview.send();
    }
  }

  /** Lines below the object's header the preview opens on */
  private focusOffset = 0;
  private isReady = false;
  private redrawTimer?: ReturnType<typeof setTimeout>;

  private constructor(
    context: vscode.ExtensionContext,
    private readonly documents: SageIniDocuments,
    private readonly index: SageIniIndex,
    private readonly locator: EntryLocator | undefined,
    private readonly uri: vscode.Uri,
    private readonly name: string,
    key: string,
  ) {
    this.library = new EffectLibrary(index, locator, uri);

    const scripts = vscode.Uri.joinPath(
      context.extensionUri,
      'dist',
      'webview',
    );

    this.panel = vscode.window.createWebviewPanel(
      'bigfs.objectPreview',
      `Object: ${name}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [scripts],
      },
    );
    this.panel.webview.html = particlePageHtml(
      this.panel.webview.cspSource,
      this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(scripts, 'particles.js'))
        .toString(),
    );

    const listening = this.panel.webview.onDidReceiveMessage(
      (message: FromPage) =>
        this.receive(message).catch((error: unknown) =>
          this.post({
            kind: 'notice',
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
    );

    // The object may be anywhere in the lineage of files: any INI edit
    // can change what it composes to
    const editing = vscode.workspace.onDidChangeTextDocument((event) => {
      if (this.isReady && event.document.languageId === 'sage-ini') {
        this.redrawSoon();
      }
    });

    this.panel.onDidDispose(() => {
      ObjectPreview.panels.delete(key);
      clearTimeout(this.redrawTimer);
      listening.dispose();
      editing.dispose();
    });
  }

  private redrawSoon(): void {
    clearTimeout(this.redrawTimer);
    this.redrawTimer = setTimeout(() => {
      this.send().catch((error: unknown) =>
        this.post({
          kind: 'notice',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }, REDRAW_DELAY);
  }

  private post(message: ToPage): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  private async receive(message: FromPage): Promise<void> {
    switch (message.kind) {
      case 'ready':
        this.isReady = true;
        await this.send();
        break;
      case 'loadModel':
        await this.sendModel(message.name);
        break;
      case 'loadAnimation':
        await this.sendAnimation(message.name);
        break;
    }
  }

  /** The object, the effects on it, and where to open it */
  private async send(): Promise<void> {
    const schema = await this.documents.getSchema();
    const source = parseSageIni(
      (await readWorkspaceText(this.uri)).split(/\r?\n/),
      schema,
    );
    const header = objectNamed(source, this.name)?.startLine;
    const composed =
      header === undefined
        ? undefined
        : await composeEffective(this.documents, this.index, this.uri, header);

    if (header === undefined || composed === undefined) {
      await this.post({
        kind: 'notice',
        message: 'The object is no longer where it was',
      });
      return;
    }
    await this.index.whenReady();

    const isDefined = (keywords: string[]) => (name: string) =>
      keywords.some(
        (keyword) => this.index.findDefinitions(keyword, name).length > 0,
      );
    const scene = readObjectScene(
      parseSageIni(composed.split('\n'), schema),
      schema,
      isDefined(['FXList']),
      isDefined(['FXParticleSystem', 'ParticleSystem']),
    );

    if (!scene) {
      return;
    }

    const effects = await this.library.collect(
      [],
      [
        ...scene.fx.map(({ name }) => ({ name, list: true })),
        ...scene.states.flatMap((state) => [
          ...state.fx.map((name) => ({ name, list: true })),
          ...state.particles.map(({ system }) => ({
            name: system,
            list: false,
          })),
        ]),
      ],
      '',
      MAX_EFFECT_REFERENCES,
    );

    await this.post({
      kind: 'scene',
      restart: true,
      ...effects,
      fields: [],
      values: {},
      comparing: false,
      budgets: [],
    });
    await this.post({
      kind: 'object',
      object: scene,
      focus: focusAt(source, header + this.focusOffset, scene),
    });
  }

  private async sendModel(name: string): Promise<void> {
    const file = `${name.replace(/\.w3d$/i, '')}.w3d`;
    const bytes = await this.locator?.read(file, this.uri);

    if (!bytes) {
      await this.post({ kind: 'notice', message: `${file} was not found` });
      return;
    }
    await this.post({
      kind: 'model',
      model: {
        name: file,
        scene: await buildW3dScene(
          bytes,
          (fileName) => this.locator!.read(fileName, this.uri),
          this.tools,
        ),
      },
    });
  }

  /** `SKELETON.CLIP` lives in the clip's file */
  private async sendAnimation(name: string): Promise<void> {
    const clip = name.slice(name.lastIndexOf('.') + 1);
    const bytes = await this.locator?.read(`${clip}.w3d`, this.uri);
    const animations = bytes ? parseW3dAnimations(bytes) : [];

    await this.post({
      kind: 'animation',
      name,
      animation: findAnimation(animations, name),
    });
  }
}

/** "Preview object" over every template, and "Preview" over every state */
class ObjectLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    let inObject = false;

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      const lens = (title: string) =>
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title,
            command: 'bigfs.previewObject',
            arguments: [document.uri, line],
          }),
        );

      if (/^(Object|ChildObject|ObjectReskin)\s/i.test(text)) {
        inObject = true;
        lens('▶ Preview object');
      } else if (/^End\b/i.test(text)) {
        inObject = false;
      } else if (inObject && STATE.test(text)) {
        lens('▶ Preview state');
      }
    }
    return lenses;
  }
}

/** Fields an object preview opens on: animations, FX, bone systems */
const PREVIEWABLE =
  /^\s*(AnimationName|Animation|ParticleSysBone|\w*FX\w*|FXList)\s*=/i;

/** "Preview on the object" on a line naming an animation or an effect */
class ObjectActionProvider implements vscode.CodeActionProvider {
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const line = range.start.line;

    if (!PREVIEWABLE.test(document.lineAt(line).text)) {
      return [];
    }

    const action = new vscode.CodeAction(
      'Preview on the object',
      vscode.CodeActionKind.Empty,
    );

    action.command = {
      title: action.title,
      command: 'bigfs.previewObject',
      arguments: [document.uri, line],
    };
    return [action];
  }
}

export const registerObjectPreview = (
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => [
  vscode.languages.registerCodeLensProvider(selector, new ObjectLensProvider()),
  vscode.languages.registerCodeActionsProvider(
    selector,
    new ObjectActionProvider(),
  ),
  vscode.commands.registerCommand(
    'bigfs.previewObject',
    async (uri?: vscode.Uri, line?: number) => {
      const editor = vscode.window.activeTextEditor;

      uri ??= editor?.document.uri;
      line ??= editor?.selection.active.line;
      if (uri && line !== undefined) {
        await ObjectPreview.show(context, documents, index, locator, uri, line);
      }
    },
  ),
];
