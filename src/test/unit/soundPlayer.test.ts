import * as assert from 'assert';
import type { PlaySoundRequest, SoundReply } from '../../core/soundClip';
import { createSoundPlayer } from '../../webview/shared/createSoundPlayer';
import type { SoundBackend } from '../../webview/shared/createSoundPlayer';

const plain = { ctrlKey: false, metaKey: false };

const makeBackend = (running = true) => {
  const log: string[] = [];
  const backend: SoundBackend = {
    unlock: () => void log.push('unlock'),
    decode: async (bytes) => bytes.length,
    start: async (decoded) => {
      if (!running) {
        return undefined;
      }
      log.push(`start ${decoded}`);
      return { stop: () => void log.push(`stop ${decoded}`) };
    },
  };

  return { backend, log };
};

const reply = (name: string, id: number, size = 3): SoundReply => ({
  kind: 'sound',
  name,
  id,
  clip: {
    file: `${name}.wav`,
    mime: 'audio/wav',
    data: Buffer.from(new Uint8Array(size)).toString('base64'),
  },
});

const setup = (running = true) => {
  const { backend, log } = makeBackend(running);
  const sent: PlaySoundRequest[] = [];

  return {
    log,
    sent,
    player: createSoundPlayer(backend),
    post: (request: PlaySoundRequest) => void sent.push(request),
  };
};

suite('sound player', () => {
  test('a press asks for the name, unlocks audio, and plays the reply', async () => {
    const { player, post, sent, log } = setup();

    player.press('Gui_Click', plain, post);
    assert.deepStrictEqual(log, ['unlock']);
    assert.strictEqual(sent[0].name, 'Gui_Click');
    assert.strictEqual(sent[0].open, undefined);
    assert.strictEqual(player.state().phase, 'loading');

    await player.receive(reply('Gui_Click', sent[0].id!));
    assert.strictEqual(player.state().phase, 'playing');
    assert.deepStrictEqual(log, ['unlock', 'start 3']);
  });

  test('Ctrl or Cmd asks to open the file and plays nothing', () => {
    const { player, post, sent, log } = setup();

    player.press('Gui_Click', { ctrlKey: true, metaKey: false }, post);
    player.press('Gui_Click', { ctrlKey: false, metaKey: true }, post);
    assert.deepStrictEqual(
      sent.map((request) => request.open),
      [true, true],
    );
    assert.deepStrictEqual(log, []);
    assert.strictEqual(player.state().phase, 'idle');
  });

  test('a second press on the playing sound stops it', async () => {
    const { player, post, sent, log } = setup();

    player.press('A', plain, post);
    await player.receive(reply('A', sent[0].id!));
    player.press('A', plain, post);
    assert.strictEqual(player.state().phase, 'idle');
    assert.strictEqual(sent.length, 1, 'a stop asks for nothing');
    assert.ok(log.includes('stop 3'));
  });

  test('only one sound plays: a new request stops the old one', async () => {
    const { player, post, sent, log } = setup();

    player.press('A', plain, post);
    await player.receive(reply('A', sent[0].id!, 3));
    player.press('B', plain, post);
    assert.ok(log.includes('stop 3'));
    await player.receive(reply('B', sent[1].id!, 5));
    assert.deepStrictEqual(log.filter((entry) => entry.startsWith('start')), [
      'start 3',
      'start 5',
    ]);
    assert.strictEqual(player.state().name, 'B');
  });

  test('a reply for an older request is dropped', async () => {
    const { player, post, sent, log } = setup();

    player.request('A', post);
    player.request('B', post);
    await player.receive(reply('A', sent[0].id!));
    assert.deepStrictEqual(log, []);
    assert.strictEqual(player.state().name, 'B');

    player.press('B', plain, post);
    await player.receive(reply('B', sent[1].id!));
    assert.deepStrictEqual(log, [], 'stopped while loading, so the reply is stale');
  });

  test('a browser that keeps the context suspended leaves the blocked state', async () => {
    const { player, post, sent } = setup(false);

    player.request('A', post);
    await player.receive(reply('A', sent[0].id!));
    assert.strictEqual(player.state().phase, 'blocked');

    player.press('A', plain, post);
    assert.strictEqual(player.state().phase, 'loading', 'a press tries again');
  });

  test('a name with no sound shows why and plays nothing', async () => {
    const { player, post, sent } = setup();

    player.request('A', post);
    await player.receive({
      kind: 'sound',
      name: 'A',
      id: sent[0].id,
      error: 'No sound file for A',
    });
    assert.deepStrictEqual(player.state(), {
      phase: 'idle',
      name: 'A',
      error: 'No sound file for A',
    });
  });
});
