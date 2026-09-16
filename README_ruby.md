# Ruby interlinear reader — the XHTML app

For XHTML books whose French carries a word-by-word gloss in `<ruby>`/`<rt>`.
The gloss is **shown and never read**. Everything else works like the Markdown
mixed reader: one block at a time, French in a French voice and English in an
English voice, each at its own speed, with exercise mode and automatic chapter
advance.

**This is a separate app.** It writes its own data folder (`data-ruby`), has
its own reader (`index_ruby.html`) and its own builder. Nothing in the
Markdown apps was modified — `build_books_mixed.js`, `index_mixed.html` and
`lexicon.js` are byte-for-byte identical to the versions you already have, and
all their tests still pass.

## Files

| File | What it is | Needed at runtime? |
|---|---|---|
| `index_ruby.html` | The reader. Self-contained. | **Yes** — served to the browser |
| `build_books_ruby.js` | The build step: XHTML → encrypted `data-ruby/`. | No |
| `xhtml_parse.js` | Small strict XML parser. Must sit beside the builder. | No |
| `lang_engine.js` | The FR/EN tagger. Must sit beside the builder. | No |
| `lexicon.js` | The generated word lists (shared with the Markdown app). | No |
| `tools/verify_ruby.js` | Checks a built library: integrity, coverage, ruby, gloss leakage. | No |
| `tools/audit_report.py` | Flags likely mis-tagged segments. | No |
| `test_ruby.js` | 20 checks for the reader (needs `npm i jsdom`). | No |
| `test_exercise.js` | Exercise-mode checks; runs against either app. |
| `test_chapterview.js` | Whole-chapter view checks; runs against either app. | No |

`lang_engine.js` is a **separate copy** of the tagger the Markdown builder
uses. That is deliberate: it means work on this app cannot change the
behaviour of the other one. The cost is that a fix to the tagger has to be
applied twice. If you would rather have one copy, the Markdown builder can be
pointed at this module — but that's a change to a working app, so it isn't
done by default.

## Where to put them

```
your-repo/
  index_mixed.html          existing Markdown app
  build_books_mixed.js      existing
  index_ruby.html           NEW  <- the reader
  build_books_ruby.js       NEW
  xhtml_parse.js            NEW  <- beside the builder
  lang_engine.js            NEW  <- beside the builder
  lexicon.js                shared by both builders
  books-src/                your .md books
  books-xhtml/              your .xhtml books
  data-mixed/               written by the Markdown builder
  data-ruby/                written by this one
  tools/
```

## Build

```powershell
$env:BOOK_PASSPHRASE="your secret"
node build_books_ruby.js .\books-xhtml\ . --report
```

Arguments are `[srcDir] [outDir] [dataDirName]`, same as the other builders.
Same encryption and the same passphrase workflow. The data folder is wiped on
every run, so build all your XHTML books in one command.

`--report` writes `segments-report.txt` (language tagging) and
`exercises-report.txt` (question/answer pairing) into `data-ruby/`. **Both
contain your book text in clear**, so if your build output is your published
repo, gitignore them:

```
data-ruby/segments-report.txt
data-ruby/exercises-report.txt
```

Other flags: `--default-lang=fr`, `--no-title-block`.

## Ruby

```
<ruby>Félicitations<rt>Congratulations</rt></ruby> <ruby>!<rt>!</rt></ruby>
<ruby>Vous<rt>You</rt></ruby> <ruby>avez<rt>have</rt></ruby> …
```

The `<ruby>` markup is carried through untouched, so the browser stacks each
gloss over its word exactly as the source file does. The speech text is built
**separately at build time from the ruby bases alone** — it is not derived by
stripping tags, because stripping tags drops the gloss into the middle of the
sentence. Your books gloss with English in some places and with a
pronunciation respelling in others; neither is ever read.

A **Glosses: On/Off** pill hides them for a second pass. That is purely a
display choice — it cannot change what is spoken, because the separation
already happened at build time.

One thing worth knowing: sentence punctuation travels *inside* a ruby in these
books (`<ruby>français.<rt>French.</rt>`). Sentence ends are therefore detected
on ruby bases too. Without that, a whole interlinear paragraph came out as one
segment — no sentence-level highlighting, and pausing replayed the entire
paragraph instead of the sentence being read.

## Pronunciation respellings

Respellings — "(luh kohn-SEHR)", "lah fee-loh-zoh-FEE" — are written for the
eye. Read aloud by any voice they are noise, so they are **displayed and never
spoken**, the same treatment ruby glosses get. Three forms appear in your
books and all three are handled:

- **Marked up**: `<span class="pronunciation">`, `<td class="pronunciation">`,
  and — inside list items — `<p class="pronunciation">`. Any element whose
  class says pronunciation/phonetic/IPA is display-only.
- **A column headed "Pronunciation"** in a table (this was already the case).
- **Unmarked**, which is where the pronunciation book's exercises live:
  `<li>la musique → lah-mew-ZEEK</li>`. Nothing in the markup distinguishes
  these, so they are recognised by shape — a hyphenated token with an ALL-CAPS
  syllable, in plain ASCII.

The shape rule is deliberately biased toward **under**-silencing. A hyphen part
that is a real word of four letters or more means the token is a genuine term
("debt-to-GDP", "TEF-style") and is left alone. Checked against all 751 such
tokens across the four books, it silences 713 and keeps 38 — and of those 38
the only true words are `debt-to-GDP` and the verb endings `-ER`, `-IR`, `-RE`.
The rest are respellings that happen to contain "tree", "pray" or "sweet" and
stay spoken. Missing a few is much better than silencing a real word.

After stripping, what remains is checked to see whether it is actually
language. "télécharger tay-lay-shahr-ZHAY" leaves "télécharger", worth hearing;
"luh STREE-meeng ah kohn-plet-MAHN trahnss-fohr-MAY lah fah-SOHN dohn ohn"
leaves only the unhyphenated syllables of the same respelling, so that line
goes silent altogether.

Exercise answers get the same treatment **for speech only**. In the
pronunciation book the printed answer often *is* the respelling, so it still
has to be shown — silencing it out of existence would turn 20 real answers
into "this book doesn't print an answer for this one", which is false.

Across the four books: **6,633 respellings displayed, 65 still spoken** (99%
removed), and those 65 are the deliberate misses above.

## Part-of-speech labels

Vocabulary entries carry a grammatical label written for the eye — "il est
important que **(expr.)**", "la souveraineté **(n.f.)**", "que je puisse
**(v.)**". Spoken, they interrupt the phrase being learned with "expression",
"en eff", "vee", so they are displayed and not read.

Recognised by shape rather than a fixed list: a parenthetical made only of
short letter-groups each ending in a dot. Across the four books that matches
exactly fourteen distinct tags — `n.f.` `n.m.` `v.` `expr.` `adj.` `f.` `m.`
`f.pl.` `n.` `m.pl.` `adv.` `n.f.pl.` `prov.` `n.m.pl.` — **1,758 occurrences,
with nothing else caught at all.**

Two limits keep it safe. The parenthetical must stand on its own, preceded by a
space or the start of the line, so the feminine-ending marker in
"américain(e)" is untouched — that is part of the word, not a label. And
abbreviations that carry meaning (`etc.` `i.e.` `e.g.` `cf.` `p.ex.` `vs.`)
are excluded outright, so a future book that uses them still reads them.

Result: **1,758 labels displayed, 0 spoken.**

### Whole-chapter view

A **View: Block / Chapter** pill. On **Chapter**, the whole chapter is on one
scrollable page with the block being read marked by an accent bar — useful for
working an exercise with the surrounding explanation still visible, or for any
time you want more context than one paragraph.

**Nothing about reading changes.** It is a rendering change only: playback
still moves block by block, highlighting is still per segment, exercise mode
still stops for input, and the per-language voices and speeds are untouched.
The current block keeps `id="blockEl"` in both views, which is what lets the
whole player go on working without knowing which view it is in.

Blocks are deliberately **not** dimmed. The point of this view is reading the
context while you answer, and greying it would defeat that.

The page is built once per chapter, so moving from block to block only moves
the marker and scrolls — a long chapter is not rebuilt on every sentence, and
your scroll position survives. The largest chapter in these books is 224
blocks / 71 KB of HTML, which a browser renders without noticing.

## Two chapter dropdowns

h1, h2 and h3 are **all** chapters, which in these books means up to 1,155 of
them — a single flat list would be unusable. So:

- the **first** dropdown lists only the h1 parts;
- the **second** lists that part plus every h2 and h3 inside it, indented by
  level.

Each chapter in the manifest carries `{t: title, l: level, h: index of its
h1}`. h4 and deeper stay as in-place heading blocks. Both dropdowns follow
along when the reader advances itself into the next part.

## Language

Same tagger as the Markdown app, plus something those files didn't have:
explicit class hints. `.french-only`, `.french-word`, `.ventry-fr` and
`.ventry-en`, and any `lang=` attribute, are trusted outright — the author
saying so beats any scoring of the words.

`.interlinear` is deliberately **not** treated as a language claim. It is
tempting, since every interlinear paragraph in the B2 books is French, but the
class means "this has glosses above it", not "this is French" — the
five-language vocabulary book uses it for English entries too, and trusting it
put 77 plain English sentences ("The pen is there, on the table.") into the
French voice.

## Exercise mode

Identical to the Markdown app: reading stops at each question, takes a typed
attempt, then shows and reads the answer **the book itself prints**. Nothing is
graded. Pairing is done at build time and only on an explicit key, with
ambiguity treated as failure.

### Working an exercise from the keyboard

Type, **Enter** to check, **Enter** again for the next question — the whole
exercise runs without the mouse. The cursor is placed in the answer box when a
question appears, and moves to **Next** once the answer is shown, so Enter
always has something to act on. Space does the same as Enter while the panel is
open, and Shift+Enter is still a newline for the longer writing tasks.

The cursor is not auto-placed on a coarse-pointer (touch) device, where it
would throw an on-screen keyboard over the text; tap the box instead.


These XHTML books give a much better key than the Markdown ones: **the answer
side repeats the question's heading verbatim.**

| Rule | Questions | Answers |
|---|---|---|
| Title (179 sets) | `<div class="exercise-box"><h3>A. Associez les systèmes…</h3>` | `<div class="answer-key"><h3>A. Associez les systèmes…</h3>` |
| Letter + section (128) | `h2 Exercices de vocabulaire` → `h3 A. Associez` | `h2 Les réponses` → `h3 Exercices de vocabulaire` → `h4 A. Associez` |
| Adjacency (6) | an exercise group with no key of its own | the next un-keyed answer group with the same number of items |

Every rule is scoped to the enclosing h1, and an answer group answers exactly
one exercise. Both constraints were added after they caught real mistakes: an
exercise whose own key was missing had reached 400 chapters forward and taken
a later lesson's answers, and a weaker letter match had re-taken a group the
title rule had already correctly claimed.

## What was verified

- **Parsing**: all four books are well-formed XML and parse in under 600 ms
  each. The parser is strict — it throws on mismatched tags or an unknown
  entity rather than guessing a tree, because a book that silently loses half
  a chapter to a tag-soup recovery rule is worse than a build that stops.
- **Nothing lost, nothing leaked** (`node tools/verify_ruby.js site-ruby books-xhtml <pass>`):
  across all four books, **0 integrity problems**, **100% of source vocabulary
  reaches the reader**, **100% of ruby elements survive into the display**
  (58,205 of them), and **0 of 5,249 gloss-only words reach the speech text**.
- **Language tagging** (`tools/audit_report.py`): of 37,878 segments, 1 tagged
  French that reads as English (0.003%) and 6 tagged English that read as
  French (0.016%).
- **Exercise pairing**: 313 sets, 1,718 questions, all but 7 with an answer
  from the book; **0 conflicts** under the automated check (two exercises
  drawing on the same answer group with overlapping numbers, where at most one
  can be right).
- **Reader** (`node test_ruby.js`, 20 checks): both dropdowns, part scoping,
  indentation, ruby rendered, glosses present but never spoken, gloss toggle
  display-only.
- **Exercise mode** (`APP_SITE=site-ruby APP_HTML=index_ruby.html
  APP_CHAPTER=Exercises node test_exercise.js`, 26 checks).
- **The Markdown app is untouched**: its three files are byte-identical and
  all 116 + 26 + 12 + 15 of its checks still pass.

### Where it still falls short

About 400 questions across the four books are found but left **unmatched** —
their exercise has no answer key the rules can identify, most often a writing
task whose "answer" is a model essay rather than a numbered list. Those
questions are still asked and your attempt still recorded; the panel says the
book prints no answer. That is the intended failure mode: refusing is much
better than attaching a plausible wrong answer.
