# APT scripts

The APT editor shows each action block (frame actions, clip events, button
actions, init actions) as text in a small JavaScript-like language. It is
not JavaScript: every construct stands for one fixed run of instructions, so
the text describes the code exactly, and a block that is shown can always be
compiled back to code that runs the same.

When a block is opened it is decompiled, compiled again in memory and the two
compared instruction by instruction, ignoring only differences in encoding (a
string from the constant pool or inline, a byte or a long for a number,
`PushData` grouping). If the script form does not pass, the block is shown one
instruction a line (still editable); if that fails too, as a read-only
listing. **Apply** compiles the text to the end of the `.apt` and points the
frame, button or clip event at it; untouched blocks are never rewritten.
Values the new code needs that the `.const` lacks are appended to it.

## The language

| Text | Meaning |
|---|---|
| `x`, `` `odd.name` `` | a variable; backticks for names that are not identifiers |
| `$r1` | register 1 |
| `eval(e)` | the variable named by the value of `e` |
| `o.x`, `o[e]` | a member |
| `f(a, b)`, `o.m(a)`, `call[e](a)` | calls; `new` works the same way |
| `f(a);` | a call whose result is dropped (EA's `...Pop` forms) |
| `void f(a);` | a call followed by a separate `Pop` |
| `x := f(a);` | EA's call forms that assign the result to a variable |
| `x = v;`, `o.x = v;`, `x++;` | assignments |
| `var x = v;` | a local |
| `$r1 = v` | store to a register (the value stays usable) |
| `+ - * / % == === < > & \| ^ << >> >>> instanceof !` | SWF 5 operators |
| `#Op(a, b)`, `#Op<operand>()` | any instruction with a fixed stack effect, e.g. `#Stop()`, `#GotoFrame<3>()`, `#Add(a, b)` for the SWF 4 add |
| `asm Op operand;` | any instruction exactly as written |
| `push(e);`, `pop()` | a value left on the stack across statements |
| `if (c) { } else { }`, `while (c) { }` | Flash's branch shapes |
| `if (c) goto L;`, `unless (c) goto L;`, `goto L;`, `L:` | other branches |
| `constants "a", "b";` | the block's constant pool |
| `function f(a, b) { }` | `DefineFunction` |
| `function f($r1 a, b) flags 0x6a0002 { }` | `DefineFunction2`: argument registers, register count and flags |

Numbers with a fraction are stored as 32-bit floats. `pop()` must come before
anything else the same statement evaluates; the decompiler only writes it
there.

Sources: the bytecode layout and the meaning of EA's own opcodes are from
mint's `docs/research/apt-format.md` and `mint-sage-apt-player`'s
interpreter.
