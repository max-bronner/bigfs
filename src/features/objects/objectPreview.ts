import * as vscode from 'vscode';
import type { EntryLocator } from '../../services/entryLocator';
import { createDebouncer } from '../../core/debounce';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import {
  findAnimation,
  parseW3dAnimations,
} from '../../formats/w3d/w3dAnimation';
import { buildW3dScene } from '../../formats/w3d/w3dScene';
import { createToolRegistry } from '../../services/toolRegistry';
import { EffectLibrary } from '../particles/effectLibrary';
import { composeEffective } from './effectiveObjectView';
import { focusAt, readObjectScene } from '../../game/objects/objectScene';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import type { SageDocument } from '../../formats/ini/sageIniParser';
import { particlePageHtml } from '../particles/particlePreview';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import type { FromPage, ToPage } from '../../webview/particles/protocol';
import { registerCommand } from '../../platform/commands';
import { describeError } from '../../core/errors';

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

const noticeOf = (error: unknown): ToPage => ({
  kind: 'notice',
  message: describeError(error),
});

/** Creates the preview of one object; `onClose` runs when its panel is closed */
const createObjectPreview = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
  uri: vscode.Uri,
  name: string,
  onClose: () => void,
) => {
  const library = new EffectLibrary(index, locator, uri);
  const tools = createToolRegistry();
  const scripts = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  /** Lines below the object's header the preview opens on */
  let focusOffset = 0;
  let isReady = false;

  const redrawSoon = createDebouncer(() => {
    send().catch((error: unknown) => panel.post(noticeOf(error)));
  }, REDRAW_DELAY);

  const panel = createSingletonPanel<FromPage, ToPage>({
    viewType: 'bigfs.objectPreview',
    title: `Object: ${name}`,
    column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    options: {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [scripts],
    },
    render: ({ webview }) => {
      webview.html = particlePageHtml(
        webview.cspSource,
        webview
          .asWebviewUri(vscode.Uri.joinPath(scripts, 'particles.js'))
          .toString(),
      );
      return [
        // The object may be anywhere in the lineage of files: any INI edit
        // can change what it composes to
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (isReady && event.document.languageId === 'sage-ini') {
            redrawSoon.schedule();
          }
        }),
        { dispose: redrawSoon.cancel },
      ];
    },
    onMessage: (message): Promise<unknown> =>
      receive(message).catch((error: unknown) => panel.post(noticeOf(error))),
    onDispose: () => {
      isReady = false;
      onClose();
    },
  });

  const receive = async (message: FromPage): Promise<void> => {
    switch (message.kind) {
      case 'ready':
        isReady = true;
        await send();
        break;
      case 'loadModel':
        await sendModel(message.name);
        break;
      case 'loadAnimation':
        await sendAnimation(message.name);
        break;
    }
  };

  /** The object, the effects on it, and where to open it */
  const send = async (): Promise<void> => {
    const schema = await documents.getSchema();
    const source = parseSageIni(
      (await readWorkspaceText(uri)).split(/\r?\n/),
      schema,
    );
    const header = objectNamed(source, name)?.startLine;
    const composed =
      header === undefined
        ? undefined
        : await composeEffective(documents, index, uri, header);

    if (header === undefined || composed === undefined) {
      await panel.post({
        kind: 'notice',
        message: 'The object is no longer where it was',
      });
      return;
    }
    await index.whenReady();

    const isDefined = (keywords: string[]) => (name: string) =>
      keywords.some(
        (keyword) => index.findDefinitions(keyword, name).length > 0,
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

    const effects = await library.collect(
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

    await panel.post({
      kind: 'scene',
      restart: true,
      ...effects,
      fields: [],
      values: {},
      comparing: false,
      budgets: [],
    });
    await panel.post({
      kind: 'object',
      object: scene,
      focus: focusAt(source, header + focusOffset, scene),
    });
  };

  const sendModel = async (name: string): Promise<void> => {
    const file = `${name.replace(/\.w3d$/i, '')}.w3d`;
    const bytes = await locator?.read(file, uri);

    if (!bytes) {
      await panel.post({ kind: 'notice', message: `${file} was not found` });
      return;
    }
    await panel.post({
      kind: 'model',
      model: {
        name: file,
        scene: await buildW3dScene(
          bytes,
          (fileName) => locator!.read(fileName, uri),
          tools,
        ),
      },
    });
  };

  /** `SKELETON.CLIP` lives in the clip's file */
  const sendAnimation = async (clipName: string): Promise<void> => {
    const clip = clipName.slice(clipName.lastIndexOf('.') + 1);
    const bytes = await locator?.read(`${clip}.w3d`, uri);
    const animations = bytes ? parseW3dAnimations(bytes) : [];

    await panel.post({
      kind: 'animation',
      name: clipName,
      animation: findAnimation(animations, clipName),
    });
  };

  /** Opens the preview, or brings it forward, on the line `focusOffset` lines below the header */
  const show = async (offset: number): Promise<void> => {
    focusOffset = offset;
    panel.show({ preserveFocus: true });
    if (isReady) {
      await send();
    }
  };

  return { show };
};

const openObjectPreviews = new Map<
  string,
  ReturnType<typeof createObjectPreview>
>();

/** Opens the preview of the object around `line`, or says there is none */
const showObjectPreview = async (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
  uri: vscode.Uri,
  line: number,
): Promise<void> => {
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
    openObjectPreviews.get(key) ??
    createObjectPreview(context, documents, index, locator, uri, name, () =>
      openObjectPreviews.delete(key),
    );

  openObjectPreviews.set(key, preview);
  await preview.show(line - object.startLine);
};

/** Creates "Preview object" over every template, and "Preview" over every state */
const createObjectLensProvider = (): vscode.CodeLensProvider => ({
  provideCodeLenses(document) {
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
  },
});

/** Fields an object preview opens on: animations, FX, bone systems */
const PREVIEWABLE =
  /^\s*(AnimationName|Animation|ParticleSysBone|\w*FX\w*|FXList)\s*=/i;

/** Creates "Preview on the object" on a line naming an animation or an effect */
const createObjectActionProvider = (): vscode.CodeActionProvider => ({
  provideCodeActions(document, range) {
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
  },
});

export const registerObjectPreview = (
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => [
  vscode.languages.registerCodeLensProvider(
    selector,
    createObjectLensProvider(),
  ),
  vscode.languages.registerCodeActionsProvider(
    selector,
    createObjectActionProvider(),
  ),
  registerCommand(
    'bigfs.previewObject',
    async (uri?: vscode.Uri, line?: number) => {
      const editor = vscode.window.activeTextEditor;

      uri ??= editor?.document.uri;
      line ??= editor?.selection.active.line;
      if (uri && line !== undefined) {
        await showObjectPreview(context, documents, index, locator, uri, line);
      }
    },
  ),
];
