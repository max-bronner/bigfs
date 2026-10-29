import * as assert from 'assert';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import { compileScript } from '../../formats/apt/aptCompiler';
import {
  classifySurface,
  clamp,
  fraction,
  itemsOf,
  rangeOf,
  valueAt,
} from '../../formats/apt/aptGadgets';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/writer/aptImage';
import { Engine } from '../../webview/apt/avm/engine';
import {
  bindingsOf,
  findGadgets,
  readBinding,
  writeBinding,
} from '../../webview/apt/gadgetModel';
import { Player } from '../../webview/apt/player';
import type { PageMovie } from '../../webview/apt/protocol';

/** Engine gadgets (ported from mint's apt-viewer `gadget.rs`), on synthetic movies */

const movieWith = (children: string[], script: string): PageMovie => {
  const image = new AptImage(new Uint8Array(64));
  const items: FrameItem[] = children.map(
    (name, at) =>
      ({
        offset: 0,
        type: 'placeObject',
        flags: 0,
        depth: at + 1,
        character: 1,
        name,
      }) as FrameItem,
  );
  const block = compileScript(parseScript(script), image, []);

  items.push({ offset: 0, type: 'action', block } as FrameItem);
  return {
    name: 'Menu',
    record: { screenWidth: 100, screenHeight: 100 },
    characters: [
      { id: 0, offset: 0, type: 'movie' },
      { id: 1, offset: 0, type: 'sprite' },
    ],
    imports: [],
    exports: [],
    frames: [{ items }, { items: [] }],
    spriteFrames: { 1: [{ items: [] }] },
    shapes: {},
    imageTextures: {},
    imageLocations: {},
    behaviours: {},
    code: { [block]: decodeBlock(image.bytes, block) },
    consts: [],
  } as unknown as PageMovie;
};

const start = (host: PageMovie) => {
  const engine = new Engine(
    () => {},
    () => {},
  );

  engine.reset(host);

  const player = new Player(host, 0, {
    resolve: (from, id) =>
      from.characters[id] && {
        movie: from,
        id,
        character: from.characters[id],
      },
    scripts: true,
    rootScripts: true,
    engine,
  });

  return { player, engine };
};

suite('APT gadgets', () => {
  test('_type, _Load and _imageName tell the kind; an unknown _type is a placeholder', () => {
    assert.strictEqual(classifySurface({ type: 'HorzSlider' })?.kind, 'slider');
    assert.strictEqual(classifySurface({ type: 'checkbox' })?.kind, 'checkbox');
    assert.strictEqual(classifySurface({ type: 'ListBox' })?.kind, 'listbox');
    assert.strictEqual(classifySurface({ type: 'ComboBox' })?.kind, 'combobox');
    assert.strictEqual(classifySurface({ type: 'TextEntry' })?.kind, 'textentry');
    assert.strictEqual(classifySurface({ type: 'VertScrollBar' })?.kind, 'scrollbar');
    assert.strictEqual(classifySurface({ type: 'ProgressBar' })?.kind, 'progressbar');
    assert.strictEqual(
      classifySurface({ type: 'Swatch', load: 'Apt\\ComboBox.wnd' })?.kind,
      'combobox',
      'the template wins when the type is not a gadget name',
    );
    assert.strictEqual(
      classifySurface({ type: 'Swatch', imageName: 'Pic' })?.kind,
      'image',
    );

    const unknown = classifySurface({ type: 'FlameThrower' });

    assert.strictEqual(unknown?.kind, 'unknown');
    assert.strictEqual(unknown?.label, '[engine surface: FlameThrower]');
    assert.strictEqual(classifySurface({}), undefined);
  });

  test('values clamp, map from pointer position and read items', () => {
    assert.deepStrictEqual(rangeOf(10, 0), [0, 10]);
    assert.deepStrictEqual(rangeOf('x', undefined), [0, 100]);
    assert.strictEqual(clamp(7, [0, 5]), 5);
    assert.strictEqual(valueAt(50, 100, [0, 10]), 5);
    assert.strictEqual(valueAt(-9, 100, [0, 10]), 0);
    assert.strictEqual(valueAt(9, 0, [3, 10]), 3);
    assert.strictEqual(fraction(25, [0, 100]), 0.25);
    assert.strictEqual(fraction(1, [5, 5]), 0);
    assert.deepStrictEqual(itemsOf('a|b|c'), ['a', 'b', 'c']);
    assert.deepStrictEqual(itemsOf(undefined), []);
  });

  test('a running movie lists the clips that set a surface type', () => {
    const { player } = start(
      movieWith(
        ['volume', 'plain', 'odd', 'pic'],
        'volume._type = "HorzSlider"; odd._type = "Mystery"; pic._imageName = "Banner";',
      ),
    );
    const found = findGadgets(player);

    assert.deepStrictEqual(
      found.map((each) => [each.path, each.kind]),
      [
        ['volume', 'slider'],
        ['odd', 'unknown'],
        ['pic', 'image'],
      ],
    );
  });

  test('a gadget reads its fallback, writes the clip and an override, and clears both', () => {
    const { player, engine } = start(
      movieWith(['volume'], 'volume._type = "HorzSlider"; volume._max = 10;'),
    );
    const gadget = findGadgets(player)[0];
    const value = () => bindingsOf(player, engine, gadget)[0];

    assert.strictEqual(value().value, '0');
    assert.ok(!value().overridden);

    writeBinding(player, engine, gadget, '_value', '7');
    assert.strictEqual(value().value, '7');
    assert.ok(value().overridden);
    assert.strictEqual(engine.overrides.get('volume._value'), '7');
    assert.strictEqual(
      player.vm?.objectOf(gadget.instance).get('_value'),
      7,
      'the movie sees what the control holds',
    );
    assert.strictEqual(
      readBinding(player, engine, gadget, { name: '_max', fallback: 100 }),
      10,
      'a value the movie set is read from the clip',
    );

    writeBinding(player, engine, gadget, '_value', '');
    assert.strictEqual(value().value, '0');
    assert.ok(!engine.overrides.has('volume._value'));
  });

  test('a clip whose name is missing is still listed and written, without an override', () => {
    const { player, engine } = start(
      movieWith([''], 'this._type = "CheckBox";'),
    );

    // The anonymous child is not the root, so it is listed from its own variables
    const child = player.root.children.values().next().value!;

    player.vm!.objectOf(child).set('_type', 'CheckBox');

    const gadget = findGadgets(player)[0];

    assert.strictEqual(gadget.path, undefined);
    writeBinding(player, engine, gadget, '_checked', 'true');
    assert.strictEqual(engine.overrides.size, 0);
    assert.strictEqual(player.vm!.objectOf(child).get('_checked'), true);
  });
});
