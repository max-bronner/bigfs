import type { ForeignClip } from '../../formats/w3d/w3dModelFinder';
import type { ClipChoice, ClipList } from '../shared/viewer/createClipPicker';

const withoutExtension = (file: string) => file.replace(/\.w3d$/i, '');

/**
 * Lists the animations of a W3D file for the viewer: what the file holds
 * itself, its skeleton's own animation files, then other skeletons' clips
 * with the skeleton each was made for.
 */
export const listFileClips = (
  thisFile: ClipChoice[],
  own: string[],
  foreign: ForeignClip[],
): ClipList => ({
  own: [
    ...thisFile,
    ...own.map((file) => ({ id: file, label: withoutExtension(file) })),
  ],
  foreign: foreign.map(({ file, hierarchyName }) => ({
    id: file,
    label: `${withoutExtension(file)} (${hierarchyName})`,
  })),
});
