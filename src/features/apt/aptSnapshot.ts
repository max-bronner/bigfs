/** A movie's state an undo restores: its image, `.const` and added files */
export interface AptSnapshot {
  apt: Uint8Array;
  constBytes: Uint8Array;
  files: Map<string, Uint8Array>;
}

/** Packs a snapshot into one file for a hot-exit backup */
export const packSnapshot = (snapshot: AptSnapshot): Uint8Array => {
  const parts: Uint8Array[] = [];
  const word = (value: number) =>
    parts.push(new Uint8Array(new Uint32Array([value]).buffer));
  const blob = (bytes: Uint8Array) => {
    word(bytes.length);
    parts.push(bytes);
  };

  blob(snapshot.apt);
  blob(snapshot.constBytes);
  word(snapshot.files.size);
  for (const [name, bytes] of snapshot.files) {
    blob(new TextEncoder().encode(name));
    blob(bytes);
  }

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/**
 * Reads back a snapshot `packSnapshot` packed.
 * @throws when the backup ends inside one of its files
 */
export const unpackSnapshot = (bytes: Uint8Array): AptSnapshot => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const word = () => {
    const value = view.getUint32(at, true);

    at += 4;

    return value;
  };
  const blob = () => {
    const length = word();

    if (at + length > bytes.length) {
      throw new Error('The backup is cut short');
    }

    at += length;

    return bytes.slice(at - length, at);
  };
  const apt = blob();
  const constBytes = blob();
  const files = new Map<string, Uint8Array>();

  for (let count = word(); count > 0; count--) {
    files.set(new TextDecoder().decode(blob()), blob());
  }

  return { apt, constBytes, files };
};
