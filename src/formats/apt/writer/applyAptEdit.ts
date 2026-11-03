import { parseAptMovie } from '../aptMovie';
import { applyButtonEdit } from './applyButtonEdit';
import { applyCharacterEdit } from './applyCharacterEdit';
import { applyFrameItemEdit } from './applyFrameItemEdit';
import { applyImportExportEdit } from './applyImportExportEdit';
import { applyTextRecordEdit } from './applyTextRecordEdit';
import { applyTimelineEdit, computeEditedTimelineFrames } from './applyTimelineEdit';
import type { AptEdit, EditResult } from './aptEdit';
import type { AptImage } from './aptImage';

/**
 * Applies one edit to a movie. `image` is changed in place where the edit
 * allows and grown at its end otherwise; the movie is parsed again from it
 * for the next edit.
 */
export const applyAptEdit = (
  image: AptImage,
  movieOffset: number,
  edit: AptEdit,
): EditResult => {
  const movie = parseAptMovie(image.bytes, movieOffset);

  switch (edit.kind) {
    case 'character':
    case 'movieUnknown36':
    case 'screen':
    case 'duplicateCharacter':
    case 'addCharacter':
    case 'removeCharacter':
      return applyCharacterEdit(image, movie, edit);
    case 'placement':
    case 'frameLabel':
    case 'backgroundColor':
    case 'addBackgroundColor':
    case 'initAction':
    case 'removeObjectDepth':
    case 'placeObject':
    case 'removeObject':
    case 'addFrameLabel':
    case 'removeItem':
    case 'moveItem':
    case 'addFrameScript':
    case 'addClipAction':
    case 'clipAction':
    case 'removeClipAction':
      return applyFrameItemEdit(image, movie, edit);
    case 'buttonRecord':
    case 'addButtonRecord':
    case 'moveButtonRecord':
    case 'removeButtonRecord':
    case 'addButtonAction':
    case 'buttonAction':
    case 'removeButtonAction':
      return applyButtonEdit(image, movie, edit);
    case 'textRecord':
    case 'addTextRecord':
    case 'removeTextRecord':
      return applyTextRecordEdit(image, movie, edit);
    case 'export':
    case 'addExport':
    case 'removeExport':
    case 'import':
    case 'addImport':
    case 'removeImport':
      return applyImportExportEdit(image, movie, edit);
    case 'swapDepths':
    case 'setTimeline':
    case 'addFrame':
      return applyTimelineEdit(image, movie, edit);
    case 'timeline':
    case 'timelineScript':
      return applyAptEdit(image, movieOffset, {
        kind: 'setTimeline',
        timeline: edit.timeline,
        frames: computeEditedTimelineFrames(image, movie, edit),
      });
  }
};
