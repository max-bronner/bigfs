import * as assert from 'assert';
import { labelled, parseWnd, toBoxes } from '../../language/model/wndLayout';

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
});
