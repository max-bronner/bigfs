import type { Behaviour, TimelineCommand } from './aptBehaviour';
import type { Character, Frame } from './aptMovie';

/**
 * Reads how a timeline flows: its frame labels, the frames whose script stops
 * it, and every jump into it - a frame script's `gotoAndPlay`/
 * `gotoAndStop` on its own timeline, and a button's on the timeline the
 * button sits in, where SWF runs button actions - each resolved to the
 * frame it lands on. Read from the behaviours the extension lifted out of
 * the scripts, so only what runs unconditionally is known; a script that
 * branches says so.
 */

/** A frame label and the frame it names */
export interface FrameLabel {
  label: string;
  frame: number;
}

/** A `goto` into a timeline, from a frame script or a placed button */
export interface Jump {
  from:
    | { kind: 'frame'; frame: number }
    | { kind: 'button'; character: number; depth: number; frame: number };
  /** Where it lands, when the label exists on this timeline */
  to?: number;
  label?: string;
  play: boolean;
}

/** Summary of how a timeline flows, as `timelineFlow` reads it */
export interface TimelineFlow {
  labels: FrameLabel[];
  /** Frames whose script stops the timeline there */
  stops: number[];
  /** Frames whose script plays the timeline on */
  plays: number[];
  jumps: Jump[];
  /** Frames whose script branches before its end, so may do more */
  conditional: number[];
}

/** Commands that act on the timeline the script runs in */
const own = (commands: TimelineCommand[]) =>
  commands.filter((command) => command.target.length === 0);

/** Reads a timeline's labels, stops, plays and jumps from its lifted behaviours */
export const timelineFlow = (
  frames: readonly Frame[],
  behaviours: Readonly<Record<number, Behaviour>>,
  characters: readonly (Character | undefined)[],
): TimelineFlow => {
  const labels = frames.flatMap((frame, index) =>
    frame.items.flatMap((item) =>
      item.type === 'frameLabel' ? [{ label: item.label, frame: index }] : [],
    ),
  );
  const frameOf = (label: string) =>
    labels.find((each) => each.label.toLowerCase() === label.toLowerCase())
      ?.frame;
  const flow: TimelineFlow = {
    labels,
    stops: [],
    plays: [],
    jumps: [],
    conditional: [],
  };
  const jump = (command: TimelineCommand, from: Jump['from']) => {
    if (command.op !== 'goto') {
      return;
    }
    flow.jumps.push({
      from,
      to:
        command.label !== undefined
          ? frameOf(command.label)
          : command.frame !== undefined && command.frame < frames.length
            ? command.frame
            : undefined,
      label: command.label,
      play: command.play,
    });
  };

  frames.forEach((frame, index) => {
    for (const item of frame.items) {
      if (item.type === 'action') {
        const behaviour = behaviours[item.block];

        if (!behaviour) {
          continue;
        }
        if (behaviour.conditional) {
          flow.conditional.push(index);
        }
        for (const command of own(behaviour.commands)) {
          if (command.op === 'stop') {
            flow.stops.push(index);
          } else if (command.op === 'play') {
            flow.plays.push(index);
          } else {
            jump(command, { kind: 'frame', frame: index });
          }
        }
      } else if (item.type === 'placeObject' && item.character !== undefined) {
        const character = characters[item.character];

        if (character?.type !== 'button') {
          continue;
        }
        // A button placed again on a later frame jumps the same way
        if (
          flow.jumps.some(
            (each) =>
              each.from.kind === 'button' &&
              each.from.character === item.character &&
              each.from.depth === item.depth,
          )
        ) {
          continue;
        }
        for (const action of character.actions) {
          for (const command of own(behaviours[action.block]?.commands ?? [])) {
            jump(command, {
              kind: 'button',
              character: item.character,
              depth: item.depth,
              frame: index,
            });
          }
        }
      }
    }
  });
  return flow;
};
