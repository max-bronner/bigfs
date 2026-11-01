import type { Rgb } from "./w3dMaterialChunks";

/**
 * House colour: how a unit takes its player's colour. Which meshes do is not
 * in the model: `housecolor.ini` maps a mesh's base texture to a mask, and the
 * game recolours the mask. See mint's `house-color.md`.
 */

/** Where an installation keeps the table of base textures and masks */
export const HOUSE_COLOR_INI = "data/ini/housecolor.ini";

/** The colour a preview shows, having no player: the first `MultiplayerColor`, `ColorBlue` */
export const DEFAULT_HOUSE_COLOUR: Rgb = [70 / 255, 91 / 255, 156 / 255];

/** Reads `housecolor.ini` into a table from lower-case base texture to mask, the later block winning */
export const parseHouseColours = (text: string): Map<string, string> => {
  const masks = new Map<string, string>();
  let base: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    const [key, value] = line.split(";")[0].split("=").map((part) => part.trim());

    if (/^HouseColor$/i.test(key)) {
      base = undefined;
    } else if (/^BaseTexture$/i.test(key) && value) {
      base = value.toLowerCase();
    } else if (/^HouseTexture$/i.test(key) && value && base) {
      masks.set(base, value);
    }
  }
  return masks;
};
