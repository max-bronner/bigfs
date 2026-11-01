/// <reference lib="dom" />
// The engine module is webview code and names DOM types; the test only runs its pure parts.
import * as assert from 'assert';
import { classifySurface } from '../../formats/apt/aptGadgets';
import {
  BACKDROP_KEY,
  BLACK,
  drawsGrey,
  findEngineImage,
  getSurfaceKey,
  isTextureFile,
} from '../../game/apt/engineImages';
import { readJpegSize } from '../../formats/texture/jpegSize';
import { Engine } from '../../webview/apt/avm/engine';

suite('APT engine images', () => {
  test('the game fills surfaces no movie names', () => {
    assert.strictEqual(
      findEngineImage(getSurfaceKey({ type: 'RenderImage' }, 'MainMenu', 'Image'))?.image,
      'LogoWithShadow',
    );
    assert.strictEqual(
      findEngineImage(getSurfaceKey({ type: 'RenderFactionIcon' }, 'Palantir', 'A.B'))?.image,
      'AptIconMen',
    );
    assert.strictEqual(
      findEngineImage(getSurfaceKey({ type: 'RenderImage' }, 'Palantir', 'CommandUI.Portrait'))?.image,
      BLACK,
    );
    assert.strictEqual(findEngineImage(BACKDROP_KEY)?.image, 'ShellMapLowLOD');
  });

  test('a default goes with the surface it belongs to, not every clip of that name', () => {
    assert.strictEqual(
      findEngineImage(getSurfaceKey({ type: 'RenderImage' }, 'CahManager', 'Image')),
      undefined,
    );
  });

  test('a surface goes by the name it holds, before its type or place', () => {
    assert.strictEqual(
      getSurfaceKey({ type: 'RenderImage', imageMap: 'Cah::Portrait', imageName: 'X' }, 'M', 'p'),
      'Cah::Portrait',
    );
    assert.strictEqual(getSurfaceKey({ imageName: 'X', imageMap: ' ' }, 'M', 'p'), 'X');
    assert.strictEqual(getSurfaceKey({ type: 'RenderImage', imageMap: '' }, 'M', 'a.b'), 'M.a.b');
  });

  test('an image surface is told by its type, a disabled one in grey', () => {
    for (const type of ['RenderImage', 'RenderImageDisabled', 'RenderFactionIcon']) {
      assert.strictEqual(classifySurface({ type })?.kind, 'image', type);
    }
    assert.ok(drawsGrey({ type: 'RenderImageDisabled' }));
    assert.ok(drawsGrey({ type: 'RenderImage', mode: 'GRAYSCALE' }));
    assert.ok(!drawsGrey({ type: 'RenderImage', mode: 'ALPHA' }));
  });

  test('a picture the user gives a surface is kept with the movie and clears with the overrides', () => {
    const engine = new Engine(
      () => {},
      () => {},
    );

    engine.overrideImage('MainMenu.Image', 'MyLogo');

    const saved = engine.save();
    const next = new Engine(
      () => {},
      () => {},
    );

    assert.deepStrictEqual(saved.images, { 'mainmenu.image': 'MyLogo' });
    next.load(saved);
    assert.strictEqual(next.imageOverrides.get('mainmenu.image'), 'MyLogo');
    next.overrideImage('MainMenu.Image', ' ');
    assert.strictEqual(next.imageOverrides.size, 0);
    engine.clear();
    assert.strictEqual(engine.imageOverrides.size, 0);
  });

  test('an image value names a texture file by its extension', () => {
    assert.ok(isTextureFile('art.TGA'));
    assert.ok(isTextureFile('art.jpg'));
    assert.ok(!isTextureFile('LogoWithShadow'));
  });

  test('a JPEG size is read from its frame, and junk has none', () => {
    assert.deepStrictEqual(
      readJpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xc2, 0, 11, 8, 0, 16, 0, 32, 3, 0])),
      [32, 16],
    );
    assert.strictEqual(readJpegSize(Uint8Array.from([1, 2, 3])), undefined);
    assert.strictEqual(
      readJpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])),
      undefined,
    );
  });
});
