import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { createSageIniSchema } from "../../formats/ini/sageIniSchema";
import { parseSageIni } from "../../formats/ini/sageIniParser";
import {
  listBlingOptions,
  readBlockAtLine,
  parseIniColor,
  readHeroSystem,
  countSpentPoints,
  readTopBlocks,
} from "../../game/objects/cahSystem";

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, "..", "..", "..", "assets", "sageIniSchema.json"),
      "utf8",
    ),
  ),
);

// Invented names; only the grammar is the games'
const TEXT = [
  "CreateAHeroSystem",
  "  CreateAHeroBling",
  "    BlingUpgradeName = Up_Low",
  "    NameTag = TAG:Low",
  "    GroupName = POWER",
  "  End",
  "  CreateAHeroBling",
  "    BlingUpgradeName = Up_High",
  "    NameTag = TAG:High",
  "    GroupName = POWER",
  "  End",
  "  CreateAHeroBlingBinder",
  "    GroupName = POWER",
  "    LabelTag = TAG:Power",
  "    UISlot = 1",
  "    BlingType = ATTRIBUTE",
  "  End",
  "  CreateAHeroClass",
  "    UpgradeName = Up_ClassA",
  "    NameTag = TAG:ClassA",
  "    SubClass",
  "      UpgradeName = Up_SubA",
  "      NameTag = TAG:SubA",
  "      SpendableAttributePoints = 5",
  "      DefaultPrimaryColor = R:10 G:20 B:30",
  "      Attribute",
  "        GroupName = POWER",
  "        MinValueUpgrade = Up_Low",
  "        MaxValueUpgrade = Up_High",
  "      End",
  "    End",
  "  End",
  "End",
].join("\n");

suite("Create-a-Hero system", () => {
  const parsed = parseSageIni(TEXT.split("\n"), schema);
  const system = readHeroSystem(readTopBlocks(parsed, "CreateAHeroSystem"));
  const order = (upgrade: string) => (upgrade === "Up_High" ? 2 : 1);

  test("reads classes, subclasses, binders and blings", () => {
    assert.strictEqual(system.classes.length, 1);
    assert.strictEqual(system.classes[0].nameTag, "TAG:ClassA");
    assert.strictEqual(system.classes[0].subclasses[0].points, 5);
    assert.strictEqual(system.binders[0].isAttribute, true);
    assert.deepStrictEqual(
      system.blings.map((b) => b.upgrade),
      ["Up_Low", "Up_High"],
    );
    assert.strictEqual(
      system.classes[0].subclasses[0].attributes[0].group,
      "POWER",
    );
  });

  test("colours pack as alpha, red, green, blue", () => {
    assert.strictEqual(
      system.classes[0].subclasses[0].colors[0],
      ((255 << 24) | (10 << 16) | (20 << 8) | 30) >>> 0,
    );
    assert.strictEqual(parseIniColor(["R:1", "G:2", "B:3", "A:4"]), 0x04010203);
    assert.strictEqual(parseIniColor(["R:1", "G:2"]), undefined);
  });

  test("an attribute group offers its blings in GroupOrder", () => {
    const subclass = system.classes[0].subclasses[0];

    assert.deepStrictEqual(listBlingOptions(system, subclass, "POWER", order), [
      "Up_Low",
      "Up_High",
    ]);
    assert.deepStrictEqual(
      listBlingOptions(system, subclass, "POWER", (u) => (u === "Up_Low" ? 9 : 1)),
      ["Up_High", "Up_Low"],
    );
  });

  test("spent points are the index above the minimum", () => {
    const subclass = system.classes[0].subclasses[0];

    assert.strictEqual(
      countSpentPoints(system, subclass, [{ group: "power", index: 1 }], order),
      1,
    );
    assert.strictEqual(countSpentPoints(system, subclass, [], order), 0);
  });

  test("a definition is read by its header line", () => {
    const block = readBlockAtLine(parsed, 1);

    assert.strictEqual(block?.keyword, "CreateAHeroBling");
    assert.strictEqual(block?.fields.get("groupname")?.[0][0], "POWER");
  });
});
