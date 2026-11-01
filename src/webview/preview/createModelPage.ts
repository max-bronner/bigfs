import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import type { ForeignClip } from '../../formats/w3d/w3dModelFinder';
import type { SceneSkeleton } from '../../formats/w3d/w3dScene';
import { element } from '../shared/element';
import { createViewer } from '../shared/viewer/createViewer';
import type { ClipChoice } from '../shared/viewer/createClipPicker';
import { listFileClips } from './listFileClips';
import type { FileUse, ModelMessage } from './protocol';

/** Animation list id standing for the animation the shown file holds itself */
const OWN = '#own';
const PARTS_HINT =
  "A .w3d alone knows only its own HIDDEN flags. The game hides more from the object's INI and scripts: use Preview object on its INI to see those.";

/** Controls the preview page's message handler drives a W3D file through */
export interface ModelPage {
  /** Shows the file's model in the viewer */
  show(message: ModelMessage): void;
  /** Lists the skeleton's own animation files, then a group of other skeletons' */
  setAnimations(own: string[], foreign: ForeignClip[]): void;
  /** Plays an animation the page asked for */
  play(message: {
    file: string;
    animation: W3dAnimation;
    skeleton?: SceneSkeleton;
  }): void;
  /** Shows a short message in the status line */
  showNotice(text: string): void;
  /** Lists where the INI files use the file, each a link to the line */
  setUses(uses: FileUse[]): void;
}

/**
 * Creates the preview page's view of a W3D file: the shared viewer with the
 * model, its textures and animations and nothing around them, only the list
 * of INI lines that use the file. `main` is taken over when a model arrives.
 */
export const createModelPage = (
  main: HTMLElement,
  post: (
    message:
      | { kind: 'animation'; file: string }
      | { kind: 'reveal'; uri: string; line: number },
  ) => void,
): ModelPage => {
  const usedIn = element('p');
  let thisFile: ClipChoice[] = [];
  let message: ModelMessage | undefined;

  const pickClip = (id: string) => {
    if (id === OWN && message?.animation) {
      viewer.playClip({
        id,
        animation: message.animation,
        skeleton: message.animationSkeleton,
      });
    } else {
      post({ kind: 'animation', file: id });
    }
  };

  document.body.classList.add('model-page');

  const viewer = createViewer(main, { onPickClip: pickClip, partsHint: PARTS_HINT });

  viewer.side.append(usedIn);

  return {
    show: (next) => {
      message = next;
      viewer.setModel(next);
      if (next.animation && next.skeleton) {
        thisFile = [{ id: OWN, label: `${next.animation.name} (this file)` }];
        viewer.setClips({ own: thisFile });
        pickClip(OWN);
      }
    },
    setAnimations: (own, foreign) =>
      viewer.setClips(listFileClips(thisFile, own, foreign)),
    play: ({ file, animation, skeleton }) => {
      if (message?.skeleton) {
        viewer.playClip({ id: file, animation, skeleton });
      }
    },
    showNotice: viewer.showStatus,
    setUses: (uses) => {
      usedIn.replaceChildren(
        uses.length ? 'Used in: ' : 'No INI file the index holds uses this file',
        ...uses.flatMap((use, at) => {
          const link = element(
            'a',
            `${use.owner ?? use.uri.slice(use.uri.lastIndexOf('/') + 1)} (${use.field}, line ${use.line + 1})`,
          );

          link.href = '#';
          link.onclick = (event) => {
            event.preventDefault();
            post({ kind: 'reveal', uri: use.uri, line: use.line });
          };
          return at ? [' · ', link] : [link];
        }),
      );
    },
  };
};
