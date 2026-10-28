import * as assert from "assert";
import Module from "module";
import type * as vscode from "vscode";
import type {
  SnapshotDocument,
  SnapshotFormat,
} from "../../platform/webview/snapshotEditor";

// snapshotEditor reaches the disk through `vscode.workspace.fs`, which a plain
// mocha run does not have; a fake in-memory file system stands in for it.
type Loader = (request: string, ...rest: unknown[]) => unknown;

const READONLY = 1;
const files = new Map<string, Uint8Array>();
const permissions = new Map<string, number>();

const fakeUri = (path: string) =>
  ({ path, toString: () => path }) as unknown as vscode.Uri;

const fakeVscode = {
  FilePermission: { Readonly: READONLY },
  Uri: { parse: fakeUri },
  workspace: {
    fs: {
      readFile: async (uri: vscode.Uri) => {
        const bytes = files.get(uri.toString());

        if (!bytes) {
          throw new Error(`${uri.toString()} not found`);
        }
        return bytes;
      },
      writeFile: async (uri: vscode.Uri, bytes: Uint8Array) => {
        files.set(uri.toString(), bytes);
      },
      delete: async (uri: vscode.Uri) => {
        files.delete(uri.toString());
      },
      stat: async (uri: vscode.Uri) => {
        if (!files.has(uri.toString())) {
          throw new Error(`${uri.toString()} not found`);
        }
        return { permissions: permissions.get(uri.toString()) };
      },
    },
  },
};

const internals = Module as unknown as { _load: Loader };
const original = internals._load;

internals._load = (request, ...rest) =>
  request === "vscode" ? fakeVscode : original.call(Module, request, ...rest);

let editor: typeof import("../../platform/webview/snapshotEditor");

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  editor = require("../../platform/webview/snapshotEditor");
} finally {
  internals._load = original;
}

const TEXT: SnapshotFormat<string> = {
  read: (bytes) => new TextDecoder().decode(bytes),
  write: (text) => new TextEncoder().encode(text),
};

const textAt = (path: string) => TEXT.read(files.get(path)!);

const fakePanel = () => {
  const closers: (() => void)[] = [];

  return {
    panel: {
      onDidDispose: (close: () => void) => closers.push(close),
    } as unknown as vscode.WebviewPanel,
    close: () => closers.forEach((close) => close()),
  };
};

const recordEvents = () => {
  const events: vscode.CustomDocumentEditEvent<SnapshotDocument<string>>[] = [];

  return {
    events,
    fire: (event: (typeof events)[number]) => events.push(event),
  };
};

suite("snapshotEditor", () => {
  setup(() => {
    files.clear();
    permissions.clear();
  });

  test("opens from the backup when there is one, else the file", async () => {
    files.set("/a.txt", TEXT.write("saved"));
    files.set("/backup", TEXT.write("unsaved"));

    assert.strictEqual(
      TEXT.read(await editor.readSnapshotSource(fakeUri("/a.txt"), undefined)),
      "saved",
    );
    assert.strictEqual(
      TEXT.read(await editor.readSnapshotSource(fakeUri("/a.txt"), "/backup")),
      "unsaved",
    );
  });

  test("reads the read-only flag, and treats a file it cannot stat as writable", async () => {
    files.set("/install.txt", TEXT.write(""));
    permissions.set("/install.txt", READONLY);
    files.set("/workspace.txt", TEXT.write(""));

    assert.strictEqual(
      await editor.isReadOnlyFile(fakeUri("/install.txt")),
      true,
    );
    assert.strictEqual(
      await editor.isReadOnlyFile(fakeUri("/workspace.txt")),
      false,
    );
    assert.strictEqual(
      await editor.isReadOnlyFile(fakeUri("/missing.txt")),
      false,
    );
  });

  test("records an edit whose undo and redo swap the snapshots and redraw", () => {
    const document = editor.createSnapshotDocument(
      fakeUri("/a.txt"),
      "one",
      false,
    );
    const { panel } = fakePanel();
    const { events, fire } = recordEvents();
    let redraws = 0;

    editor.addSnapshotView(document, panel, () => redraws++);
    editor.recordSnapshotEdit({ fire }, document, "Change", "two");

    assert.strictEqual(document.snapshot, "two");
    assert.strictEqual(redraws, 0);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].label, "Change");
    assert.strictEqual(events[0].document, document);

    void events[0].undo();
    assert.strictEqual(document.snapshot, "one");
    assert.strictEqual(redraws, 1);

    void events[0].redo();
    assert.strictEqual(document.snapshot, "two");
    assert.strictEqual(redraws, 2);
  });

  test("stops redrawing a panel once it closes, and every panel once the document is disposed", () => {
    const document = editor.createSnapshotDocument(
      fakeUri("/a.txt"),
      "",
      false,
    );
    const first = fakePanel();
    const second = fakePanel();
    const drawn: string[] = [];

    editor.addSnapshotView(document, first.panel, () => drawn.push("first"));
    editor.addSnapshotView(document, second.panel, () => drawn.push("second"));
    editor.redrawSnapshotViews(document);
    first.close();
    editor.redrawSnapshotViews(document);
    document.dispose();
    editor.redrawSnapshotViews(document);

    assert.deepStrictEqual(drawn, ["first", "second", "second"]);
  });

  test("saves to the file, saves as elsewhere, and reverts from the file", async () => {
    files.set("/a.txt", TEXT.write("one"));

    const document = editor.createSnapshotDocument(
      fakeUri("/a.txt"),
      "two",
      false,
    );
    const { panel } = fakePanel();
    let redraws = 0;

    editor.addSnapshotView(document, panel, () => redraws++);

    await editor.saveSnapshot(document, TEXT, fakeUri("/b.txt"));
    assert.strictEqual(textAt("/b.txt"), "two");
    assert.strictEqual(textAt("/a.txt"), "one");

    await editor.revertSnapshot(document, TEXT);
    assert.strictEqual(document.snapshot, "one");
    assert.strictEqual(redraws, 1);

    document.snapshot = "three";
    await editor.saveSnapshot(document, TEXT);
    assert.strictEqual(textAt("/a.txt"), "three");
  });

  test("backs up to a destination a later open restores from", async () => {
    files.set("/a.txt", TEXT.write("saved"));

    const document = editor.createSnapshotDocument(
      fakeUri("/a.txt"),
      "unsaved",
      false,
    );
    const backup = await editor.backupSnapshot(document, TEXT, {
      destination: fakeUri("/backup"),
    } as vscode.CustomDocumentBackupContext);

    assert.strictEqual(backup.id, "/backup");
    assert.strictEqual(
      TEXT.read(await editor.readSnapshotSource(fakeUri("/a.txt"), backup.id)),
      "unsaved",
    );

    await backup.delete();
    assert.strictEqual(files.has("/backup"), false);
  });

  test("lets the format refuse to write, leaving the file untouched", async () => {
    files.set("/a.txt", TEXT.write("saved"));

    const document = editor.createSnapshotDocument(
      fakeUri("/a.txt"),
      "bad",
      false,
    );
    const strict: SnapshotFormat<string> = {
      ...TEXT,
      write: () => {
        throw new Error("cannot store this");
      },
    };

    await assert.rejects(
      editor.saveSnapshot(document, strict),
      /cannot store this/,
    );
    assert.strictEqual(textAt("/a.txt"), "saved");
  });
});
