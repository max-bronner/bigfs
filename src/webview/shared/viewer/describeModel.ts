import type { ModelScene } from '../../../formats/w3d/w3dScene';

/** A model the viewer shows, with what the page knows about how it got there */
export interface ViewerModel extends ModelScene {
  /** The model an animation file is shown on, found by its skeleton */
  shownOn?: string;
}

/** Writes the line of facts under a model: what it holds and what could not be found */
export const describeModel = ({
  shownOn,
  meshes,
  hierarchy,
  skeleton,
  missing,
}: ViewerModel): string =>
  [
    ...(shownOn ? [`shown on ${shownOn}, the model drawn on its skeleton`] : []),
    `${meshes.length} meshes`,
    `${meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0)} triangles`,
    ...(hierarchy && skeleton
      ? [`skeleton ${hierarchy} (${skeleton.parents.length} bones)`]
      : []),
    ...(missing.length ? [`textures not found: ${missing.join(', ')}`] : []),
  ].join(' · ');

/** Writes the line about a model's levels of detail; empty when it has none */
export const describeDetailLevels = ({ hlod }: ViewerModel): string => {
  if (!hlod?.lods.length) {
    return '';
  }

  const { lods, skippedLodCount, aggregates, proxies } = hlod;

  return [
    `${lods.length} level${lods.length === 1 ? '' : 's'} of detail`,
    ...(skippedLodCount
      ? [
          `${skippedLodCount} more LOD array${skippedLodCount === 1 ? '' : 's'} in the file past the header's count, which the game does not read`,
        ]
      : []),
    `aggregates: ${aggregates.join(', ') || 'none'}`,
    `proxies: ${proxies.join(', ') || 'none'}`,
  ].join(' · ');
};
