import { deflateSync, inflateSync } from "zlib";
import {
  decodePng as decodePngWith,
  encodePng as encodePngWith,
} from "../formats/texture/textureEncode";

type RgbaImage = Parameters<typeof encodePngWith>[0];

/** Encodes an image as a PNG, compressing with Node's zlib. */
export const encodePng = (image: RgbaImage): Uint8Array =>
  encodePngWith(image, deflateSync);

/** Decodes a PNG with Node's zlib, bounding the inflated size by the image dimensions. */
export const decodePng = (bytes: Uint8Array): RgbaImage =>
  decodePngWith(bytes, (data, maxOutputLength) =>
    inflateSync(data, { maxOutputLength }),
  );
