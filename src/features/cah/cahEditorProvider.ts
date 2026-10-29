import * as vscode from "vscode";
import {
  cahRecordProblem,
  cloneCahRecord,
  computeCahCrc,
  parseCah,
  POWER_SLOTS,
  writeCah,
} from "../../formats/cah/cah";
import type { CahRecord, ParsedCah } from "../../formats/cah/cah";
import type { EntryLocator } from "../../services/entryLocator";
import { decodeIniText } from "../../core/windows1252";
import type { GameLanguage } from "../../services/ini/gameLanguage";
import {
  blingOptions,
  blockAtLine,
  readHeroSystem,
  spentPoints,
  topBlocks,
} from "../../game/objects/cahSystem";
import type { HeroSystem } from "../../game/objects/cahSystem";
import { isFragmentPath, parseSageIni } from "../../formats/ini/sageIniParser";
import type { SageIniDocuments } from "../../services/ini/sageIniDocuments";
import type { SageIniIndex } from "../../services/ini/sageIniIndex";
import { createParseCache } from "../../services/ini/workspaceText";
import { CAH_SCRIPT } from "./cahViewScript";
import { webviewPage } from "../../platform/webview/webviewPage";
import {
  addSnapshotView,
  backupSnapshot,
  createSnapshotDocument,
  isReadOnlyFile,
  readSnapshotSource,
  recordSnapshotEdit,
  redrawSnapshotViews,
  revertSnapshot,
  saveSnapshot,
} from "../../platform/webview/snapshotEditor";
import type {
  SnapshotDocument,
  SnapshotFormat,
} from "../../platform/webview/snapshotEditor";
import { describeError } from '../../core/errors';

/**
 * The editor for Create-a-Hero files (`MyHero_<id>.cah`), loose or inside a
 * BIG archive. Names resolve through the INI index (`CreateAHeroSystem`,
 * `Upgrade`, `CommandButton`, `SpecialPower`) and string labels in the chosen
 * game language; whatever does not resolve is shown as stored. Saving
 * recomputes the trailer checksum exactly as mint does (`formats/cah.ts`).
 */

export const CAH_VIEW_TYPE = "bigfs.cahEditor";

const MAX_U32 = 0xffffffff;

/** What the page sends */
interface PageMessage {
  kind:
    | "ready"
    | "setName"
    | "setId"
    | "setClass"
    | "setSubclass"
    | "setColor"
    | "setPower"
    | "clearPower"
    | "addBling"
    | "removeBling"
    | "setBling";
  index?: number;
  field?: string;
  value?: string;
}

/** The services the editor resolves names with */
export interface CahServices {
  documents: SageIniDocuments;
  index: SageIniIndex;
  gameLanguage: GameLanguage;
  locator: EntryLocator;
}

/** An open hero file: its record, and the file as it was opened */
type CahDocument = SnapshotDocument<CahRecord> & { original: ParsedCah };

const CAH_FORMAT: SnapshotFormat<CahRecord> = {
  read: (bytes) => parseCah(bytes).record,
  write: (record) => {
    const problem = cahRecordProblem(record);

    if (problem) {
      throw new Error(problem);
    }
    return writeCah(record);
  },
};

const whole = (text: string | undefined, what: string): number => {
  const value = Number(text);

  if (!/^\d+$/.test((text ?? "").trim()) || value > MAX_U32) {
    throw new Error(`${what} must be a whole number from 0 to ${MAX_U32}`);
  }
  return value;
};

const checkName = (text: string, what: string): string => {
  if (/[^\x01-\xff]/.test(text)) {
    throw new Error(
      `${what} is stored one byte per character, so it cannot hold a NUL or characters beyond Latin-1`,
    );
  }
  return text;
};

const toHex = (packed: number): string =>
  `#${(packed & 0xffffff).toString(16).padStart(6, "0")}`;

const toPacked = (previous: number, hex: string): number => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`"${hex}" is not a colour`);
  }
  return (((previous >>> 24) << 24) | Number.parseInt(hex.slice(1), 16)) >>> 0;
};

const renderHtml = (): string =>
  webviewPage({
    style: `
  body { margin: 0; padding: 8px 14px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  h2 { margin: 16px 0 6px; font-size: 1.1em; }
  input, select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; font: inherit; }
  input[type=color] { padding: 0; width: 44px; height: 24px; }
  input[type=number] { width: 80px; }
  button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; }
  button:disabled, input:disabled, select:disabled { opacity: 0.6; cursor: default; }
  table { border-collapse: collapse; }
  th { text-align: left; padding: 3px 8px 3px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: 3px 8px 3px 0; vertical-align: middle; }
  .grid { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; align-items: center; max-width: 720px; }
  .muted { opacity: 0.7; }
  .bad { color: var(--vscode-editorWarning-foreground); }
  #banner { margin: 6px 0; padding: 6px 10px; border: 1px solid var(--vscode-panel-border); }
  #notice { position: fixed; bottom: 8px; left: 12px; right: 12px; padding: 6px 10px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
`,
    body: `<div id="banner" hidden></div>
<h2>Hero</h2><div class="grid" id="hero"></div>
<h2>Colours</h2><div class="grid" id="colors"></div>
<h2>Attribute points</h2><div id="points" class="muted"></div>
<h2>Powers</h2><table><thead><tr><th>Slot</th><th>Command button</th><th>Level</th><th>Power</th><th></th></tr></thead><tbody id="powers"></tbody></table>
<h2>Bling and upgrades</h2><table><thead><tr><th>Group</th><th>Index</th><th>Choice</th><th></th></tr></thead><tbody id="blings"></tbody></table>
<p><button id="addBling">Add bling</button></p>
<h2>File</h2><div class="grid" id="file"></div>
<div id="notice" hidden></div>`,
    script: CAH_SCRIPT,
  });

/** The hero file editor: the binary file as a form, saved whole */
export class CahEditorProvider implements vscode.CustomEditorProvider<CahDocument> {
  private readonly changes = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<CahDocument>
  >();
  public readonly onDidChangeCustomDocument = this.changes.event;
  private readonly parses: ReturnType<typeof createParseCache>;
  private system?: Promise<HeroSystem | undefined>;

  public constructor(private readonly services: CahServices) {
    this.parses = createParseCache(services.documents);
  }

  public static register(services: CahServices): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      CAH_VIEW_TYPE,
      new CahEditorProvider(services),
      { supportsMultipleEditorsPerDocument: true },
    );
  }

  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<CahDocument> {
    const original = parseCah(await readSnapshotSource(uri, context.backupId));
    const document = createSnapshotDocument(
      uri,
      cloneCahRecord(original.record),
      await isReadOnlyFile(uri),
    );

    return Object.assign(document, { original });
  }

  /** Applies a change to a copy, records the undo step, and redraws */
  private change(
    document: CahDocument,
    label: string,
    mutate: (record: CahRecord) => void,
  ): void {
    if (document.isReadOnly) {
      throw new Error("This hero file is read-only");
    }

    const after = cloneCahRecord(document.snapshot);

    mutate(after);
    recordSnapshotEdit(this.changes, document, label, after);
    redrawSnapshotViews(document);
  }

  /** The create-a-hero tables, read once from the first INI that holds a `CreateAHeroSystem` */
  private loadSystem(): Promise<HeroSystem | undefined> {
    this.system ??= this.readSystem().then((system) => {
      if (!system) {
        this.system = undefined;
      }
      return system;
    });
    return this.system;
  }

  private async readSystem(): Promise<HeroSystem | undefined> {
    const { locator, documents } = this.services;
    const schema = await documents.getSchema();
    const names = await locator.findNames(
      (name) => /^createahero.*\.ini$/.test(name),
      "**/[Cc]reate[Aa][Hh]ero*.ini",
    );

    for (const name of names) {
      const bytes = await locator.read(name, vscode.Uri.file("/"));

      if (!bytes) {
        continue;
      }

      const parsed = parseSageIni(decodeIniText(bytes).split(/\r?\n/), schema, {
        isFragment: isFragmentPath(name),
      });
      const blocks = topBlocks(parsed, "CreateAHeroSystem");

      if (blocks.length) {
        return readHeroSystem(blocks);
      }
    }
    return undefined;
  }

  /** The fields of a definition the index knows, if its file can be read */
  private async fieldsOf(namespace: string, name: string) {
    const [definition] = this.services.index.findDefinitions(namespace, name);
    const parsed = definition && (await this.parses.get(definition.uri));

    return parsed && blockAtLine(parsed, definition.line)?.fields;
  }

  private async view(document: CahDocument) {
    const { index, gameLanguage } = this.services;
    const record = document.snapshot;

    await index.whenReady().catch(() => undefined);
    await gameLanguage.ensure().catch(() => undefined);

    const system = await this.loadSystem().catch(() => undefined);
    const text = (label?: string) => label && index.findString(label)?.text;
    const orders = new Map<string, number | undefined>();

    for (const upgrade of system?.blings.flatMap((b) => b.upgrade ?? []) ??
      []) {
      const value = (await this.fieldsOf("Upgrade", upgrade))?.get(
        "grouporder",
      )?.[0]?.[0];

      orders.set(upgrade.toLowerCase(), value ? Number(value) : undefined);
    }

    const groupOrder = (upgrade: string) => orders.get(upgrade.toLowerCase());
    const chosenClass = system?.classes[record.classIndex];
    const chosenSubclass = chosenClass?.subclasses[record.subclassIndex];
    const blings = [];

    for (const [at, bling] of record.blings.entries()) {
      const binder = system?.binders.find(
        (entry) => entry.group?.toLowerCase() === bling.group.toLowerCase(),
      );
      const upgrade = system
        ? blingOptions(system, chosenSubclass, bling.group, groupOrder)[
            bling.index
          ]
        : undefined;
      const tag = system?.blings.find(
        (entry) => entry.upgrade?.toLowerCase() === upgrade?.toLowerCase(),
      )?.nameTag;

      blings.push({
        at,
        group: bling.group,
        index: bling.index,
        binder: text(binder?.labelTag) ?? undefined,
        kind: binder ? (binder.isAttribute ? "attribute" : "appearance") : "",
        upgrade,
        label: text(tag),
      });
    }

    const powers = [];

    for (const [slot, power] of record.powers.entries()) {
      const fields = power.button
        ? await this.fieldsOf("CommandButton", power.button)
        : undefined;
      const specialPower = fields?.get("specialpower")?.[0]?.[0];

      powers.push({
        slot,
        button: power.button,
        level: power.level,
        commandSlot: power.slot,
        label: text(fields?.get("textlabel")?.[0]?.[0]),
        specialPower,
        specialPowerKnown: specialPower
          ? index.findDefinitions("SpecialPower", specialPower).length > 0
          : undefined,
        buttonKnown: power.button ? fields !== undefined : undefined,
      });
    }

    const crc = computeCahCrc(record);

    return {
      readOnly: document.isReadOnly,
      hasSystem: system !== undefined,
      name: record.name,
      id: record.id,
      isSystem: record.isSystem,
      version: record.version,
      objectId: record.objectId,
      classIndex: record.classIndex,
      subclassIndex: record.subclassIndex,
      classes:
        system?.classes.map((entry, at) => ({
          index: at,
          label: text(entry.nameTag) ?? entry.upgrade ?? `Class ${at}`,
        })) ?? [],
      subclasses:
        chosenClass?.subclasses.map((entry, at) => ({
          index: at,
          label: text(entry.nameTag) ?? entry.upgrade ?? `Subclass ${at}`,
        })) ?? [],
      colors: record.colors.map((packed) => ({
        hex: toHex(packed),
        alpha: packed >>> 24,
      })),
      points: chosenSubclass
        ? {
            total: chosenSubclass.points,
            spent: spentPoints(
              system!,
              chosenSubclass,
              record.blings,
              groupOrder,
            ),
          }
        : undefined,
      powers,
      blings,
      file: {
        storedCrc: record.storedCrc,
        document: document.original.crcMatches,
        crc,
        trailing: document.original.trailing,
      },
    };
  }

  public resolveCustomEditor(
    document: CahDocument,
    panel: vscode.WebviewPanel,
  ): void {
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    panel.webview.html = renderHtml();

    const send = async () => {
      await panel.webview.postMessage({
        kind: "hero",
        ...(await this.view(document)),
      });
    };

    panel.webview.onDidReceiveMessage(async (message: PageMessage) => {
      try {
        this.handle(document, message);
      } catch (error) {
        await panel.webview.postMessage({
          kind: "notice",
          message: describeError(error),
        });
      }
      await send();
    });

    addSnapshotView(document, panel, send);
  }

  private handle(document: CahDocument, message: PageMessage): void {
    const at = message.index ?? -1;
    const value = message.value ?? "";

    switch (message.kind) {
      case "ready":
        return;
      case "setName": {
        const name = value;

        if (name === document.snapshot.name) {
          return;
        }
        return this.change(document, "Rename hero", (record) => {
          record.name = name;
        });
      }
      case "setId": {
        const id = checkName(value.trim(), "The id");

        if (/[^A-Za-z0-9]/.test(id)) {
          throw new Error("The id may hold letters and digits only");
        }
        return this.change(document, "Change id", (record) => {
          record.id = id;
        });
      }
      case "setClass": {
        const classIndex = whole(value, "The class");

        return this.change(document, "Change class", (record) => {
          record.classIndex = classIndex;
          record.subclassIndex = 0;
        });
      }
      case "setSubclass": {
        const subclassIndex = whole(value, "The subclass");

        return this.change(document, "Change subclass", (record) => {
          record.subclassIndex = subclassIndex;
        });
      }
      case "setColor": {
        if (at < 0 || at > 2) {
          throw new Error("The hero has three colours");
        }
        return this.change(document, "Change colour", (record) => {
          record.colors[at] = toPacked(record.colors[at], value);
        });
      }
      case "setPower": {
        if (at < 0 || at >= POWER_SLOTS) {
          throw new Error(`A hero has ${POWER_SLOTS} power slots`);
        }

        const field = message.field;
        const button =
          field === "button" ? checkName(value.trim(), "The button") : "";
        const number =
          field === "level" || field === "slot"
            ? whole(value, "The power field")
            : 0;

        if (field !== "button" && field !== "level" && field !== "slot") {
          throw new Error("Unknown power field");
        }
        return this.change(document, "Edit power", (record) => {
          if (field === "button") {
            record.powers[at].button = button;
          } else {
            record.powers[at][field] = number;
          }
        });
      }
      case "clearPower":
        if (at < 0 || at >= POWER_SLOTS) {
          throw new Error(`A hero has ${POWER_SLOTS} power slots`);
        }
        return this.change(document, "Clear power", (record) => {
          record.powers[at] = { button: "", level: 0, slot: 0 };
        });
      case "addBling": {
        const group = checkName(value.trim(), "The bling group");

        if (!group) {
          throw new Error("A bling needs a group name");
        }
        return this.change(document, "Add bling", (record) => {
          record.blings.push({ group, index: 0 });
        });
      }
      case "removeBling":
        if (!document.snapshot.blings[at]) {
          throw new Error("The bling list changed; try again");
        }
        return this.change(document, "Remove bling", (record) => {
          record.blings.splice(at, 1);
        });
      case "setBling": {
        if (!document.snapshot.blings[at]) {
          throw new Error("The bling list changed; try again");
        }

        const group =
          message.field === "group"
            ? checkName(value.trim(), "The bling group")
            : "";
        const index =
          message.field === "index" ? whole(value, "The bling index") : 0;

        if (message.field === "group" && !group) {
          throw new Error("A bling needs a group name");
        }
        return this.change(document, "Edit bling", (record) => {
          if (message.field === "group") {
            record.blings[at].group = group;
          } else {
            record.blings[at].index = index;
          }
        });
      }
    }
  }

  public async saveCustomDocument(document: CahDocument): Promise<void> {
    if (document.isReadOnly) {
      throw new Error(
        "This hero file is read-only (a game install is never written to). Use Save As to keep a copy.",
      );
    }
    await saveSnapshot(document, CAH_FORMAT);
  }

  public saveCustomDocumentAs(
    document: CahDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    return saveSnapshot(document, CAH_FORMAT, destination);
  }

  public revertCustomDocument(document: CahDocument): Promise<void> {
    return revertSnapshot(document, CAH_FORMAT);
  }

  public backupCustomDocument(
    document: CahDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    return backupSnapshot(document, CAH_FORMAT, context);
  }
}
