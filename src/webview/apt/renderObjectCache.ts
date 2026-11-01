import type { ModelScene } from '../../formats/w3d/w3dScene';

/** A loaded render object, with what its surfaces keep between draws */
export interface RenderObject {
  name: string;
  scene: ModelScene;
  /** The frame of its own animation; surfaces showing it share one clock */
  frame: number;
  /** Whether it was only seen on a still stage, so it shows where it comes to rest */
  isResting: boolean;
  /** The player tick the frame was reached at */
  tick: number;
  /** The last draw of the stage that showed it */
  pass: number;
}

/** What the cache needs of the page around it */
export interface RenderObjectHost {
  /** Asks the editor for a model; `arrive` or `fail` must follow */
  ask(name: string): void;
  /** Frees what was built for an object the cache let go */
  release(object: RenderObject): void;
}

/** Render objects held at once, which keeps a movie naming thousands within memory */
export const MAX_RENDER_OBJECTS = 16;

/** What a surface can show now: a model, or a reason it has none */
export type RenderObjectState =
  | { object: RenderObject }
  | { pending: true }
  | { unavailable: string };

/** Render objects the page holds, asked of the editor one at a time when a surface first shows them */
export interface RenderObjectCache {
  /** Gets a model for a surface shown in draw `pass`, asking for it on first use */
  get(name: string, pass: number): RenderObjectState;
  /** Takes the editor's model */
  arrive(name: string, scene: ModelScene): void;
  /** Takes the reason the editor has no such model */
  fail(name: string, reason: string): void;
}

/**
 * Creates the cache. Only what a surface shows is ever asked for, and past
 * `MAX_RENDER_OBJECTS` a new model takes the place of one no surface showed in
 * the last draw; with none to give up it waits, labelled.
 */
export const createRenderObjectCache = (
  host: RenderObjectHost,
): RenderObjectCache => {
  const held = new Map<string, RenderObject>();
  const failed = new Map<string, string>();
  const waiting: string[] = [];
  let asking: string | undefined;

  const askNext = () => {
    if (asking === undefined && waiting.length) {
      asking = waiting.shift()!;
      host.ask(asking);
    }
  };

  /** Makes room for one more, and says whether there is any */
  const makeRoom = (pass: number): boolean => {
    if (held.size + waiting.length + (asking === undefined ? 0 : 1) < MAX_RENDER_OBJECTS) {
      return true;
    }

    const idle = [...held.values()]
      .filter((each) => each.pass < pass - 1)
      .sort((a, b) => a.pass - b.pass)[0];

    if (!idle) {
      return false;
    }
    held.delete(idle.name.toLowerCase());
    host.release(idle);
    return true;
  };

  const settle = (key: string) => {
    if (key === asking) {
      asking = undefined;
    }
    askNext();
  };

  return {
    get(name, pass) {
      const key = name.toLowerCase();
      const object = held.get(key);

      if (object) {
        return { object };
      }

      const reason = failed.get(key);

      if (reason !== undefined) {
        return { unavailable: reason };
      }
      if (key === asking || waiting.includes(key)) {
        return { pending: true };
      }
      if (!makeRoom(pass)) {
        return {
          unavailable: `${MAX_RENDER_OBJECTS} models are already shown`,
        };
      }
      waiting.push(key);
      askNext();
      return { pending: true };
    },
    arrive(name, scene) {
      const key = name.toLowerCase();

      held.set(key, { name, scene, frame: 0, isResting: false, tick: 0, pass: 0 });
      settle(key);
    },
    fail(name, reason) {
      const key = name.toLowerCase();

      failed.set(key, reason);
      settle(key);
    },
  };
};
