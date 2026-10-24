import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import {
  findGameTextLabels,
  labelOfMissingText,
  missingTextMessage,
  placeholderText,
} from '../../language/model/gameTextLabels';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

suite('Game-text labels', () => {
  test('labels are found, coordinates, colours and weights are not', () => {
    const parsed = parseSageIni(
      [
        'Object LabelTest',
        '  DisplayName = OBJECT:LabelTestUnit',
        '  Description = CONTROLBAR:ToolTip_LabelTest',
        '  GeometryOffset = X:10 Y:0 Z:0',
        'End',
        'AudioEvent LabelSound',
        '  Sounds = LOUD:2000',
        'End',
      ],
      schema,
    );

    assert.deepStrictEqual(
      findGameTextLabels(parsed).map((label) => [label.text, label.line]),
      [
        ['OBJECT:LabelTestUnit', 1],
        ['CONTROLBAR:ToolTip_LabelTest', 2],
      ],
    );
  });

  test('a message names its label, and a new label gets readable text', () => {
    assert.strictEqual(
      labelOfMissingText(missingTextMessage('OBJECT:GondorTowerGuard')),
      'OBJECT:GondorTowerGuard',
    );
    assert.strictEqual(
      placeholderText('OBJECT:GondorTowerGuard'),
      'Gondor Tower Guard',
    );
    assert.strictEqual(
      placeholderText('CONTROLBAR:ToolTip_BuildRCWall'),
      'Tool Tip Build RC Wall',
    );
  });
});
