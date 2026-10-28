import * as assert from 'assert';
import { languageOf, translationGaps } from '../../game/text/translations';

const table = (path: string, language: string, labels: [string, string][]) => ({
  path,
  language,
  labels: new Map(
    labels.map(([label, text]) => [label.toLowerCase(), { label, text }]),
  ),
});

suite('Translations', () => {
  test('a language comes from the path, then the csf header', () => {
    assert.deepStrictEqual(
      [
        languageOf('mod/lang/german/lotr.str'),
        languageOf('data/lotr_french.str'),
        languageOf('Data/lotr.csf', 2),
        languageOf('data/lotr.str'),
      ],
      ['german', 'french', 'german', 'unknown'],
    );
  });

  test('each language lacks what the others have, with English text to stand in', () => {
    const gaps = translationGaps([
      table('en/a.str', 'english', [
        ['OBJECT:Ranger', 'Ranger'],
        ['OBJECT:Archer', 'Archer'],
      ]),
      table('de/a.str', 'german', [['OBJECT:Archer', 'Bogenschütze']]),
      table('de/b.str', 'german', [['OBJECT:Catapult', 'Katapult']]),
    ]);

    assert.deepStrictEqual(gaps, [
      {
        language: 'english',
        tables: ['en/a.str'],
        missing: [
          { label: 'OBJECT:Catapult', text: 'Katapult', from: 'german' },
        ],
      },
      {
        language: 'german',
        tables: ['de/a.str', 'de/b.str'],
        missing: [{ label: 'OBJECT:Ranger', text: 'Ranger', from: 'english' }],
      },
    ]);
  });
});
