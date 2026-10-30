import * as vscode from 'vscode';
import { Dict, MapFile, parseMap, writeMap } from '../../formats/map/mapFile';
import { MapEdit, applyMapEdit } from '../../formats/map/mapEdit';
import { markSounds } from '../../formats/map/mapScriptSounds';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { webviewPage } from '../../platform/webview/webviewPage';
import { pageBundle, pageBundleFolder } from '../../platform/webview/pageBundle';
import type {
  DictEntryView,
  FromMapPage,
  MapMessage,
} from '../../webview/map/protocol';
import {
  SnapshotDocument,
  SnapshotFormat,
  addSnapshotView,
  backupSnapshot,
  createSnapshotDocument,
  isReadOnlyFile,
  readSnapshotSource,
  recordSnapshotEdit,
  redrawSnapshotViews,
  revertSnapshot,
  saveSnapshot,
} from '../../platform/webview/snapshotEditor';
import { describeError } from '../../core/errors';

/**
 * Editor for `.map` and `.bse` files: terrain relief with objects and start
 * positions, the world settings, players, time of day and every placed
 * object's position, template and properties. A save writes the map in the
 * form it was read, compressed or not; parts no edit touched keep their
 * bytes.
 */

export const MAP_VIEW_TYPE = 'bigfs.mapEditor';

/** More templates than this are left to the filter; a datalist of tens of thousands stalls the page */
const MAX_TEMPLATES = 20000;

type MapDocument = SnapshotDocument<MapFile>;

const MAP_FORMAT: SnapshotFormat<MapFile> = {
  read: parseMap,
  write: writeMap,
};

export const renderHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string => {
  return webviewPage({
    ...pageBundle(extensionUri, webview, 'map'),
    style: `
  body { margin: 0; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); display: grid; grid-template-columns: 300px 1fr 300px; height: 100vh; }
  #info, #side { overflow: auto; padding: 0 10px; }
  #info { border-right: 1px solid var(--vscode-panel-border); }
  #side { border-left: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
  main { display: flex; flex-direction: column; min-width: 0; }
  #layers { display: flex; gap: 12px; padding: 6px 10px; flex-wrap: wrap; }
  #stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--vscode-editor-background); }
  canvas { cursor: crosshair; }
  h2 { font-size: 1.2em; margin: 10px 0 6px; } h3 { font-size: 1em; margin: 12px 0 4px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 0; } dt { opacity: 0.7; } dd { margin: 0; }
  table.dict { border-collapse: collapse; width: 100%; } table.dict td { padding: 2px 4px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
  td.key { font-family: var(--vscode-editor-font-family, monospace); opacity: 0.85; width: 45%; word-break: break-all; }
  input, select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; font: inherit; width: 100%; box-sizing: border-box; }
  input[type=checkbox] { width: auto; }
  input.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  .field { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 6px; margin: 4px 0; }
  details { margin: 6px 0; } summary { cursor: pointer; }
  #filter { margin: 8px 0 4px; }
  #objects { flex: 1; overflow: auto; min-height: 120px; }
  .object { padding: 2px 4px; cursor: pointer; display: flex; justify-content: space-between; gap: 6px; }
  .object:hover { background: var(--vscode-list-hoverBackground); }
  .object.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  #object { border-top: 1px solid var(--vscode-panel-border); max-height: 50%; overflow: auto; }
  .muted { opacity: 0.65; }
  .problems { color: var(--vscode-editorWarning-foreground); }
  .script { margin-left: 12px; } .script .calls { margin: 0 0 4px 22px; opacity: 0.8; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
  button.play { padding: 0 4px; margin: 0 2px; font-size: 0.85em; cursor: pointer; }
  .script label { display: flex; gap: 4px; align-items: center; }
  .light { display: grid; grid-template-columns: 70px repeat(3, 1fr); gap: 3px; align-items: center; }
  .toolbar, .addproperty { display: flex; gap: 4px; margin: 4px 0; flex-wrap: wrap; }
  .addproperty input { flex: 1 1 60px; width: auto; min-width: 0; } .addproperty select { width: auto; }
  button.icon { padding: 0 6px; cursor: pointer; margin-left: 4px; }
  #hint { margin-left: 8px; }
  body.readonly .edit-only { display: none; }
  #notice { position: fixed; bottom: 8px; left: 310px; right: 310px; padding: 6px 10px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
`,
    body: `<section id="info"></section>
<main>
  <div id="layers">
    <label><input type="checkbox" id="layer-objects"> Objects</label>
    <label><input type="checkbox" id="layer-waypoints"> Waypoints</label>
    <label><input type="checkbox" id="layer-links"> Waypoint links</label>
    <label><input type="checkbox" id="layer-starts"> Start positions</label>
    <label><input type="checkbox" id="layer-boundary"> Playable area</label>
    <label><input type="checkbox" id="layer-areas"> Trigger areas</label>
    <span id="hint" class="muted"></span>
    <span id="modebar" hidden><button id="finishMode">Finish</button> <button id="cancelMode">Cancel</button></span>
  </div>
  <div id="stage"><canvas id="terrain" width="10" height="10"></canvas></div>
</main>
<section id="side">
  <div class="toolbar edit-only">
    <input id="template" list="templates" placeholder="Object template">
    <button id="placeObject" title="Then click the map">Place object</button>
    <button id="placeWaypoint" title="Then click the map">Place waypoint</button>
  </div>
  <input id="filter" placeholder="Filter objects by template or name"><span id="objectCount" class="muted"></span>
  <div id="objects"></div>
  <div id="object"></div>
</section>
<div id="notice" hidden></div>
<datalist id="templates"></datalist><datalist id="owners"></datalist><datalist id="propertyKeys"></datalist>`,
  });
};

const entriesOf = (dict: Dict | undefined): DictEntryView[] =>
  (dict?.entries ?? []).map(({ key, value }) => ({ key, value }));

/** What the page draws; the heights only when asked, as they never change */
const toMessage = (
  map: MapFile,
  withHeights: boolean,
  readOnly: boolean,
  templates: string[] | undefined,
): MapMessage => ({
  kind: 'map',
  readOnly,
  templates,
  map: {
    compression: map.compression,
    worldInfo: entriesOf(map.worldInfo),
    timeOfDay: map.lighting?.timeOfDay,
    lights: map.lighting?.terrainSuns,
    teams: map.teams.map(entriesOf),
    scripts: map.scripts.map(markSounds),
    triggerAreas: map.triggerAreas.map(({ name, id, points }) => ({
      name,
      id,
      points,
    })),
    waypointLinks: map.waypointLinks,
    sides: map.sides.map(entriesOf),
    objects: map.objects.map((object) => ({
      index: object.index,
      x: object.x,
      y: object.y,
      z: object.z,
      angle: object.angle,
      template: object.template,
      properties: entriesOf(object.properties),
    })),
    chunks: map.chunks.map((chunk) => ({
      name: chunk.name,
      version: chunk.version,
      size: chunk.end - chunk.start,
    })),
    problems: map.problems,
  },
  heights:
    withHeights && map.heights
      ? {
          width: map.heights.width,
          height: map.heights.height,
          border: map.heights.border,
          boundaries: map.heights.boundaries,
          samples: map.heights.samples,
        }
      : undefined,
});

export class MapEditorProvider implements vscode.CustomEditorProvider<MapDocument> {
  private readonly changes = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<MapDocument>
  >();
  public readonly onDidChangeCustomDocument = this.changes.event;

  public constructor(
    private readonly index: SageIniIndex,
    private readonly extensionUri: vscode.Uri,
  ) {}

  /** One provider under two view types: the default for files under a `maps` folder, and an option for any `.map` */
  public static register(
    index: SageIniIndex,
    extensionUri: vscode.Uri,
  ): vscode.Disposable {
    const provider = new MapEditorProvider(index, extensionUri);
    const options = { supportsMultipleEditorsPerDocument: true };

    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(
        MAP_VIEW_TYPE,
        provider,
        options,
      ),
      vscode.window.registerCustomEditorProvider(
        `${MAP_VIEW_TYPE}Any`,
        provider,
        options,
      ),
    );
  }

  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<MapDocument> {
    const map = parseMap(await readSnapshotSource(uri, context.backupId));

    return createSnapshotDocument(uri, map, await isReadOnlyFile(uri));
  }

  /** The placeable templates the INI files declare, which the page offers when adding an object */
  private templates(): string[] {
    return [
      ...new Set(
        ['Object', 'ChildObject', 'ObjectReskin'].flatMap((namespace) =>
          this.index.getNames(namespace),
        ),
      ),
    ]
      .sort()
      .slice(0, MAX_TEMPLATES);
  }

  private edit(document: MapDocument, edit: MapEdit): void {
    if (document.isReadOnly) {
      throw new Error(
        'This map is read-only: it is part of a game install. Copy it into the workspace to edit it.',
      );
    }

    recordSnapshotEdit(
      this.changes,
      document,
      edit.kind,
      applyMapEdit(document.snapshot, edit),
    );
  }

  public resolveCustomEditor(
    document: MapDocument,
    panel: vscode.WebviewPanel,
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [pageBundleFolder(this.extensionUri)],
    };
    panel.webview.html = renderHtml(panel.webview, this.extensionUri);

    let heightsSent = false;
    const send = () => {
      void panel.webview.postMessage(
        toMessage(
          document.snapshot,
          !heightsSent,
          document.isReadOnly,
          heightsSent ? undefined : this.templates(),
        ),
      );
      heightsSent = true;
    };

    panel.webview.onDidReceiveMessage((message: FromMapPage) => {
      try {
        if (message?.kind === 'ready') {
          heightsSent = false;
        } else if (message?.kind === 'edit') {
          this.edit(document, message.edit);
        } else if (message?.kind === 'playSound') {
          // Only a click on a play button gets here; one name, one play
          if (typeof message.name === 'string' && message.name) {
            void vscode.commands.executeCommand(
              'bigfs.playAudioEvent',
              message.name,
              document.uri.toString(),
            );
          }
        }
      } catch (error) {
        void panel.webview.postMessage({
          kind: 'notice',
          message: describeError(error),
        });
      }

      redrawSnapshotViews(document);
    });

    addSnapshotView(document, panel, send);
  }

  public saveCustomDocument(document: MapDocument): Promise<void> {
    return saveSnapshot(document, MAP_FORMAT);
  }

  public saveCustomDocumentAs(
    document: MapDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    return saveSnapshot(document, MAP_FORMAT, destination);
  }

  public revertCustomDocument(document: MapDocument): Promise<void> {
    return revertSnapshot(document, MAP_FORMAT);
  }

  public backupCustomDocument(
    document: MapDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    return backupSnapshot(document, MAP_FORMAT, context);
  }
}
