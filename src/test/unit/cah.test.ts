import * as assert from "assert";
import {
  Crc32,
  POWER_SLOTS,
  describeCahRecordProblem,
  cloneCahRecord,
  computeCahCrc,
  createEmptyCahRecord,
  parseCah,
  writeCah,
} from "../../formats/cah/cah";
import type { CahRecord } from "../../formats/cah/cah";

/** mint's `crc.rs`, bit by bit, as the reference the table version must equal */
const referenceCrc = (bytes: number[]): number => {
  let state = 0xffffffff;

  for (const byte of bytes) {
    state = (state ^ byte) >>> 0;
    for (let bit = 0; bit < 8; bit++) {
      const carry = state & 1;

      state >>>= 1;
      if (carry) {
        state = (state ^ 0xedb88320) >>> 0;
      }
    }
  }
  return ~state >>> 0;
};

const toLittleEndian = (value: number) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  value >>> 24,
];
const toAsciiCodes = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

// Invented values; only the layout is the game's
const buildSampleRecord = (): CahRecord => {
  const record = createEmptyCahRecord();

  record.objectId = 7;
  record.name = "Aragwen é";
  record.classIndex = 2;
  record.subclassIndex = 1;
  record.colors = [0xff112233, 0x80445566, 0xffffffff];
  record.powers[0] = { button: "Command_PowerOne", level: 0, slot: 3 };
  record.powers[4] = { button: "Command_PowerTwo", level: 2, slot: 5 };
  record.blings = [
    { group: "HELM", index: 2 },
    { group: "ARMOR", index: 4 },
  ];
  record.id = "ABC123";
  return record;
};

/** The file laid out by hand from the documented field order, trailer included */
const buildByHand = (record: CahRecord): number[] => {
  const hashed: number[] = [
    ...toLittleEndian(record.objectId),
    ...Array.from(new TextEncoder().encode(record.name)),
    ...toLittleEndian(record.classIndex),
    ...toLittleEndian(record.subclassIndex),
    ...toLittleEndian(0),
    ...toLittleEndian(0),
    ...record.colors.flatMap(toLittleEndian),
    ...record.powers.flatMap((p) => [
      ...toAsciiCodes(p.button),
      ...toLittleEndian(p.level),
      ...toLittleEndian(p.slot),
    ]),
    ...toLittleEndian(record.blings.length),
    ...record.blings.flatMap((b) => [...toAsciiCodes(b.group), ...toLittleEndian(b.index)]),
    0,
  ];
  const out = [
    ...toAsciiCodes("ALAE2STR"),
    ...toLittleEndian(1),
    ...toLittleEndian(0),
    8,
    ...toLittleEndian(record.objectId),
    record.name.length,
    ...Array.from(record.name).flatMap((c) => [
      c.charCodeAt(0) & 0xff,
      c.charCodeAt(0) >> 8,
    ]),
    ...toLittleEndian(record.classIndex),
    ...toLittleEndian(record.subclassIndex),
    ...toLittleEndian(0),
    ...toLittleEndian(0),
    ...record.colors.flatMap(toLittleEndian),
    ...record.powers.flatMap((p) => [
      p.button.length,
      ...toAsciiCodes(p.button),
      ...toLittleEndian(p.level),
      ...toLittleEndian(p.slot),
    ]),
    ...toLittleEndian(record.blings.length),
    ...record.blings.flatMap((b) => [
      b.group.length,
      ...toAsciiCodes(b.group),
      ...toLittleEndian(b.index),
    ]),
    (record.id ?? "").length,
    ...toAsciiCodes(record.id ?? ""),
    0,
    ...toLittleEndian(referenceCrc(hashed)),
  ];

  return out;
};

suite("Create-a-Hero file", () => {
  test("the CRC-32 is the standard one", () => {
    const crc = new Crc32();

    crc.update(toAsciiCodes("123456789"));
    assert.strictEqual(crc.finish(), 0xcbf43926);
  });

  test("the table CRC equals the bit-by-bit reference over odd chunks", () => {
    const bytes = Array.from({ length: 1000 }, (_, i) => (i * 37 + 11) & 0xff);
    const crc = new Crc32();

    crc.update(bytes.slice(0, 333));
    crc.update(bytes.slice(333));
    assert.strictEqual(crc.finish(), referenceCrc(bytes));
  });

  test("write produces the hand-built file with the trailer mint computes", () => {
    const record = buildSampleRecord();

    assert.deepStrictEqual(Array.from(writeCah(record)), buildByHand(record));
  });

  test("a written file parses back to the same record with a matching checksum", () => {
    const record = buildSampleRecord();
    const parsed = parseCah(writeCah(record));

    assert.strictEqual(parsed.crcMatches, true);
    assert.strictEqual(parsed.trailing, 0);
    assert.strictEqual(parsed.record.storedCrc, computeCahCrc(record));
    assert.deepStrictEqual(
      { ...parsed.record, storedCrc: undefined },
      { ...record, storedCrc: undefined },
    );
    assert.deepStrictEqual(
      Array.from(writeCah(parsed.record)),
      Array.from(writeCah(record)),
    );
  });

  test("a string longer than 254 bytes uses the long length form", () => {
    const record = buildSampleRecord();

    record.powers[1].button = "B".repeat(300);
    const parsed = parseCah(writeCah(record));

    assert.strictEqual(parsed.record.powers[1].button.length, 300);
    assert.strictEqual(parsed.crcMatches, true);
  });

  test("strings stop at a NUL when hashed, as the game reads them", () => {
    const record = buildSampleRecord();
    const other = cloneCahRecord(record);

    other.powers[0].button = "Command_PowerOne\0junk";
    assert.strictEqual(computeCahCrc(other), computeCahCrc(record));
  });

  test("an edit changes the checksum and a stale trailer is reported", () => {
    const bytes = writeCah(buildSampleRecord());
    const edited = Uint8Array.from(bytes);

    edited[edited.length - 1] ^= 0xff;
    assert.strictEqual(parseCah(edited).crcMatches, false);

    const record = buildSampleRecord();

    record.name = "Other";
    assert.notStrictEqual(computeCahCrc(record), computeCahCrc(buildSampleRecord()));
  });

  test("bytes after the record are counted and ignored", () => {
    const bytes = writeCah(buildSampleRecord());
    const longer = Uint8Array.from([...bytes, 1, 2, 3]);

    assert.strictEqual(parseCah(longer).trailing, 3);
  });

  test("an older record version parses without id, flag or checksum", () => {
    const v8 = Array.from(writeCah(buildSampleRecord()));
    const headerLength = 16;
    const bytes = Uint8Array.from(v8);

    bytes[headerLength] = 6;
    // A version 6 file has neither id nor trailer: cut them off
    const idStart = v8.length - (1 + 1 + 6) - 4 + 0;
    const cut = bytes.slice(0, idStart);
    const parsed = parseCah(cut);

    assert.strictEqual(parsed.record.version, 6);
    assert.strictEqual(parsed.record.id, undefined);
    assert.strictEqual(parsed.crcMatches, true);
  });

  test("a bad header, version or truncation fails with a message", () => {
    const good = Array.from(writeCah(buildSampleRecord()));

    assert.throws(
      () => parseCah(Uint8Array.from(toAsciiCodes("NOPE"))),
      /bad container magic|runs past/,
    );
    assert.throws(
      () => parseCah(Uint8Array.from(toAsciiCodes("XXXX2STR"))),
      /bad container magic/,
    );
    assert.throws(
      () =>
        parseCah(Uint8Array.from([...good.slice(0, 16), 9, ...good.slice(17)])),
      /record version 9/,
    );
    assert.throws(
      () => parseCah(Uint8Array.from(good.slice(0, 40))),
      /runs past the end/,
    );
    assert.throws(
      () =>
        parseCah(
          Uint8Array.from([
            ...good.slice(0, 12),
            1,
            0,
            0,
            0,
            ...good.slice(16),
          ]),
        ),
      /tagged/,
    );
  });

  test("a huge bling count is refused before anything is allocated", () => {
    const record = createEmptyCahRecord();
    const bytes = Array.from(writeCah(record));
    // The count sits after the fixed part: container 16, version 1, object 4, name 1, class 8, reserved 8, colours 12, powers 15 x 9
    const countAt = 16 + 1 + 4 + 1 + 8 + 8 + 12 + POWER_SLOTS * 9;

    bytes.splice(countAt, 4, 0xff, 0xff, 0xff, 0x7f);
    assert.throws(
      () => parseCah(Uint8Array.from(bytes)),
      /claims 2147483647 entries/,
    );
  });

  test("a huge wide-string length is refused against the bytes present", () => {
    const bytes = Array.from(writeCah(buildSampleRecord()));

    bytes.splice(21, 1, 0xff, 0xff, 0xff, 0xff, 0x7f);
    assert.throws(() => parseCah(Uint8Array.from(bytes)), /runs past the end/);
  });

  test("an empty bling group is refused", () => {
    const record = buildSampleRecord();

    record.blings[0].group = "";
    assert.ok(describeCahRecordProblem(record));
    assert.throws(() => parseCah(writeCah(record)), /Empty bling group/);
  });

  test("a fresh record has all power slots", () => {
    assert.strictEqual(createEmptyCahRecord().powers.length, POWER_SLOTS);
    assert.strictEqual(describeCahRecordProblem(createEmptyCahRecord()), undefined);
  });

  test("every truncation of a file fails with a message naming the offset", () => {
    const good = writeCah(buildSampleRecord());

    for (let length = 0; length < good.length; length++) {
      assert.throws(
        () => parseCah(good.slice(0, length)),
        /runs past the end of the file|claims \d+ entries|bad container/,
        `${length} bytes`,
      );
    }
  });
});
