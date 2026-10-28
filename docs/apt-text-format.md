# APT text format

The APT editor can switch from its visual view to a text view of the whole
movie: the `.apt` and its `.const` as one indented text, for people who would
rather read and edit a movie than click through it. **bigFS: Open APT as
Text** (palette, editor title, the `.apt` context menu, or the page's own
switch) opens it; **Reopen as Visual Editor** in the text view's title bar
goes back.

The text is the movie, not an export of it. Every field the movie parser
reads is in it, written exactly, and saving the text writes the movie.

## Layout

````
apt-text 1
; MainMenu.apt with MainMenu.const.

const
  0 "this"
  1 "stop"
  2 7

import 9 "shared" "Thing"
export 8 "Label"

character 0 movie screen=1024x768 unknown36=33
  frame 0 "_start"
    bg #302010ff
    action
      ```as
      stop();
      ```
character 1 shape bounds=0,0,10,10 geometry=1
character 2 font name="Arial" glyphs=65,66
character 3 button bounds=0,0,10,10 hit-triangles=1
  record states=up,over,down depth=1 char=1 at 2,3 color 0.5,0.25,1,1
  action condition=0x00000008
    ```as
    gotoAndPlay("next");
    ```
character 4 sprite
  frame 0
    place move depth=2 char=1 name="clip" at 5,6 scale 2,3 rot 30 color *64,128,255,128 +16,32,48,0 ratio=0.5 clip=4
      action events=0x00000002
        ```as
        play();
        ```
    remove depth=7
character 5 image texture=5
character 6 morph start=1 end=1
character 7 text bounds=0,0,50,20 at 4,8
  run font=2 color 0.5,0.25,0.75,1 pen 1,2 height=12 glyphs=3:7,4:-2
character 8 edittext bounds=0,0,100,20 font=2 align=1 color=#ffcc00ff height=12 readonly=1 multiline=0 wordwrap=0 text="Hello" var="score"
character 9 placeholder
````

One record a line; what a record holds is indented two spaces under it.
`;` starts a comment that runs to the end of the line (outside strings and
script fences). Blank lines and comments are free, and are not kept when the
movie is saved and the text read again.

The first line is always `apt-text 1`, the version of this format.

### Values

| Written | Means |
| --- | --- |
| `12`, `0x0c`, `-3` | a whole number; a field's range is checked (`u32`, `i32`, byte) |
| `0.5`, `-0`, `1e-7`, `nan`, `inf` | a 32-bit float, written as the shortest decimal that reads back as the same float, so no value is ever rounded |
| `"text"` | a string; `\"`, `\\`, `\n`, `\t`, `\r` and `\xHH` escape, and only Latin-1 is allowed, as in the movie |
| `a,b,c,d` | a fixed number of values, comma separated, no spaces |
| `key=value` | a field; fields of a line can come in any order |

### Ids

Every character line carries its id: `character <id> <type>`. Characters are
listed in id order from 0, so an id is also its position. Any value that
names a character (`char=`, `font=`, `sprite=`, `start=`, `end=`, an
import's or export's id) is highlighted as an id; hovering it shows the
character's line and **Go to Definition** jumps there.

### Placement

`at x,y` is the translation, followed by the 2×2 matrix in the plainest form
that gives back the stored floats bit for bit:

| Written | Matrix |
| --- | --- |
| nothing | identity |
| `scale sx,sy` | `sx 0 0 sy` |
| `scale sx,sy rot deg` or `rot deg` | scaled, then turned by `deg` degrees: `sx·cos sx·sin -sy·sin sy·cos` |
| `matrix a,b,c,d` | the four stored floats in file order, when no scale and rotation rebuilds them exactly (a skew, for example) |

Any of the forms may be written by hand; the next read of the movie writes
whichever form is exact.

## Records

### Header blocks

| Line | Fields |
| --- | --- |
| `const` | the `.const` items, one a line: `<index> "string"` or `<index> <number>`, numbered from 0 |
| `import <id> "movie" "name"` | an import and the placeholder slot it fills |
| `export <id> "name"` | an export |

### Characters

| Type | Line | Holds |
| --- | --- | --- |
| `movie` | `screen=<w>x<h> unknown36=<n>` (character 0 only; `unknown36` is the Movie record's word at +36) | `frame` blocks |
| `shape` | `bounds=l,t,r,b geometry=<n>` | |
| `edittext` | `bounds= font= align= color=#rrggbbaa height= readonly= multiline= wordwrap=`, optional `text="..."` and `var="..."` | |
| `font` | optional `name="..."`, `glyphs=a,b,...` | |
| `button` | `bounds=l,t,r,b hit-triangles=<n>` | `record` and `action` lines |
| `sprite` | | `frame` blocks |
| `image` | `texture=<n>` | |
| `morph` | `start=<id> end=<id>` | |
| `text` | `bounds=l,t,r,b` and a placement | `run` lines |
| `placeholder` | | an empty slot, which an import fills |
| `unknown` | `type=<n>` | a type the parser does not know, kept as it is |

A button `record` is `states=up,over,down,hit` (or `none`; bits beyond the
four are written as a hex number in the list), `depth=`, `char=`, a
placement, `color r,g,b,a` (omitted when 1,1,1,1) and `unknown a,b,c,d`
(omitted when all zero). A button `action` is `condition=0x...` with its
script. A text `run` is `font=`, `color r,g,b,a`, `unknown l,t,r,b`
(omitted when zero), `pen x,y`, `height=` and `glyphs=index:advance,...`.

### Frames

`frame <n>` blocks list a timeline's frames in order from 0. A frame label
that comes first in its frame, with flags 0 and its own frame number, is
written on the frame's line: `frame 3 "intro"`. Inside a frame, one item a
line, in the order the frame holds them:

| Item | Fields |
| --- | --- |
| `place` | `move` when the record changes what is already at the depth; `depth=`, then each field only when its flag is set: `char=`, `name="..."`, a placement, `color *r,g,b,a +r,g,b,a` (multiply, then add, as bytes), `ratio=`, `clip=` (clip depth). Clip actions are indented under it as `action events=0x...` with their scripts. `flags=0x..` appears only when the stored flags say something the fields do not, such as a name flag with no name |
| `remove depth=<n>` | |
| `label "name"` | `flags=` when not 0, `frame=` when not the frame it is in |
| `bg #rrggbbaa` | the four stored bytes in file order |
| `action` | a frame script, in a fence |
| `initaction sprite=<id>` | an init action, in a fence |
| `unknown type=<n>` | an item the parser does not know, kept as it is |

### Scripts

An action block is written as its script, decompiled as the script tabs show
it (`docs/apt-scripts.md`), inside a fence indented under its owner:

````
    action
      ```as
      if (x > 3) {
        gotoAndPlay("end");
      }
      ```
````

The fence's word says how the block reads: `as` is the script form, `asm`
one instruction a line in the same language (both compile), and `listing` a
read-only listing of a block neither form gives back exactly. The script's
lines are indented as the fence is; the fence closes at a ```` ``` ```` at
the same indentation.

## Saving

Saving compares the text with the movie as it stands and turns every
difference into the editor's own edits (`AptEdit`s through the writer, and
the script compiler for a changed script), so a field that was not edited
is not written, and a text saved with no change leaves every byte of the
movie as it was. What saving does with each kind of change:

- A changed field is written in place, as the details panel writes it; a
  changed string is appended and repointed.
- A line added to a frame becomes a new record (`placeObject`,
  `removeObject`, `addFrameLabel`, `addBackgroundColor`, or a compiled
  script and `addFrameScript`), then edited to the fields the line gives. A
  line removed takes its record out of the frame. A frame whose items were
  reordered is written in the text's order, reusing every record.
- Frames added at the end of a timeline are new frames; frames removed from
  the end shorten it.
- A changed script is compiled to the end of the movie and every place that
  ran the old block is pointed at it. A block that runs in several places
  is shown at each; edit every copy alike, or the save is refused.
- A new character takes the next id and is one the editor can add:
  `edittext`, `sprite`, `shape`, `image` or `button` (a new button has
  `hit-triangles=2`). To empty a slot, write `character <id> placeholder`;
  characters are never taken out of the list, since ids would change. A
  character's type does not change.
- A new import takes the next character id: write `import <id> ...` and
  `character <id> placeholder` with it. Imports, exports, button records and
  actions, clip actions and text runs take new entries at their end.
- `.const` items change in place (a number) or are repointed (a string); new
  ones are appended; none can be removed, because scripts name them by
  index.

What the text cannot ask for is refused, never guessed: a type change, an
init action or unknown item added, a `hit-triangles` change, flag bits above
`0xff`, or a listing edited. A save is also checked after the fact: the
movie is read back and printed, and the save is accepted only when that
equals the text. Any problem, from a typo to a refused edit, is underlined
at its line, the save fails, and the movie is not touched.

While the movie is also open in the visual editor, the text shows that
editor's state, unsaved edits included, and saving the text applies to it as
one undoable edit and saves it. A movie in a base game source opens
read-only.
