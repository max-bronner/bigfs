import * as assert from 'assert';
import path from 'path';
import { planLaunch } from '../../common/launchPlan';

suite('Launching the game', () => {
  test('the mod folder goes after -mod, extra arguments before it', () => {
    const executable = path.join('games', 'rotwk', 'game.exe');
    const plan = planLaunch(executable, path.join('mods', 'my mod'), ['-win']);

    assert.deepStrictEqual(plan, {
      command: executable,
      args: ['-win', '-mod', path.join('mods', 'my mod')],
      cwd: path.join('games', 'rotwk'),
    });
  });
});
