/**
 * Reads a hotspot typed as `x,y` (or `x y`) and checks it lies inside an image
 * of the given size. Gives the problem as a message when it does not, so an
 * input box can show it.
 */
export const parseHotspot = (
  text: string,
  width: number,
  height: number,
): { x: number; y: number } | string => {
  const match = /^\s*(\d+)\s*[,\s]\s*(\d+)\s*$/.exec(text);

  if (!match) {
    return 'Type the hotspot as x,y in pixels, for example 4,2';
  }

  const x = Number(match[1]);
  const y = Number(match[2]);

  return x < width && y < height
    ? { x, y }
    : `The hotspot must lie inside the ${width}×${height} image`;
};
