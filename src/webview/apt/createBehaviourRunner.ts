import type {
  Behaviour,
  TimelineCommand,
} from '../../formats/apt/aptBehaviour';
import type { StageHost } from './avm/value';
import { isTimeline } from './instance';
import type { Instance } from './instance';

/** Gotos that run frame scripts that goto again stop here */
const MAX_CHAIN = 16;

/** Runs what a block does to timelines, from the timeline it runs on */
export type BehaviourRunner = (
  self: Instance,
  behaviour: Behaviour | undefined,
  why: string,
) => void;

const describeCommand = (command: TimelineCommand): string => {
  const on = command.target.length ? ` on ${command.target.join('.')}` : '';

  if (command.op !== 'goto') {
    return command.op + on;
  }

  const where =
    command.label !== undefined
      ? `"${command.label}"`
      : `frame ${command.frame}`;

  return `${command.play ? 'gotoAndPlay' : 'gotoAndStop'} ${where}${on}`;
};

/**
 * Creates the player's fallback for a movie running without an engine: it
 * plays only what the extension read out of an action block, the timeline
 * commands, instead of running its bytecode
 */
export const createBehaviourRunner = (
  stage: Pick<StageHost, 'root' | 'goTo' | 'labelFrame'>,
  log: (line: string) => void,
): BehaviourRunner => {
  let chain = 0;

  const apply = (target: Instance, command: TimelineCommand): void => {
    switch (command.op) {
      case 'goto': {
        const frame =
          command.label !== undefined
            ? stage.labelFrame(target, command.label)
            : command.frame;

        if (frame !== undefined) {
          stage.goTo(target, frame, command.play);
        }
        break;
      }
      case 'play':
        target.playing = true;
        break;
      case 'stop':
        target.playing = false;
        break;
      case 'next':
      case 'prev':
        stage.goTo(
          target,
          target.frame + (command.op === 'next' ? 1 : -1),
          false,
        );
        break;
    }
  };

  /** Finds the timeline a command path names, from the one the block runs on */
  const findTarget = (self: Instance, path: string[]): Instance | undefined => {
    let at: Instance | undefined = self;

    for (const part of path) {
      const lower = part.toLowerCase();

      if (lower === '_parent') {
        at = at?.parent;
        // A button is not a timeline; its parent's parent is
        while (at && !isTimeline(at)) {
          at = at.parent;
        }
      } else if (lower === '_root') {
        at = stage.root;
      } else if (lower !== 'this') {
        at =
          at &&
          [...at.children.values()].find(
            (child) => child.name?.toLowerCase() === lower,
          );
      }
    }
    return at && isTimeline(at) ? at : undefined;
  };

  return (self, behaviour, why) => {
    if (!behaviour || chain >= MAX_CHAIN) {
      return;
    }

    chain++;
    try {
      const done: string[] = [];

      for (const command of behaviour.commands) {
        const target = findTarget(self, command.target);

        if (target) {
          apply(target, command);
          done.push(describeCommand(command));
        } else {
          done.push(
            `${describeCommand(command)} (no ${command.target.join('.')})`,
          );
        }
      }
      // Frame scripts run every time a frame is entered; only events are worth a line
      if (why !== 'frame') {
        log(
          `${why}: ${done.join(', ') || 'nothing to run'}` +
            (behaviour.skipped
              ? ` · ${behaviour.skipped} statement${behaviour.skipped === 1 ? '' : 's'} not run${behaviour.conditional ? ' (conditional)' : ''}`
              : ''),
        );
      }
    } finally {
      chain--;
    }
  };
};
