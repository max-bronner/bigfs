import * as vscode from 'vscode';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import type { AptInstruction } from '../../formats/apt/aptBytecode';
import type { ToolBox } from '../../services/toolRegistry';
import { decodeTgaTool } from '../../formats/texture/textureTools';
import type { EntryLocator } from '../../services/entryLocator';
import {
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../../formats/apt/aptMovie';
import type { AptMovie, ConstFile, Frame } from '../../formats/apt/aptMovie';
import { AptImage } from '../../formats/apt/writer/aptImage';
import { changeConstItem } from '../../formats/apt/writer/changeConstItem';
import type { ConstItemChange } from '../../formats/apt/writer/aptEdit';
import { appendConstItems } from '../../formats/apt/aptScript';
import { findBeside } from './aptAccess';
import {
  getTexturePath,
  parseDat,
  parseRu,
} from '../../formats/apt/aptGeometry';
import { addTexture, setShapeGeometry } from '../../formats/apt/aptAssets';
import type { DatLocation, RuRun } from '../../formats/apt/aptGeometry';
import { behaviourOf } from '../../formats/apt/aptBehaviour';
import type { Behaviour } from '../../formats/apt/aptBehaviour';
import type { PageMovie, TexturePixels } from '../../webview/apt/protocol';
import { movieKey } from './aptLibrary';
import { decodeWindows1252 } from '../../core/windows1252';
import { describeError } from '../../core/errors';
import { packSnapshot, unpackSnapshot } from './aptSnapshot';
import type { AptSnapshot } from './aptSnapshot';

/** A movie as the page draws it, with the textures it needs sent */
export interface BuiltMovie {
  movie: PageMovie;
  textures: Record<string, TexturePixels>;
  summary: string;
}

/** Every action block a movie runs: frame actions, button and clip actions */
const actionBlocks = (
  movie: AptMovie,
  spriteFrames: Record<number, Frame[]>,
): number[] => {
  const blocks = new Set<number>();

  for (const frames of [movie.frames, ...Object.values(spriteFrames)]) {
    for (const frame of frames) {
      for (const item of frame.items) {
        if (item.type === 'action' || item.type === 'initAction') {
          blocks.add(item.block);
        } else if (item.type === 'placeObject') {
          item.clipActions?.forEach((clip) => blocks.add(clip.block));
        }
      }
    }
  }
  for (const character of movie.characters) {
    if (character.type === 'button') {
      character.actions.forEach((action) => blocks.add(action.block));
    }
  }
  return [...blocks];
};

/** A file an edit removed is kept as an empty one until the movie is saved */
const removedOr = (bytes: Uint8Array): Uint8Array | undefined =>
  bytes.length ? bytes : undefined;

/** Reads a file, or nothing when it is not there */
const tryRead = async (uri: vscode.Uri): Promise<Uint8Array | undefined> => {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
};

/**
 * A file beside the movie, in the folder or archive holding its `.apt`: the
 * exact name, else the one matching without casing, as a retail archive's
 * `Name.CONST` beside `name.apt` is. Found nowhere else here, so a movie
 * reads its own copy before any other archive's.
 */
const readOwn = async (
  aptUri: vscode.Uri,
  relative: string,
): Promise<Uint8Array | undefined> => {
  const exact = await tryRead(
    vscode.Uri.joinPath(vscode.Uri.joinPath(aptUri, '..'), relative),
  );

  if (exact) {
    return exact;
  }

  const found = await findBeside(aptUri, relative, vscode.FileType.File);

  return found ? tryRead(found) : undefined;
};

const latin1 = decodeWindows1252;

/**
 * One open movie: the `.apt` image being edited, the files beside it, and
 * what was decoded from them, kept so an edit redraws without reading or
 * decoding a texture again.
 *
 * A movie spans files: the `.const` beside the `.apt` locates the Movie
 * record, the `.dat` names each image's texture, and every shape's triangles
 * are in `<name>_geometry/<n>.ru`. They are read from the `.apt`'s own folder,
 * which in a shipped `apt/*.big` is the archive's root, and textures from
 * `art/textures/` below it.
 */
export class AptDocument implements vscode.CustomDocument {
  /** The image as edited; saving writes it */
  public image: AptImage;

  /** Goes up with every change, so a page knows when to take the movie again */
  public version = 0;

  /**
   * Files an edit adds beside the movie, by path relative to its folder; an
   * empty one is a file an edit removed, deleted when the movie is saved
   */
  public files = new Map<string, Uint8Array>();

  /** The `.const` as edited; a script edit can add items to it */
  private constBytes: Uint8Array;
  private readonly savedConst: Uint8Array;
  private parsedConst: ConstFile;

  private readonly read: (relative: string) => Promise<Uint8Array | undefined>;
  private readonly cache = new Map<string, Promise<Uint8Array | undefined>>();
  private readonly textures = new Map<
    string,
    TexturePixels | undefined
  >();

  private constructor(
    public readonly uri: vscode.Uri,
    apt: Uint8Array,
    constBytes: Uint8Array,
    public readonly name: string,
    locator: EntryLocator,
    private readonly tools: ToolBox,
  ) {
    this.image = new AptImage(apt);
    this.constBytes = constBytes;
    this.savedConst = constBytes;
    this.parsedConst = parseConst(constBytes);
    this.read = (relative) =>
      this.files.has(relative)
        ? Promise.resolve(removedOr(this.files.get(relative)!))
        : this.cached(
            relative,
            async () =>
              (await readOwn(uri, relative)) ??
              (await locator.read(
                relative.slice(relative.lastIndexOf('/') + 1),
                uri,
              )),
          );
  }

  /** Reads a movie and its `.const`, which is the least it opens with */
  public static async open(
    uri: vscode.Uri,
    locator: EntryLocator,
    tools: ToolBox,
  ): Promise<AptDocument> {
    const name = uri.path
      .slice(uri.path.lastIndexOf('/') + 1)
      .replace(/\.apt$/i, '');
    const apt = await vscode.workspace.fs.readFile(uri);
    const constBytes =
      (await readOwn(uri, `${name}.const`)) ??
      (await locator.read(`${name}.const`, uri));

    if (!constBytes) {
      throw new Error(`${name}.const is not beside the movie`);
    }

    return new AptDocument(uri, apt, constBytes, name, locator, tools);
  }

  /** The `.const` as it now stands */
  public get constFile(): ConstFile {
    return this.parsedConst;
  }

  /** The files beside the movie as edited, the `.const` among them */
  public get editedFiles(): Map<string, Uint8Array> {
    return new Map([...this.files, [`${this.name}.const`, this.constBytes]]);
  }

  /** Changes one `.const` item in place, or repoints it at an appended string */
  public changeConstItem(change: ConstItemChange): void {
    this.constBytes = changeConstItem(this.constBytes, change);
    this.parsedConst = parseConst(this.constBytes);
  }

  /** Adds `.const` items a compiled script needs */
  public addConstItems(items: ConstFile['items']): void {
    if (items.length) {
      this.constBytes = appendConstItems(this.constBytes, items);
      this.parsedConst = parseConst(this.constBytes);
    }
  }

  /** Packs the movie as edited into one file, for a hot-exit backup */
  public backup(): Uint8Array {
    return packSnapshot(this.snapshot());
  }

  /** Takes back the state a hot-exit backup holds */
  public restoreBackup(bytes: Uint8Array): void {
    this.restore(unpackSnapshot(bytes));
  }

  /** Forgets the files read beside the movie */
  public dispose(): void {
    this.cache.clear();
  }

  private cached(
    key: string,
    load: () => Promise<Uint8Array | undefined>,
  ): Promise<Uint8Array | undefined> {
    let entry = this.cache.get(key);

    if (!entry) {
      entry = load();
      this.cache.set(key, entry);
    }

    return entry;
  }

  /** Reads a file beside the movie, an added one first */
  public readBeside(relative: string): Promise<Uint8Array | undefined> {
    return this.read(relative);
  }

  /** Captures the state an undo returns to */
  public snapshot(): AptSnapshot {
    return {
      apt: this.image.bytes,
      constBytes: this.constBytes,
      files: new Map(this.files),
    };
  }

  /** Returns to a captured state, as a new version the pages draw again */
  public restore(snapshot: AptSnapshot): void {
    this.version++;
    this.image = new AptImage(snapshot.apt);
    this.constBytes = snapshot.constBytes;
    this.parsedConst = parseConst(snapshot.constBytes);
    this.files = new Map(snapshot.files);
  }

  /** Decodes a texture once, however often the movie is redrawn */
  private async texture(path: string, problems: string[]) {
    if (!this.textures.has(path)) {
      const bytes = await this.read(path);
      let texture: TexturePixels | undefined;

      if (bytes) {
        try {
          texture = (await this.tools.use(decodeTgaTool)(bytes)).levels[0];
        } catch (error) {
          problems.push(
            `${path}: ${describeError(error)}`,
          );
        }
      }

      this.textures.set(path, texture);
    }

    const texture = this.textures.get(path);

    if (!texture) {
      problems.push(`texture ${path}`);
    }

    return texture;
  }

  /**
   * Parses the movie as it now stands into what the page draws, with every
   * texture it samples
   */
  public async build(): Promise<BuiltMovie> {
    const apt = this.image.bytes;
    const movie = parseAptMovie(apt, this.constFile.movieOffset);
    const datBytes = await this.read(`${this.name}.dat`);
    const dat = datBytes ? parseDat(latin1(datBytes)) : new Map();
    const spriteFrames: Record<number, Frame[]> = {};

    const shapes: Record<number, RuRun[]> = {};
    const imageTextures: Record<number, string> = {};
    const imageLocations: Record<number, DatLocation> = {};
    const problems: string[] = [];

    await Promise.all(
      movie.characters.map(async (character) => {
        try {
          if (character.type === 'sprite') {
            spriteFrames[character.id] = parseSpriteFrames(apt, character);
          } else if (character.type === 'shape') {
            const ru = await this.read(
              `${this.name}_geometry/${character.geometry}.ru`,
            );

            shapes[character.id] = ru ? parseRu(latin1(ru)) : [];

            if (!ru) {
              problems.push(`geometry of shape #${character.id}`);
            }
          } else if (character.type === 'image') {
            const location = dat.get(character.texture);

            if (location) {
              imageLocations[character.id] = location;
              imageTextures[character.id] = getTexturePath(
                this.name,
                character.texture,
                location,
              );
            }
          }
        } catch (error) {
          problems.push(
            `#${character.id}: ${describeError(error)}`,
          );
        }
      }),
    );

    const textures: Record<string, TexturePixels> = {};
    // Movies drawn together can name the same path; each reads its own
    const textureKey = (path: string) => `${movieKey(this.name)}/${path}`;

    for (const path of new Set(Object.values(imageTextures))) {
      const texture = await this.texture(path, problems);

      if (texture) {
        textures[textureKey(path)] = texture;
      }
    }
    for (const id of Object.keys(imageTextures)) {
      imageTextures[Number(id)] = textureKey(imageTextures[Number(id)]);
    }

    const counts = new Map<string, number>();

    movie.characters.forEach((character) =>
      counts.set(character.type, (counts.get(character.type) ?? 0) + 1),
    );

    const summary = [
      `${movie.record.screenWidth}×${movie.record.screenHeight}`,
      `${movie.characters.length} characters (${[...counts].map(([type, count]) => `${count} ${type}`).join(', ')})`,
      `${movie.imports.length} imports, ${movie.exports.length} exports`,
      problems.length
        ? `not found: ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? '…' : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      summary,
      movie: {
        ...movie,
        name: this.name,
        spriteFrames,
        behaviours: this.behaviours(movie, spriteFrames),
        code: this.code(movie, spriteFrames),
        consts: this.constFile.items.map((item) => item.value),
        shapes,
        imageTextures,
        imageLocations,
      },
      textures,
    };
  }

  /** Every action block decoded, for the preview to run; one that fails is left out */
  private code(
    movie: AptMovie,
    spriteFrames: Record<number, Frame[]>,
  ): Record<number, AptInstruction[]> {
    const code: Record<number, AptInstruction[]> = {};

    for (const block of actionBlocks(movie, spriteFrames)) {
      try {
        code[block] = decodeBlock(this.image.bytes, block);
      } catch {
        // The script tab says why; the preview runs the rest
      }
    }
    return code;
  }

  /** What each action block does to timelines, for the preview to play */
  private behaviours(
    movie: AptMovie,
    spriteFrames: Record<number, Frame[]>,
  ): Record<number, Behaviour> {
    const behaviours: Record<number, Behaviour> = {};

    for (const block of actionBlocks(movie, spriteFrames)) {
      try {
        behaviours[block] = behaviourOf(
          this.image.bytes,
          block,
          this.constFile.items,
        );
      } catch {
        behaviours[block] = { commands: [], skipped: 1, conditional: false };
      }
    }
    return behaviours;
  }

  /** Replaces a shape's geometry file, and its bounds with the box the geometry covers */
  public setGeometry(shape: number, runs: RuRun[]): void {
    for (const [path, bytes] of setShapeGeometry(
      this.image,
      this.constFile.movieOffset,
      this.name,
      shape,
      runs,
    )) {
      this.files.set(path, bytes);
    }
  }

  /** Adds an image as a new texture of the movie; returns its Image character id */
  public async addTexture(
    width: number,
    height: number,
    pixels: Uint8Array,
  ): Promise<number> {
    const dat = await this.read(`${this.name}.dat`);
    const { id, files } = addTexture(
      this.image,
      this.constFile.movieOffset,
      this.name,
      dat ? latin1(dat) : '',
      { width, height, pixels },
    );

    files.forEach((bytes, path) => this.files.set(path, bytes));
    return id;
  }

  /** Writes the movie, and the files edits added, to `target`'s folder */
  public async save(target: vscode.Uri = this.uri): Promise<void> {
    const folder = vscode.Uri.joinPath(target, '..');

    await vscode.workspace.fs.writeFile(target, this.image.bytes);

    // A movie saved elsewhere takes its .const along; in place, only a changed one is written
    if (
      target.toString() !== this.uri.toString() ||
      this.constBytes !== this.savedConst
    ) {
      const stem = target.path
        .slice(target.path.lastIndexOf('/') + 1)
        .replace(/\.apt$/i, '');

      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folder, `${stem}.const`),
        this.constBytes,
      );
    }

    for (const [relative, bytes] of this.files) {
      if (!bytes.length) {
        await Promise.resolve(
          vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, relative)),
        ).catch(() => undefined); // already gone
        continue;
      }
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folder, relative),
        bytes,
      );
    }
  }
}