/** Builds a synthetic map body, since no shipped map may be committed */
export const buildMap = () => {
  const names = [
    'WorldInfo',
    'HeightMapData',
    'GlobalLighting',
    'ObjectsList',
    'Object',
    'SidesList',
    'mapName',
    'weather',
    'objectName',
    'playerName',
    'isHuman',
    'Teams',
    'teamName',
    'TriggerAreas',
    'PlayerScriptsList',
    'ScriptList',
    'ScriptGroup',
    'Script',
    'OrCondition',
    'Condition',
    'ScriptAction',
    'CONDITION_TRUE',
    'DEBUG_STRING',
  ];
  const out: number[] = [];
  const u8 = (...values: number[]) => out.push(...values);
  const u16 = (value: number) => out.push(value & 255, value >> 8);
  const u32 = (value: number) =>
    out.push(
      value & 255,
      (value >>> 8) & 255,
      (value >>> 16) & 255,
      (value >>> 24) & 255,
    );
  const f32 = (value: number) =>
    out.push(...new Uint8Array(new Float32Array([value]).buffer));
  const str = (text: string) => {
    u16(text.length);
    out.push(...Array.from(text, (char) => char.charCodeAt(0)));
  };
  const key = (name: string, type: number) =>
    u32(((names.indexOf(name) + 1) << 8) | type);
  const chunk = (name: string, version: number, body: () => void) => {
    u32(names.indexOf(name) + 1);
    u16(version);

    const lengthAt = out.length;

    u32(0);

    const start = out.length;

    body();

    const length = out.length - start;

    out.splice(
      lengthAt,
      4,
      length & 255,
      (length >>> 8) & 255,
      (length >>> 16) & 255,
      length >>> 24,
    );
  };

  out.push(...Array.from('CkMp', (char) => char.charCodeAt(0)));
  u32(names.length);
  names.forEach((name, index) => {
    u8(name.length, ...Array.from(name, (char) => char.charCodeAt(0)));
    u32(index + 1);
  });
  chunk('HeightMapData', 5, () => {
    u32(3);
    u32(2);
    u32(1);
    u32(1);
    u32(1);
    u32(0);
    u32(6);
    [0, 10, 20, 30, 40, 50].forEach(u16);
  });
  chunk('WorldInfo', 1, () => {
    u16(2);
    key('mapName', 3);
    str('Fords');
    key('weather', 1);
    u32(0);
  });
  chunk('GlobalLighting', 8, () => {
    u32(2);
    for (let index = 0; index < 4 * 9 * 9; index++) {
      f32(index % 9 === 8 ? -1 : 0.5);
    }
    f32(1);
    for (let index = 0; index < 11 + 3; index++) {
      u32(0);
    }
  });
  chunk('ObjectsList', 3, () => {
    for (const [x, template] of [
      [10, 'GondorFarm'],
      [20, '*Waypoints/Waypoint'],
    ] as const) {
      chunk('Object', 3, () => {
        f32(x);
        f32(5);
        f32(0);
        f32(0);
        u32(0);
        str(template);
        u16(1);
        key('objectName', 3);
        str(`obj${x}`);
      });
    }
  });
  chunk('SidesList', 6, () => {
    u8(1);
    u32(1);
    u16(2);
    key('playerName', 3);
    str('Gondor');
    key('isHuman', 0);
    u8(1);
    u32(0);
  });
  chunk('Teams', 1, () => {
    u32(1);
    u16(1);
    key('teamName', 3);
    str('teamGondor');
  });
  chunk('TriggerAreas', 1, () => {
    u32(1);
    str('Ford');
    str('');
    u32(7);
    u32(3);
    [0, 0, 100, 0, 50, 80].forEach(f32);
    u32(0);
  });
  const call = (type: string, name: string, text: string) =>
    chunk(type, 1, () => {
      u32(0);
      key(name, 3);
      u32(1);
      u32(0);
      u32(0);
      f32(0);
      str(text);
    });

  chunk('PlayerScriptsList', 1, () => {
    chunk('ScriptList', 1, () => {
      chunk('ScriptGroup', 2, () => {
        str('Intro');
        u8(1, 0);
        chunk('Script', 2, () => {
          str('SayHello');
          str('greets');
          str('');
          str('');
          u8(1, 1, 1, 1, 0, 0);
          u32(0);
          chunk('OrCondition', 1, () =>
            call('Condition', 'CONDITION_TRUE', ''),
          );
          call('ScriptAction', 'DEBUG_STRING', 'hello');
        });
      });
    });
  });

  return Uint8Array.from(out);
};
