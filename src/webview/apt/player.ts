import { AsObject, toBoolean } from "./avm/value";
import { Vm } from "./avm/vm";
import type { EngineHooks } from "./avm/vmState";
import type { StageHost } from "./avm/value";
import type {
  ButtonRecord,
  Character,
} from "../../formats/apt/aptMovie";
import { isTimeline } from "./instance";
import type { Instance } from "./instance";
import type { PageMovie } from "./protocol";
import { getMovieName } from "./avm/movieLoad";
import { HIT, UP } from "./buttonState";
import { createBehaviourRunner } from "./createBehaviourRunner";
import type { BehaviourRunner } from "./createBehaviourRunner";
import { describeInstance } from "./describeInstance";
import { POINTER_CLIP_EVENTS, POINTER_GESTURES } from "./pointerGestures";
import type { PointerGesture } from "./pointerGestures";
import { SCRIPT_PRIORITY, createScriptQueue } from "./scriptQueue";
import { buildDisplayList, getFrames } from "./timeline";

/**
 * A small APT player: every placed character is an instance, every
 * timeline instance keeps its own playhead, and buttons keep their state,
 * the way a Flash player runs them (mint's player, after Ruffle). With an
 * engine, scripts run as bytecode on the AVM; without one, only what an
 * action block does to timelines (`gotoAndPlay`, `stop`, ...) is played,
 * from the behaviours the extension read out of it.
 *
 * Kept free of the DOM: the page draws and picks, this decides what is
 * shown.
 */

const MAX_DEPTH = 12;
/** The depth of `_level0`'s next sibling: a level sits above every placed depth */
const LEVEL_DEPTH = 1_000_000;

/** A character a placeholder resolves to, with the movie and id it lives at */
export interface Resolved {
  movie: PageMovie;
  id: number;
  character: Character;
}

/** Options for a `Player`: how imports resolve, which scripts run, and who answers for the game */
export interface PlayerOptions {
  resolve: (movie: PageMovie, id: number) => Resolved | undefined;
  /** Whether nested timelines run their frame scripts */
  scripts: boolean;
  /** Whether the root does too; off to step through its frames */
  rootScripts: boolean;
  log?: (line: string) => void;
  /**
   * Finds the movie a script loads (`loadMovie`), by name, and hands it to
   * `done` now or when it arrives, or the reason it cannot be had. Without
   * it a load only says so in the log.
   */
  fetchMovie?: (
    name: string,
    done: (movie: PageMovie | string) => void,
  ) => void;
  /**
   * The engine's side: given, scripts run as bytecode on the AVM and ask
   * it what the game would answer; without, only what they do to
   * timelines is played
   */
  engine?: EngineHooks;
}

/** Clip event bits, as `scriptSites.ts` names them */
const CLIP_EVENT = {
  load: 1 << 0,
  enterFrame: 1 << 1,
  unload: 1 << 2,
  initialize: 1 << 9,
  construct: 1 << 18,
};

/** Player of one character's timelines and buttons, and the stage the AVM drives */
export class Player implements StageHost {
  /** The instance of the character played, the top of the display tree */
  public readonly root: Instance;
  /** Ticks played so far; an instance created in this tick starts playing on the next */
  public ticks = 0;
  /** The ActionScript machine, when an engine answers for the game */
  public readonly vm?: Vm;
  private readonly runBehaviour: BehaviourRunner;
  private readonly queue = createScriptQueue(
    () => !this.vm || this.vm.isBusy,
    (limit) =>
      this.options.log?.(
        `stopped after ${limit} scripts in one go: scripts keep starting each other`,
      ),
  );
  /** Clips to run each frame, newest first (Ruffle's execution list) */
  private clips: Instance[] = [];

  public constructor(
    movie: PageMovie,
    id: number,
    private readonly options: PlayerOptions,
  ) {
    this.runBehaviour = createBehaviourRunner(this, (line) =>
      options.log?.(line),
    );
    if (options.engine) {
      this.vm = new Vm(this, options.engine);
    }
    // Scripts wait until the root exists, as mint's apt-player runs actions
    // only once it has a root; one that reads `_root` would find nothing
    this.root = this.queue.hold(() => {
      this.queueInitActions(movie);
      return this.create(movie, id, "", undefined, {
        matrix: [1, 0, 0, 1],
        translate: [0, 0],
        alpha: 1,
        born: 0,
      });
    });
    this.idle();
  }

  /**
   * Queues every init action of a movie's timelines, to run as the root
   * before the first frame (mint's queue_init_actions, after Ruffle's
   * preload), not when the frame holding one is entered
   */
  private queueInitActions(movie: PageMovie, on?: Instance): void {
    const vm = this.vm;

    if (!vm) {
      return;
    }
    const timelines = [
      movie.frames,
      ...movie.characters.flatMap((character) =>
        character.type === "sprite"
          ? [movie.spriteFrames[character.id] ?? []]
          : [],
      ),
    ];

    for (const frames of timelines) {
      for (const frame of frames) {
        for (const item of frame.items) {
          const key = `${movie.name}#${item.type === "initAction" ? item.sprite : ""}`;

          if (item.type === "initAction" && !vm.initialised.has(key)) {
            vm.initialised.add(key);
            this.queue.add(
              () => vm.runBlock(on ?? this.root, item.block),
              SCRIPT_PRIORITY.initialize,
            );
          }
        }
      }
    }
  }

  // ---- loadMovie

  /**
   * Loads into a clip, or into a level (a number), for `loadMovie`/`unloadMovie`:
   * the movie a URL names replaces the clip's content, once it is found, and no
   * URL empties it. Nothing here throws; a movie that cannot be had is a line
   * in the log.
   */
  public loadMovie(into: Instance | number, url: string | undefined): void {
    const log = (line: string) => this.options.log?.(`loadMovie: ${line}`);

    if (typeof into !== "number" && !into.parent) {
      log("the movie shown cannot be replaced or emptied");
      return;
    }
    if (url === undefined) {
      this.queue.add(() => this.unload(into));
      this.idle();
      return;
    }

    const name = getMovieName(url);

    if (!name) {
      log(`${JSON.stringify(url)} names no movie`);
      return;
    }
    if (into === 0) {
      log(`${name} cannot replace _level0, the movie shown`);
      return;
    }
    if (!this.options.fetchMovie) {
      log(`${name} cannot be loaded here`);
      return;
    }
    this.options.fetchMovie(name, (found) => {
      if (typeof found === "string") {
        log(`${name} not loaded: ${found}`);
        return;
      }
      // After the script that asked has finished, as Flash loads on the
      // next frame; a clip gone meanwhile loads nothing
      this.queue.add(() => this.mount(into, found));
      this.idle();
    });
  }

  private levelClip(level: number): Instance | undefined {
    return [...this.root.children.values()].find(
      (child) => child.name?.toLowerCase() === `_level${level}`,
    );
  }

  /** Puts a movie's root timeline in a clip or level, playing from frame 0 */
  private mount(into: Instance | number, movie: PageMovie): void {
    const rootId = movie.characters.findIndex(
      (character) => character?.type === "movie",
    );
    const clip =
      typeof into === "number"
        ? (this.levelClip(into) ??
          this.createEmpty(this.root, `_level${into}`, LEVEL_DEPTH + into))
        : into;

    if (rootId < 0 || clip.removed) {
      this.options.log?.(
        `loadMovie: ${movie.name} ${rootId < 0 ? "has no root timeline" : "was unloaded before it arrived"}`,
      );
      return;
    }
    clip.children.forEach((child) => this.retire(child));
    clip.children = new Map();
    clip.hits = [];
    clip.movie = movie;
    clip.id = rootId;
    clip.character = movie.characters[rootId];
    clip.missing = undefined;
    clip.frames = getFrames(movie, clip.character);
    clip.frame = 0;
    clip.playing = true;
    clip.visible = true;

    // A movie loaded again runs its init actions again
    this.vm?.initialised.forEach((key) => {
      if (key.startsWith(`${movie.name}#`)) {
        this.vm!.initialised.delete(key);
      }
    });
    // Runs inside the drain of the script queue: what these queue follows
    this.queueInitActions(movie, clip);
    this.enter(clip, 0);
    this.options.log?.(`loadMovie: ${movie.name} is in ${describeInstance(clip)}`);
    this.idle();
  }

  /** `unloadMovie`: the clip stays, empty and stopped; a level goes */
  private unload(into: Instance | number): void {
    const clip = typeof into === "number" ? this.levelClip(into) : into;

    if (!clip || clip.removed) {
      return;
    }
    if (typeof into === "number") {
      this.remove(clip);
      return;
    }
    clip.children.forEach((child) => this.retire(child));
    clip.children = new Map();
    clip.frames = [];
    clip.frame = 0;
    clip.playing = false;
  }

  /**
   * Plays one frame: every clip advances first, queueing its scripts, and
   * only then do the scripts run, so one sees every clip already on its new
   * frame (mint's `Player::tick`, after Ruffle). A clip made this frame
   * starts playing on the next.
   */
  public tick(): void {
    this.ticks++;
    this.clips = this.clips.filter((clip) => !clip.removed);

    const vm = this.vm;
    const runsScripts = !!vm && this.scriptsRun(this.root);

    if (vm) {
      vm.ticks = this.ticks;
    }
    this.queue.hold(() => {
      for (const clip of [...this.clips]) {
        if (!clip.removed) {
          this.runClipFrame(clip, runsScripts);
        }
      }
    });
    this.idle();
    if (vm && runsScripts) {
      vm.runIntervals();
      this.idle();
    }
  }

  /** Queues a clip's per-frame events, then advances it if it plays */
  private runClipFrame(clip: Instance, runsScripts: boolean): void {
    if (runsScripts) {
      this.clipEvent(clip, CLIP_EVENT.enterFrame);
      this.queueMethod(clip, "onEnterFrame");
    }
    if (!clip.playing) {
      return;
    }
    if (clip.frames.length > 1) {
      this.enter(clip, (clip.frame + 1) % clip.frames.length);
    } else {
      clip.playing = false;
    }
  }

  /** Gets a handler property of a clip; only a clip a script has touched can carry one */
  private findHandler(instance: Instance, name: string): AsObject | undefined {
    const handler = this.vm?.peekObject(instance)?.get(name);

    return handler instanceof AsObject && handler.kind.type === "function"
      ? handler
      : undefined;
  }

  /** Queues a call of a handler property, if the clip carries one when its turn comes */
  private queueMethod(instance: Instance, name: string): void {
    const vm = this.vm;

    if (vm && this.findHandler(instance, name)) {
      this.queue.add(() => {
        const handler = this.findHandler(instance, name);

        if (handler && !instance.removed) {
          vm.callFromEngine(handler, vm.peekObject(instance), []);
        }
      });
    }
  }

  // ---- StageHost, what scripts do to clips

  /** Runs the scripts waiting their turn */
  public idle(): void {
    this.queue.drain();
  }

  /** Plays or stops a clip's timeline */
  public setPlaying(clip: Instance, playing: boolean): void {
    clip.playing = playing;
  }

  /**
   * Places a copy of an exported symbol (`linkage`) or of a clip (`#id`)
   * on a clip, at a depth, under a name
   */
  public attach(
    parent: Instance,
    linkage: string,
    name: string,
    depth: number,
  ): Instance | undefined {
    const byId = /^#(\d+)$/.exec(linkage);
    const id = byId
      ? Number(byId[1])
      : parent.movie.exports.find(
          (each) => each.name.toLowerCase() === linkage.toLowerCase(),
        )?.character;

    if (id === undefined) {
      this.options.log?.(`attachMovie: nothing is exported as "${linkage}"`);
      return undefined;
    }
    return this.place(
      parent,
      depth,
      this.create(parent.movie, id, `${parent.path}/${depth}`, parent, {
        matrix: [1, 0, 0, 1],
        translate: [0, 0],
        alpha: 1,
        born: parent.frame,
        name,
      }),
    );
  }

  /** Creates an empty clip on a clip, at a depth, under a name (`createEmptyMovieClip`) */
  public createEmpty(parent: Instance, name: string, depth: number): Instance {
    const instance = this.create(
      parent.movie,
      -1,
      `${parent.path}/${depth}`,
      parent,
      {
        matrix: [1, 0, 0, 1],
        translate: [0, 0],
        alpha: 1,
        born: parent.frame,
        name,
      },
    );

    instance.character = {
      type: "sprite",
      id: -1,
      offset: 0,
      frameCount: 0,
      framesOffset: 0,
    };
    instance.missing = undefined;
    this.clips.unshift(instance);
    return this.place(parent, depth, instance);
  }

  /** Takes a clip off its parent, running its unload handler; the root stays */
  public remove(clip: Instance): void {
    const parent = clip.parent;

    if (!parent) {
      return;
    }
    for (const [key, child] of parent.children) {
      if (child === clip) {
        parent.children.delete(key);
      }
    }
    this.retire(clip);
  }

  /** Puts a script-made clip at a depth, in depth order with the rest */
  private place(parent: Instance, depth: number, instance: Instance): Instance {
    const old = parent.children.get(String(depth));

    if (old) {
      this.retire(old);
    }
    instance.dynamic = true;
    parent.children.set(String(depth), instance);
    parent.children = new Map(
      [...parent.children].sort(([a], [b]) => Number(a) - Number(b)),
    );
    return instance;
  }

  /** Marks a clip gone, with what it holds, running its unload handler */
  private retire(instance: Instance): void {
    if (instance.removed) {
      return;
    }
    this.clipEvent(instance, CLIP_EVENT.unload);
    instance.removed = true;
    instance.children.forEach((child) => this.retire(child));
  }

  private scriptsRun(timeline: Instance): boolean {
    return timeline === this.root
      ? this.options.rootScripts
      : this.options.scripts;
  }

  /** Runs a clip's `onClipEvent` blocks for an event, on its parent's code */
  private clipEvent(instance: Instance, event: number): void {
    if (!this.vm || !instance.parent) {
      return;
    }
    const vm = this.vm;
    const parent = instance.parent;

    const priority =
      event === CLIP_EVENT.initialize
        ? SCRIPT_PRIORITY.initialize
        : event === CLIP_EVENT.construct
          ? SCRIPT_PRIORITY.construct
          : SCRIPT_PRIORITY.normal;

    for (const action of instance.clipActions ?? []) {
      if (action.events & event) {
        this.queue.add(() => vm.runBlock(instance, action.block, parent), priority);
      }
    }
    this.idle();
  }

  /**
   * Moves a timeline to a frame, running that frame's scripts. A frame past
   * either end lands on that end, and a goto to the frame it is on does
   * nothing (mint's `goto_frame`, after Ruffle).
   */
  public goTo(timeline: Instance, frame: number, play: boolean): void {
    timeline.playing = play;

    const target = Math.max(0, Math.min(timeline.frames.length - 1, frame));

    if (target !== timeline.frame && timeline.frames.length) {
      this.enter(timeline, target);
    }
  }

  /** Finds the frame a label names on a timeline, ignoring casing */
  public labelFrame(timeline: Instance, label: string): number | undefined {
    const wanted = label.toLowerCase();
    const index = timeline.frames.findIndex((frame) =>
      frame.items.some(
        (item) =>
          item.type === "frameLabel" && item.label.toLowerCase() === wanted,
      ),
    );

    return index < 0 ? undefined : index;
  }

  /** Lists every frame label of a timeline, in frame order */
  public labels(timeline: Instance): { label: string; frame: number }[] {
    return timeline.frames.flatMap((frame, index) =>
      frame.items.flatMap((item) =>
        item.type === "frameLabel" ? [{ label: item.label, frame: index }] : [],
      ),
    );
  }

  /** Shows a button in a state, or lets the pointer decide again */
  public force(button: Instance, state: number | undefined): void {
    button.forced = state;
    this.syncButton(button);
  }

  /**
   * Moves the pointer from one target to another. While a target is held
   * down the others get drag events, never roll events (mint's
   * `update_mouse`, after Ruffle).
   */
  public hover(
    previous: Instance | undefined,
    next: Instance | undefined,
    held?: Instance,
  ): void {
    if (previous === next) {
      return;
    }
    if (previous && this.attached(previous)) {
      this.sendGesture(previous, held ? POINTER_GESTURES.dragOut : POINTER_GESTURES.rollOut);
    }
    if (next) {
      this.sendGesture(next, held ? POINTER_GESTURES.dragOver : POINTER_GESTURES.rollOver);
    }
  }

  /** Presses the pointer on a target */
  public press(target: Instance): void {
    this.sendGesture(target, POINTER_GESTURES.press);
  }

  /** Lets the pointer go: over the target pressed, or over `hovered` or nothing */
  public release(target: Instance, hovered: Instance | undefined): void {
    if (target === hovered) {
      this.sendGesture(target, POINTER_GESTURES.release);
      return;
    }
    this.sendGesture(target, POINTER_GESTURES.releaseOutside);
    if (hovered) {
      this.sendGesture(hovered, POINTER_GESTURES.rollOver);
    }
  }

  /**
   * Whether a clip takes the pointer itself, by a mouse clip event or a
   * mouse handler property (mint's `button_mode`, after Ruffle)
   */
  public takesPointer(instance: Instance): boolean {
    if (instance.clipActions?.some(({ events }) => events & POINTER_CLIP_EVENTS)) {
      return true;
    }

    return Object.values(POINTER_GESTURES).some(
      ({ handler }) => !!this.findHandler(instance, handler),
    );
  }

  /** Lists every instance, root first, depth first */
  public all(): Instance[] {
    const out: Instance[] = [];
    const visit = (instance: Instance) => {
      out.push(instance);
      instance.children.forEach(visit);
    };

    visit(this.root);
    return out;
  }

  /** Finds the instance at a path of depths from the root */
  public find(path: string): Instance | undefined {
    return this.all().find((instance) => instance.path === path);
  }

  private attached(instance: Instance): boolean {
    for (let at: Instance | undefined = instance; at; at = at.parent) {
      if (at === this.root) {
        return true;
      }
      if (
        at.parent &&
        ![...at.parent.children.values(), ...at.parent.hits].includes(at)
      ) {
        return false;
      }
    }
    return false;
  }

  private create(
    from: PageMovie,
    id: number,
    path: string,
    parent: Instance | undefined,
    place: Pick<
      Instance,
      | "matrix"
      | "translate"
      | "alpha"
      | "born"
      | "clipDepth"
      | "clipActions"
      | "isHitRecord"
    > & {
      name?: string;
      placedItem?: number;
      matrixItem?: number;
    },
  ): Instance {
    const found = this.options.resolve(from, id);
    const entry = found
      ? undefined
      : from.imports.find((each) => each.character === id);
    const instance: Instance = {
      path,
      clipActions: place.clipActions,
      movie: found?.movie ?? from,
      id: found?.id ?? id,
      character: found?.character,
      missing: found
        ? undefined
        : entry
          ? `${entry.movie}:${entry.name}`
          : "import",
      parent,
      name: place.name,
      matrix: place.matrix,
      translate: place.translate,
      alpha: place.alpha,
      clipDepth: place.clipDepth,
      born: place.born,
      placed: id,
      placedItem: place.placedItem,
      matrixItem: place.matrixItem,
      frames: found ? getFrames(found.movie, found.character) : [],
      frame: 0,
      playing: true,
      children: new Map(),
      hits: [],
      buttonState: UP,
      isHitRecord: place.isHitRecord || parent?.isHitRecord,
    };
    const depth = path.split("/").length;

    if (depth > MAX_DEPTH) {
      return instance;
    }

    const runsEvents =
      !instance.isHitRecord &&
      !!parent &&
      !!this.vm &&
      this.scriptsRun(parent);

    if (runsEvents) {
      this.clipEvent(instance, CLIP_EVENT.initialize);
      this.clipEvent(instance, CLIP_EVENT.construct);
      this.clipEvent(instance, CLIP_EVENT.load);
    }
    if (isTimeline(instance)) {
      if (!instance.isHitRecord) {
        this.clips.unshift(instance);
      }
      this.enter(instance, 0);
    } else if (instance.character?.type === "button") {
      this.syncButton(instance);
    }
    return instance;
  }

  /** Shows a frame: brings the children in line with it, then runs its scripts */
  private enter(timeline: Instance, frame: number): void {
    timeline.frame = frame;
    this.syncTimeline(timeline);

    if (!this.scriptsRun(timeline)) {
      return;
    }

    const items = timeline.frames[frame]?.items ?? [];
    const vm = this.vm;

    if (vm) {
      // A sprite's init actions run once, before any frame script
      for (const item of items) {
        const key = `${timeline.movie.name}#${item.type === "initAction" ? item.sprite : ""}`;

        if (item.type === "initAction" && !vm.initialised.has(key)) {
          vm.initialised.add(key);
          this.queue.add(
            () => vm.runBlock(timeline, item.block),
            SCRIPT_PRIORITY.initialize,
          );
        }
      }
      for (const item of items) {
        if (item.type === "action") {
          this.queue.add(() => {
            if (!timeline.removed) {
              vm.runBlock(timeline, item.block);
            }
          });
        }
      }
      this.idle();
      return;
    }
    for (const item of items) {
      if (item.type === "action") {
        this.runBehaviour(timeline, timeline.movie.behaviours[item.block], "frame");
      }
    }
  }

  /** Keeps a child that is the same instance, places new ones, drops the rest */
  private syncTimeline(timeline: Instance): void {
    const kept = new Map<string, Instance>();

    for (const placement of buildDisplayList(timeline.frames, timeline.frame)) {
      const key = String(placement.depth);
      const existing = timeline.children.get(key);
      if (
        existing &&
        !existing.dynamic &&
        existing.born === placement.born &&
        existing.placed === placement.character
      ) {
        Object.assign(
          existing,
          existing.scripted
            ? {}
            : {
                matrix: placement.matrix,
                translate: placement.translate,
                alpha: placement.alpha,
              },
          {
            clipDepth: placement.clipDepth,
            name: existing.scripted ? existing.name : placement.name,
            matrixItem: placement.matrixItem,
          },
        );
        kept.set(key, existing);
      } else {
        kept.set(
          key,
          this.create(
            timeline.movie,
            placement.character,
            `${timeline.path}/${placement.depth}`,
            timeline,
            placement,
          ),
        );
      }
    }
    // What scripts made stays until a script removes it
    for (const [key, child] of timeline.children) {
      if (child.dynamic && !kept.has(key)) {
        kept.set(key, child);
      } else if (kept.get(key) !== child) {
        this.retire(child);
      }
    }
    timeline.children = new Map(
      [...kept].sort(([a], [b]) => Number(a) - Number(b)),
    );
  }

  /** Shows the records of a button's state, keeping those still shown */
  private syncButton(button: Instance): void {
    if (button.character?.type !== "button") {
      return;
    }

    const state = button.forced ?? button.buttonState;
    const kept = new Map<string, Instance>();
    const place = (record: ButtonRecord, isHitRecord = false) =>
      this.create(
        button.movie,
        record.character,
        `${button.path}/b${record.depth}`,
        button,
        {
          matrix: record.matrix,
          translate: record.translate,
          alpha: 1,
          born: 0,
          isHitRecord,
        },
      );

    const inDepthOrder = [...button.character.records].sort(
      (a, b) => a.depth - b.depth,
    );

    for (const record of inDepthOrder) {
      if (record.flags & state) {
        const key = `b${record.depth}`;
        const shown = button.children.get(key);

        // A state can put another character at the same depth
        kept.set(
          key,
          shown?.placed === record.character ? shown : place(record),
        );
      }
    }
    for (const [key, child] of button.children) {
      if (kept.get(key) !== child) {
        this.retire(child);
      }
    }
    button.children = kept;
    if (!button.hits.length) {
      button.hits = button.character.records
        .filter((record) => record.flags & HIT)
        .map((record) => place(record, true));
    }
  }

  /** Sends a pointer gesture to a button or a clip that takes the pointer */
  private sendGesture(target: Instance, gesture: PointerGesture): void {
    this.queue.hold(() => {
      if (target.character?.type === "button") {
        this.sendButtonGesture(target, gesture);
      } else {
        this.clipEvent(target, gesture.clipEvent);
        this.queueMethod(target, gesture.handler);
      }
    });
    this.idle();
  }

  /** Whether a script has turned a button off; absent means on */
  private isDisabled(button: Instance): boolean {
    const enabled = this.vm?.peekObject(button)?.get("enabled");

    return enabled !== undefined && !toBoolean(enabled);
  }

  private sendButtonGesture(button: Instance, gesture: PointerGesture): void {
    if (button.character?.type !== "button") {
      return;
    }
    if (this.isDisabled(button)) {
      // A disabled button changes state but runs nothing
      if (gesture.state !== POINTER_GESTURES.rollOver.state) {
        button.buttonState = UP;
        this.syncButton(button);
      }
      return;
    }

    button.buttonState = gesture.state;
    this.syncButton(button);

    // A button's actions run on the timeline it is placed in
    const owner = button.parent ?? this.root;
    const name =
      Object.entries(POINTER_GESTURES).find(([, each]) => each === gesture)?.[0] ??
      "event";
    const vm = this.vm;

    for (const action of button.character.actions) {
      if (action.condition & gesture.condition) {
        if (vm) {
          this.options.log?.(`${name} on ${describeInstance(button)}`);
          this.queue.add(() => vm.runBlock(owner, action.block, button));
        } else {
          this.runBehaviour(
            owner,
            button.movie.behaviours[action.block],
            `${name} on ${describeInstance(button)}`,
          );
        }
      }
    }

    // A handler a script gave the button (`btn.onRelease = function () {}`)
    this.queueMethod(button, gesture.handler);
  }

  /** Gets a text field's text: set by a script, else its bound variable's value */
  public textOf(instance: Instance): string | undefined {
    if (instance.text !== undefined) {
      return instance.text;
    }

    const character = instance.character;

    if (
      !this.vm ||
      character?.type !== "editText" ||
      !character.variable ||
      !instance.parent
    ) {
      return undefined;
    }

    const value = this.vm.readBound(instance.parent, character.variable);

    return value === undefined ? undefined : this.vm.string(value);
  }
}
