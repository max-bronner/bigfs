import * as assert from 'assert';
import {
  fieldOf,
  labelled,
  parseWnd,
  toBoxes,
} from '../../formats/wnd/wndLayout';

const LAYOUT = [
  'FILE_VERSION = 2;',
  'STARTLAYOUTBLOCK',
  '  LAYOUTINIT = MenuInit;',
  'ENDLAYOUTBLOCK',
  'WINDOW',
  '  WINDOWTYPE = USER;',
  '  SCREENRECT = UPPERLEFT: 0 0,',
  '               BOTTOMRIGHT: 800 600,',
  '               CREATIONRESOLUTION: 800 600;',
  '  NAME = "Menu.wnd:Parent";',
  '  STATUS = ENABLED+IMAGE;',
  '  ENABLEDDRAWDATA = IMAGE: NoImage, COLOR: 10 20 30 255, BORDERCOLOR: 0 0 0 0;',
  '  CHILD',
  '  WINDOW',
  '    WINDOWTYPE = PUSHBUTTON;',
  '    SCREENRECT = UPPERLEFT: 10 20, BOTTOMRIGHT: 110 50, CREATIONRESOLUTION: 800 600;',
  '    NAME = "Menu.wnd:ButtonOk";',
  '    STATUS = ENABLED+HIDDEN;',
  '    TEXT = "OK";',
  '  END',
  '  ENDALLCHILDREN',
  'END',
].join('\n');

suite('WND layouts', () => {
  test('windows nest with their fields and spans', () => {
    const layout = parseWnd(LAYOUT);

    assert.deepStrictEqual(layout.problems, []);
    assert.deepStrictEqual(
      layout.fields.map((field) => field.key),
      ['FILE_VERSION', 'LAYOUTINIT'],
    );
    assert.strictEqual(layout.windows[0].children.length, 1);
    assert.ok(LAYOUT.slice(layout.windows[0].start).startsWith('WINDOW'));
    assert.ok(LAYOUT.slice(0, layout.windows[0].end).endsWith('END'));
    assert.strictEqual(
      layout.windows[0].fields.find((field) => field.key === 'SCREENRECT')
        ?.value,
      'UPPERLEFT: 0 0, BOTTOMRIGHT: 800 600, CREATIONRESOLUTION: 800 600',
    );
  });

  test('records read by label, with or without commas', () => {
    assert.deepStrictEqual(
      labelled('UPPERLEFT: 1 2 BOTTOMRIGHT:3 4, NAME: "Times New Roman"'),
      [
        ['UPPERLEFT', ['1', '2']],
        ['BOTTOMRIGHT', ['3', '4']],
        ['NAME', ['"Times New Roman"']],
      ],
    );
  });

  test('the preview boxes carry rect, colour, text and visibility', () => {
    const [parent] = toBoxes(parseWnd(LAYOUT).windows);
    const [button] = parent.children;

    assert.deepStrictEqual(parent.rect, [0, 0, 800, 600]);
    assert.deepStrictEqual(parent.color, [10, 20, 30, 255]);
    assert.strictEqual(parent.image, undefined);
    assert.deepStrictEqual(
      [button.name, button.type, button.text, button.hidden],
      ['Menu.wnd:ButtonOk', 'PUSHBUTTON', 'OK', true],
    );
  });

  test('every problem is reported, not just the first', () => {
    const layout = parseWnd(
      'WINDOW\n  NAME "x";\n  WINDOW\n  END\nENDALLCHILDREN\nWINDOW\n  TEXT = "open',
    );

    assert.deepStrictEqual(
      layout.problems.map((problem) => problem.message.replace(/ .*/, '')),
      ['This', 'NAME', 'WINDOW', 'ENDALLCHILDREN', 'WINDOW', 'This', 'TEXT'],
    );
  });

  const boxOf = (...lines: string[]) =>
    toBoxes(
      parseWnd(
        [
          'WINDOW',
          '  SCREENRECT = UPPERLEFT: 0 0, BOTTOMRIGHT: 100 40, CREATIONRESOLUTION: 800 600;',
          ...lines,
          'END',
        ].join('\n'),
      ).windows,
    )[0];

  test('a check box draws slots 1 and 2, never the fill of slot 0', () => {
    const box = boxOf(
      '  WINDOWTYPE = CHECKBOX;',
      '  ENABLEDDRAWDATA = IMAGE: NoImage, COLOR: 255 0 0 255,',
      '    IMAGE: Foo, IMAGE: FooChecked;',
    );

    assert.deepStrictEqual(box.looks.enabled, [{ role: 'box', image: 'Foo' }]);
    assert.deepStrictEqual(box.looks['enabled+checked'], [
      { role: 'box', image: 'FooChecked' },
    ]);
  });

  test('a slider reads its bar from the disabled data, its thumb from its own', () => {
    const box = boxOf(
      '  WINDOWTYPE = HORZSLIDER;',
      '  DISABLEDDRAWDATA = IMAGE: BarFull, IMAGE: BarEmpty;',
      '  HILITEDRAWDATA = IMAGE: Outline;',
      '  ENABLEDDRAWDATA = IMAGE: Unused;',
      '  SLIDERTHUMBENABLEDDRAWDATA = IMAGE: Thumb;',
      '  SLIDERTHUMBHILITEDRAWDATA = IMAGE: ThumbHot;',
    );

    assert.deepStrictEqual(box.looks.enabled, [
      { role: 'bar-filled', image: 'BarFull' },
      { role: 'bar-empty', image: 'BarEmpty' },
      { role: 'thumb', image: 'Thumb' },
    ]);
    assert.deepStrictEqual(
      box.looks.hilite?.map((part) => part.image),
      ['BarFull', 'BarEmpty', 'Outline', 'ThumbHot'],
    );
  });

  test('a list box takes its selection image from slot 3 and its colours from slot 1', () => {
    const box = boxOf(
      '  WINDOWTYPE = SCROLLLISTBOX;',
      '  ENABLEDDRAWDATA = IMAGE: Body, IMAGE: NoImage, COLOR: 1 2 3 255, IMAGE: NoImage, IMAGE: Row;',
      '  LISTBOXENABLEDUPBUTTONDRAWDATA = IMAGE: Up;',
      '  SLIDERTHUMBENABLEDDRAWDATA = IMAGE: Cap, IMAGE: NoImage, IMAGE: NoImage, IMAGE: NoImage, IMAGE: NoImage, IMAGE: Mid, IMAGE: End;',
    );

    assert.deepStrictEqual(
      box.looks.enabled?.map((part) => [part.role, part.image]),
      [
        ['body', 'Body'],
        ['selection', 'Row'],
        ['up', 'Up'],
        ['thumb-top', 'Cap'],
        ['thumb-middle', 'Mid'],
        ['thumb-bottom', 'End'],
      ],
    );
  });

  test('colours fill only a window that names no image', () => {
    const plain = boxOf(
      '  WINDOWTYPE = USER;',
      '  ENABLEDDRAWDATA = IMAGE: NoImage, COLOR: 10 20 30 255, BORDERCOLOR: 1 1 1 255;',
    );
    const imaged = boxOf(
      '  WINDOWTYPE = USER;',
      '  ENABLEDDRAWDATA = IMAGE: Pic, COLOR: 10 20 30 255;',
    );

    assert.deepStrictEqual(plain.looks.enabled, [
      { role: 'body', color: [10, 20, 30, 255], border: [1, 1, 1, 255] },
    ]);
    assert.deepStrictEqual(imaged.looks.enabled, [
      { role: 'body', image: 'Pic' },
    ]);
  });

  test('a key stated twice reads as its last statement', () => {
    const [window] = parseWnd(
      'WINDOW\n NAME = "a";\n NAME = "b";\nEND',
    ).windows;

    assert.strictEqual(fieldOf(window, 'NAME')?.value, '"b"');
  });

  test('text goes through the string table and keeps its font and colours', () => {
    const [box] = toBoxes(
      parseWnd(
        [
          'WINDOW',
          '  SCREENRECT = UPPERLEFT: 0 0, BOTTOMRIGHT: 10 10;',
          '  STATUS = ENABLED+WRAP_CENTERED;',
          '  TEXT = "GUI:Okay";',
          '  FONT = NAME: "Arial", SIZE: 12, BOLD: 1;',
          '  TEXTCOLOR = ENABLED: 1 2 3 255, ENABLEDBORDER: 0 0 0 0, DISABLED: 4 5 6 255, DISABLEDBORDER: 0 0 0 0, HILITE: 7 8 9 255, HILITEBORDER: 0 0 0 0;',
          'END',
        ].join('\n'),
      ).windows,
      { text: (value) => (value === 'GUI:Okay' ? 'OK' : undefined) },
    );

    assert.deepStrictEqual(
      [box.text, box.shown, box.wrapCentered, box.font],
      ['GUI:Okay', 'OK', true, { name: 'Arial', size: 12, bold: true }],
    );
    assert.deepStrictEqual(box.textColors?.hilite, [7, 8, 9, 255]);
  });

  test('a child the engine places at 0 0 is moved inside its parent or hidden', () => {
    const child = (right: number) =>
      [
        '  CHILD',
        '  WINDOW',
        `    SCREENRECT = UPPERLEFT: 0 0, BOTTOMRIGHT: ${right} 20;`,
        '  END',
        '  ENDALLCHILDREN',
      ].join('\n');
    const [fits, tooBig] = [30, 500].map(
      (right) =>
        toBoxes(
          parseWnd(
            `WINDOW\n  SCREENRECT = UPPERLEFT: 100 100, BOTTOMRIGHT: 200 140;\n${child(right)}\nEND`,
          ).windows,
        )[0].children[0],
    );

    assert.deepStrictEqual(fits.rect, [100, 100, 130, 120]);
    assert.strictEqual(fits.laidOut, true);
    assert.strictEqual(tooBig.hidden, true);
  });
});
