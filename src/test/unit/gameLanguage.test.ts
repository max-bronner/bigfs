import * as assert from 'assert';
import {
  chooseLanguage,
  installedLanguages,
  languageOfArchive,
} from '../../game/text/gameLanguage';
import {
  collectTextKeys,
  resolveAptText,
  stripTextStyle,
} from '../../formats/apt/aptText';

suite('Game language', () => {
  test('a language is a lang/<Language>.big archive, never its speech archive', () => {
    assert.strictEqual(languageOfArchive('lang/English.big'), 'english');
    assert.strictEqual(
      languageOfArchive('C:\\Game\\Lang\\German.BIG'),
      'german',
    );
    assert.strictEqual(languageOfArchive('lang/EnglishAudio.big'), undefined);
    assert.strictEqual(languageOfArchive('art/English.big'), undefined);
    assert.deepStrictEqual(
      installedLanguages([
        'lang/English.big',
        'lang/EnglishAudio.big',
        'lang/French.big',
        'lang/English.big',
        'maps.big',
      ]),
      ['english', 'french'],
    );
  });

  test('auto takes the only language, else a remembered one, else asks', () => {
    assert.deepStrictEqual(chooseLanguage('auto', ['german']), {
      language: 'german',
      ask: false,
    });
    assert.deepStrictEqual(chooseLanguage('auto', ['german', 'french']), {
      ask: true,
    });
    assert.deepStrictEqual(
      chooseLanguage('auto', ['german', 'french'], 'french'),
      { language: 'french', ask: false },
    );
    assert.deepStrictEqual(
      chooseLanguage('auto', ['german', 'french'], 'polish'),
      { ask: true },
    );
    assert.deepStrictEqual(chooseLanguage('auto', []), { ask: false });
  });

  test('a named language in the setting wins without asking', () => {
    assert.deepStrictEqual(chooseLanguage('French', ['german', 'french']), {
      language: 'french',
      ask: false,
    });
  });
});

suite('APT $KEY text', () => {
  const table = new Map([
    ['apt:soloplay', 'SOLO PLAY'],
    ['gui:player', 'Player'],
  ]);
  const find = (label: string) => table.get(label.toLowerCase());

  test('tries APT:key, then the key, and strips the style marker', () => {
    assert.strictEqual(resolveAptText('$SoloPlay', find), 'SOLO PLAY');
    assert.strictEqual(
      resolveAptText('$SoloPlay&dropShadow', find),
      'SOLO PLAY',
    );
    assert.strictEqual(resolveAptText('$GUI:Player', find), 'Player');
  });

  test('a missing key shows the game placeholder; plain text is kept', () => {
    assert.strictEqual(resolveAptText('$Nope', find), "MISSING: 'APT:Nope'");
    assert.strictEqual(resolveAptText('40%&dropShadow', find), '40%');
    assert.strictEqual(resolveAptText('$', find), '$');
    assert.strictEqual(stripTextStyle('a&b'), 'a&b');
  });

  test('collects each distinct key once', () => {
    assert.deepStrictEqual(
      collectTextKeys(['$A', '$A&dropShadow', 'plain', 3, '$B']),
      ['$A', '$B'],
    );
  });
});
