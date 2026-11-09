/* build_books_ruby.js — turn XHTML books with RUBY INTERLINEAR GLOSSES into a
 * lazy-loaded, password-protected library for the ruby reader
 * (index_ruby.html).
 *
 * This is the fourth builder in the family, and a separate app end to end:
 *
 *   build_books.js              FR/EN parallel text (Markdown)
 *   build_books_monolingual.js  French only (Markdown)
 *   build_books_mixed.js        Code-switched FR/EN (Markdown)
 *   build_books_ruby.js  (this) XHTML, where the French carries a word-by-word
 *                               gloss in <ruby>/<rt>
 *
 * Nothing here touches the Markdown apps. It writes its own data folder and
 * has its own reader; the Markdown builders are not modified, and the shared
 * language tagger is a separate copy (lang_engine.js) for exactly that reason.
 *
 * Usage:
 *   node build_books_ruby.js [srcDir] [outDir] [dataDirName]
 *     srcDir      : folder of *.xhtml books   (default ./books-xhtml)
 *     outDir      : where the site lives      (default ./site)
 *     dataDirName : subfolder written under outDir, and the folder
 *                   index_ruby.html fetches from (default "data-ruby").
 *                   Distinct from the other builders' folders so all four
 *                   libraries can share one repo without wiping each other.
 *
 *   Flags:
 *     --report            write the language-tagging and exercise-pairing
 *                         audits next to the data (see the warning in the
 *                         README: they contain the book text in clear).
 *     --default-lang=fr   language for a fragment with no evidence at all.
 *     --no-title-block    don't emit each chapter's heading as its first block.
 *     --ai-pairing         after the deterministic rules (title / letter /
 *                         ordinal / adjacent) have had first refusal, send
 *                         whatever is STILL unmatched to the Claude API and
 *                         ask it to point at the right answer group by
 *                         meaning rather than by shape. Requires
 *                         ANTHROPIC_API_KEY in the environment. Off by
 *                         default — this sends chapter text to Anthropic's
 *                         API, which matters if these books are unpublished
 *                         or under contract, so it's opt-in per run, not a
 *                         standing default.
 *     --ai-model=NAME     model to call for --ai-pairing
 *                         (default: claude-sonnet-5).
 *     --ai-pairing-file=PATH   use pre-computed pairing decisions from PATH
 *                         instead of calling the API — e.g. decisions Claude
 *                         produced in an ordinary chat. No network call, no
 *                         ANTHROPIC_API_KEY needed, $0. Same JSON shape the
 *                         model would have returned (see AI-ASSISTED PAIRING
 *                         below); --export-unmatched writes a blank one to
 *                         fill in.
 *     --export-unmatched=PATH   write whatever the deterministic rules (and
 *                         --ai-pairing/--ai-pairing-file, if also given)
 *                         still couldn't place — grouped by h1, with the
 *                         candidate answer groups alongside each question —
 *                         to PATH as JSON. For a book with hundreds of h1s
 *                         this is a far smaller, more structured thing to
 *                         hand to Claude than the raw source xhtml. Fill in
 *                         "a"/"confidence"/"why" on the questions and the
 *                         result is valid input for --ai-pairing-file.
 *     --reuse-salt-from=PATH   derive this run's key from the salt already
 *                         stored in an existing manifest.json at PATH,
 *                         instead of a fresh random one. Needed to rebuild a
 *                         single book as a drop-in .enc replacement inside an
 *                         existing data-ruby folder — without it the new
 *                         .enc is encrypted with a different key and won't
 *                         decrypt there. Takes priority over the automatic
 *                         reuse below.
 *
 *   SALT REUSE (automatic): if <dataDir>/manifest.json already exists, its
 *   salt and PBKDF2 settings are REUSED (read before the folder is cleared),
 *   so the same passphrase keeps deriving the same key across rebuilds. With
 *   no manifest, a new random salt is generated. The passphrase is never
 *   stored. Every encrypted book still gets a fresh random AES-GCM IV.
 *
 * ---------------------------------------------------------------------------
 * AI-ASSISTED PAIRING (--ai-pairing)
 * ---------------------------------------------------------------------------
 * The deterministic rules match GROUPS by shape — an identical heading, a
 * shared leading letter, an explicit ordinal, or (failing all of that) being
 * the very next unlabelled answer block. That shape assumption is exactly
 * what a combined end-of-chapter "Corrigé" breaks: its sub-headings are
 * *paraphrases* of the question headings ("A. Vrai ou faux ?" answered under
 * "Compréhension A"), so no rule above ever proposes a candidate, right or
 * wrong — the question is silently dropped before matching is even attempted.
 *
 * The AI pass does NOT replace the rules; it only gets a turn at whatever the
 * rules refused, still scoped to one h1 at a time exactly as the rules are,
 * and its own output goes through the SAME item-alignment code afterwards
 * (numbered lookup, or same-length positional lookup) — so a model that picks
 * the right group but whose item count doesn't line up still yields no
 * answer, same as it would from a heuristic hit. The model is asked to
 * return null rather than guess, and only a "high" confidence pairing is
 * accepted; everything it returns is written to ai-pairing-report.txt under
 * --report so a wrong pairing can be caught by a human, not just trusted.
 *
 * ---------------------------------------------------------------------------
 * RUBY
 * ---------------------------------------------------------------------------
 * The whole point of these books:
 *
 *   <ruby>Félicitations<rt>Congratulations</rt></ruby> <ruby>!<rt>!</rt></ruby>
 *   <ruby>Vous<rt>You</rt></ruby> <ruby>avez<rt>have</rt></ruby> …
 *
 * The gloss is DISPLAYED and NEVER SPOKEN. The <ruby> markup is carried
 * through to the reader untouched, so the browser sets each gloss above its
 * word exactly as it does in the source file; the speech text is built from
 * the ruby BASE only. Some books gloss with English ("développé/developed"),
 * others with a pronunciation respelling ("littérature/lah-lee-tay-rah-TEWR");
 * the same rule covers both, and it is the reason speech text is assembled
 * during the walk rather than by stripping tags afterwards — strip the tags
 * and the gloss lands in the middle of the sentence.
 *
 * ---------------------------------------------------------------------------
 * CHAPTERS
 * ---------------------------------------------------------------------------
 * h1, h2 AND h3 all start a chapter, and the reader picks them with two
 * dropdowns: the first lists only the h1s, the second lists that h1 plus the
 * h2s and h3s underneath it. So every chapter records its level and the index
 * of the h1 it belongs to. h4 and deeper are in-place heading blocks, as in
 * the Markdown app.
 *
 * ---------------------------------------------------------------------------
 * LANGUAGE
 * ---------------------------------------------------------------------------
 * Same tagger as the Markdown app (lang_engine.js), but these files carry
 * something the Markdown ones didn't: explicit class hints. A paragraph inside
 * .interlinear, .french-only or .ventry-fr is French by construction, and
 * .ventry-en is English. Where such a hint is present it is trusted outright —
 * it is the author's own statement, and far better evidence than any scoring
 * of the words. Everything else is tagged from the text as before.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseXhtml, findElement } = require(path.join(__dirname, 'xhtml_parse.js'));
const LE = require(path.join(__dirname, 'lang_engine.js'));

// ============================== options ==============================

const PBKDF2_ITER = 250000;   // declared early: --reuse-salt-from reads this as a fallback below
const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
const positional = argv.filter(a => !a.startsWith('--'));
function flagValue(name, dflt){
  const hit = flags.find(f => f === '--'+name || f.startsWith('--'+name+'='));
  if(!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq < 0 ? true : hit.slice(eq+1);
}
const SRC = positional[0] || path.join(__dirname, 'books-xhtml');
const OUT = positional[1] || path.join(__dirname, 'site');
const DATA_NAME = positional[2] || 'data-ruby';
const DATA = path.join(OUT, DATA_NAME);
const WANT_REPORT = !!flagValue('report', false);
const DEFAULT_LANG = (flagValue('default-lang','en') === 'fr') ? 'fr' : 'en';
const EMIT_TITLE_BLOCK = !flagValue('no-title-block', false);
const WANT_AI_PAIRING = !!flagValue('ai-pairing', false);
const AI_MODEL = flagValue('ai-model', 'claude-sonnet-5');
const AI_PAIRING_FILE = flagValue('ai-pairing-file', null);
// --export-unmatched: instead of (or alongside) calling the API, write a
// compact worksheet of whatever the deterministic rules couldn't place — for
// a book with hundreds of h1s, that's a far smaller, more structured thing to
// hand to Claude in a normal chat than the raw source xhtml would be. Fill in
// "a" (and confidence/why) on each entry and the result is already valid
// input for --ai-pairing-file.
const EXPORT_UNMATCHED = flagValue('export-unmatched', null);
const REUSE_SALT_FROM = flagValue('reuse-salt-from', null);
if(WANT_AI_PAIRING && !AI_PAIRING_FILE && !process.env.ANTHROPIC_API_KEY){
  console.error('--ai-pairing needs ANTHROPIC_API_KEY in the environment (or pass --ai-pairing-file instead, which needs no key and makes no API calls). Aborting.');
  process.exit(1);
}
// --ai-pairing-file: a JSON array of pre-computed decisions, e.g. produced by
// pasting the leftover question/answer groups to Claude in an ordinary chat
// and saving what comes back — so pairing can happen with zero API billing.
// Shape: [{ "under": "<ancestry, ' > '-joined>", "q": "<question heading>",
//           "a": "<answer heading or null>", "confidence": "high"|"low",
//           "why": "<optional>" }, ...]
let AI_PAIRING_MAP = null;
if(AI_PAIRING_FILE){
  let rows;
  try{ rows = JSON.parse(fs.readFileSync(AI_PAIRING_FILE, 'utf8')); }
  catch(e){ console.error('Could not read --ai-pairing-file '+AI_PAIRING_FILE+': '+e.message); process.exit(1); }
  if(!Array.isArray(rows)){ console.error('--ai-pairing-file must contain a JSON array.'); process.exit(1); }
  AI_PAIRING_MAP = new Map();
  for(const r of rows){
    if(!r || !r.q) continue;
    AI_PAIRING_MAP.set((r.under || '') + ' :: ' + r.q, { a: r.a ?? null, confidence: r.confidence || 'high', why: r.why || '' });
  }
  console.log('Loaded '+AI_PAIRING_MAP.size+' pairing(s) from '+AI_PAIRING_FILE+' (no API calls will be made).');
}
// --reuse-salt-from: point at an EXISTING manifest.json so this run derives
// the same AES key from the same passphrase, instead of a fresh random salt.
// Without this, a one-book rebuild is NOT a valid drop-in replacement for
// that book's .enc file in an existing data-ruby folder — a new random salt
// means a new key, and the old manifest.json still expects the old one.
let REUSE_SALT = null, REUSE_ITER = null;
if(REUSE_SALT_FROM){
  let m;
  try{ m = JSON.parse(fs.readFileSync(REUSE_SALT_FROM, 'utf8')); }
  catch(e){ console.error('Could not read --reuse-salt-from '+REUSE_SALT_FROM+': '+e.message); process.exit(1); }
  if(!m.crypto || !m.crypto.salt){ console.error(REUSE_SALT_FROM+' has no crypto.salt to reuse.'); process.exit(1); }
  REUSE_SALT = Buffer.from(m.crypto.salt, 'base64');
  REUSE_ITER = m.crypto.iter || PBKDF2_ITER;
  console.log('Reusing the salt from '+REUSE_SALT_FROM+' — the .enc this run writes will decrypt with that manifest\u2019s existing key.');
}
// $ per million tokens, input/output. Anthropic's published rates change
// over time and this list will drift — it exists so a run PRINTS an actual
// dollar estimate instead of leaving that to be worked out by hand
// afterwards, not as a source of truth. Unrecognised models still get an
// exact token count, just no $ conversion.
const AI_PRICING = {
  'claude-haiku-4-5-20251001': { in: 1,  out: 5  },
  'claude-sonnet-5':           { in: 2,  out: 10 },
  'claude-opus-5-5':           { in: 4,  out: 20 },
  'claude-opus-5':             { in: 5,  out: 25 },
  'claude-fable-5-1':          { in: 10, out: 50 }
};
LE.setDefaultLang(DEFAULT_LANG);

const { classify, scoreText, speechText, escapeHtml } = LE;

// ============================== encryption ==============================
// Identical scheme and passphrase workflow to the other three builders.

function encryptJSON(obj, key){
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([ c.update(Buffer.from(JSON.stringify(obj),'utf8')), c.final() ]);
  return { v:1, iv: iv.toString('base64'),
           ct: Buffer.concat([ct, c.getAuthTag()]).toString('base64') };
}
function getPassphrase(){
  if(process.env.BOOK_PASSPHRASE) return Promise.resolve(process.env.BOOK_PASSPHRASE);
  return new Promise(res => {
    const rl = require('readline').createInterface({ input:process.stdin, output:process.stdout });
    process.stdout.write('Passphrase to encrypt the books (you type this in the reader to decrypt): ');
    rl._writeToOutput = () => {};
    rl.question('', ans => { rl.close(); process.stdout.write('\n'); res(ans); });
  });
}

// ============================== the DOM walk ==============================

const BLOCK_TAGS = new Set(['p','div','section','article','blockquote','ul','ol','table',
  'pre','h1','h2','h3','h4','h5','h6','hr','figure','dl','aside','header','footer','main','nav']);
const INLINE_WRAP = { strong:'strong', b:'strong', em:'em', i:'em', u:'u',
  small:'small', sub:'sub', sup:'sup', code:'code', mark:'mark', span:null, a:null, abbr:null, cite:'em' };

// Class hints that state the language outright. The author saying so beats
// any amount of word scoring, so these are trusted rather than treated as a
// tiebreak.
//
// Note what is NOT here: `interlinear`. It is tempting — in the B2 books every
// interlinear paragraph is French — but the class means "this has glosses
// above it", not "this is French". The five-language vocabulary book uses it
// for its English entries too, and treating it as a language claim put 77
// plain English sentences ("The pen is there, on the table.") into the French
// voice. Glossed text is tagged from its words like anything else.
const LANG_CLASS = [
  [/\bventry-en\b|\blang-en\b|\benglish-only\b|\benglish-word\b/, 'en'],
  [/\bventry-fr\b|\blang-fr\b|\bfrench-only\b|\bfrench-word\b/, 'fr']
];
function classLang(el, inherited){
  const c = (el.attrs && (el.attrs.class || '')) || '';
  const l = (el.attrs && (el.attrs.lang || el.attrs['xml:lang'] || '')).toLowerCase();
  if(l.startsWith('fr')) return 'fr';
  if(l.startsWith('en')) return 'en';
  for(const [re, lang] of LANG_CLASS) if(re.test(c)) return lang;
  return inherited;
}
function classOf(el){ return (el.attrs && el.attrs.class) || ''; }

// Elements that are DISPLAYED but never SPOKEN. Pronunciation respellings —
// "(luh kohn-SEHR)", "lah fee-loh-zoh-FEE" — are written for the eye; read
// aloud by a French or English voice they are nonsense, and in the
// pronunciation book they sit inline in every vocabulary list and exercise.
// This is the same rule already applied to ruby glosses and to table columns
// headed "Pronunciation"; it just needed to follow the class as well, since
// these books mark it up as <span class="pronunciation">, <td
// class="pronunciation"> and, inside list items, <p class="pronunciation">.
const SILENT_CLASS = /\b(pronunciation|prononciation|phonetic|phon[ée]tique|ipa|respelling)\b/i;
function isSilent(el){ return SILENT_CLASS.test(classOf(el)); }

/* Unmarked respellings.
 * The pronunciation book also writes respellings with no class at all, as the
 * right-hand side of an arrow inside exercises:
 *     <li>la musique → lah-mew-ZEEK</li>
 *     <li>Le streaming a transformé…<br/> → luh STREE-meeng ah kohn-plet-MAHN…</li>
 * Nothing in the markup distinguishes those from ordinary text, so they are
 * recognised by their shape: a hyphenated token containing an ALL-CAPS
 * syllable, in plain ASCII.
 *
 * The rule is deliberately biased toward under-silencing. A hyphen part that
 * is a real word of four letters or more means the token is a genuine term
 * ("debt-to-GDP", "TEF-style") and is left alone. Checked against every such
 * token in all four books — 751 of them — this silences 713 and keeps 38, and
 * of those 38 the only true words are "debt-to-GDP" and the verb endings -ER,
 * -IR, -RE. The rest are respellings that happen to contain "tree", "pray" or
 * "sweet" and stay spoken: a miss, which is the safe direction to fail in.
 */
const RESPELL_MIN_WORD = 4;
let RESPELL_KNOWN = null;
function knownWords(){
  if(!RESPELL_KNOWN){
    RESPELL_KNOWN = new Set([...LE.FR_FUNCTION, ...LE.FR_LEXICON,
      ...LE.EN_FUNCTION, ...LE.EN_LEXICON, ...LE.NEUTRAL, ...LE.GEN_FR, ...LE.GEN_EN]);
  }
  return RESPELL_KNOWN;
}
function isRespellingToken(w){
  if(!/-/.test(w) || !/[A-Z]{2,}/.test(w) || !/[a-z]/.test(w)) return false;
  if(/[\u00c0-\u00ff]/.test(w)) return false;        // respellings are plain ASCII
  const k = knownWords();
  return !w.split('-').some(p => p.length >= RESPELL_MIN_WORD && k.has(p.toLowerCase()));
}
/* Part-of-speech tags.
 * Vocabulary entries carry a grammatical label that is written for the eye and
 * adds nothing to the ear: "il est important que (expr.)", "la souveraineté
 * (n.f.)", "que je puisse (v.)". Spoken, they interrupt the phrase being
 * learned with "expression", "en eff", "vee".
 *
 * Recognised by shape rather than by a fixed list: a parenthetical made only
 * of short letter-groups each ending in a dot. Checked across all four books,
 * that matches exactly fourteen distinct tags — n.f., n.m., v., expr., adj.,
 * f., m., f.pl., n., m.pl., adv., n.f.pl., prov., n.m.pl. — 1,758 occurrences,
 * with nothing else caught at all.
 *
 * Two deliberate limits. The parenthetical must stand on its own (preceded by
 * a space or the start of the line), so the feminine-ending marker in
 * "américain(e)" is untouched — it is part of the word, not a label. And
 * abbreviations that carry meaning are excluded outright, so a future book
 * that writes "(cf.)" or "(i.e.)" still reads them.
 */
const POS_TAG = /(^|\s)\(([A-Za-z]{1,6}\.(?:\s?[A-Za-z]{1,4}\.)*)\)/g;
const POS_KEEP = new Set(['etc.','i.e.','e.g.','cf.','p.ex.','ex.','nb.','ca.','vs.']);
function stripPosTags(text){
  if(!text || text.indexOf('(') < 0) return text;
  return text.replace(POS_TAG, (m, pre, body) =>
    POS_KEEP.has(body.toLowerCase().replace(/\s/g,'')) ? m : pre)
    // The label often sits before a comma; removing it would otherwise leave
    // the comma floating a space away from the word it belongs to.
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Strip respellings from a line, then ask whether what is left is actually
// language. "télécharger tay-lay-shahr-ZHAY" leaves "télécharger", which is
// worth hearing. "luh STREE-meeng ah kohn-plet-MAHN trahnss-fohr-MAY lah
// fah-SOHN dohn ohn" leaves "luh ah lah dohn ohn" — the unhyphenated
// syllables of the same respelling — which is not, so the line goes silent
// altogether. This replaced a fixed "mostly respelling" ratio, which got both
// of those cases wrong in opposite directions.
function looksLikeLanguage(tokens){
  const k = knownWords();
  return tokens.some(t => {
    const w = t.replace(/[^A-Za-z\u00c0-\u00ff']/g,'');
    if(w.length < 3) return false;
    if(/[\u00c0-\u00ff]/.test(w)) return true;       // accents are always real French
    if(k.has(w.toLowerCase())) return true;
    // Length alone, because lexicon membership is not enough here: the word
    // lists deliberately exclude cognates, so "concert" is in neither of them
    // and "le concert luh-kohn-SEHR" was silenced whole. The leftover
    // syllables of a respelling ("luh", "ah", "lah", "dohn", "ohn") are short;
    // a real word that carries a line usually isn't.
    return w.length >= 5;
  });
}
// Everything that is displayed but not spoken, in one place.
function speechClean(text){ return stripRespellings(stripPosTags(text)); }

function stripRespellings(text){
  if(!text) return text;
  const parts = text.split(/(\s+)/);
  const kept = [], dropped = [];
  let any = false;
  for(const p of parts){
    if(!/[A-Za-z]/.test(p)){ kept.push(p); continue; }
    if(isRespellingToken(p.replace(/^[^A-Za-z-]+|[^A-Za-z-]+$/g,''))){ any = true; dropped.push(p); continue; }
    kept.push(p);
  }
  if(!any) return text;
  const rest = kept.filter(p => /[A-Za-z\u00c0-\u00ff]/.test(p));
  if(!looksLikeLanguage(rest)) return '';
  return kept.join('').replace(/\s+/g,' ').trim();
}


function textOf(node){
  if(node.type === 'text') return node.text;
  if(node.name === 'rt') return '';            // a gloss is never part of the text
  return (node.children || []).map(textOf).join('');
}
// The text as it will be SPOKEN: ruby bases only, glosses dropped.
function speechOf(node){ return speechText(textOf(node)); }
// The same, for the exercise matcher's copy of a line (_lines, _rows): a <br>
// counts as a space. textOf joins the text on either side of a <br> with
// nothing in between, so "…une bonne semaine.<br/>(Last week…" became
// "semaine.(Last" — one word to the sentence splitter, and the answer's first
// English sentence was then read in the French voice. The page never had the
// problem: inlineTokens turns <br> into a line break of its own.
function flowTextOf(node){
  if(node.type === 'text') return node.text;
  if(node.name === 'rt') return '';
  if(node.name === 'br') return ' ';
  return (node.children || []).map(flowTextOf).join('');
}
function flowSpeechOf(node){ return speechText(flowTextOf(node)); }

/* ---- inline tokens ----
 * Every inline run becomes a list of tokens carrying BOTH the HTML to show
 * and the text to speak. They differ for exactly two things — ruby (gloss
 * shown, not spoken) and <br> — which is why the two can't be derived from
 * each other afterwards. */
function inlineTokens(node, out, style){
  for(const ch of (node.children || [])){
    if(ch.type === 'text'){
      if(ch.text) out.push({ speech: ch.text, html: escapeHtml(ch.text), style: style });
      continue;
    }
    const n = ch.name;
    if(n === 'rt' || n === 'rp') continue;                      // handled by the ruby branch
    if(isSilent(ch)){
      // Shown exactly as written, contributing nothing to the speech text.
      // Atomic so no sentence split can land inside it.
      out.push({ speech: '', html: serializeChild(ch), style: style, atomic: true });
      continue;
    }
    if(n === 'ruby'){
      // Atomic: never split a word away from its gloss.
      out.push({ speech: textOf(ch), html: serializeRuby(ch), style: style, atomic: true });
      continue;
    }
    if(n === 'br'){ out.push({ speech: '\n', html: '<br>', style: style, atomic: true, brk: true }); continue; }
    if(n === 'img' || n === 'svg') continue;
    if(Object.prototype.hasOwnProperty.call(INLINE_WRAP, n)){
      const wrap = INLINE_WRAP[n];
      const inner = [];
      inlineTokens(ch, inner, wrap ? wrap : style);
      // A styled run keeps its tag per piece. Splitting a <strong> into two
      // <strong>s where a sentence ends looks identical and keeps every
      // segment a self-contained piece of HTML.
      out.push(...inner);
      continue;
    }
    // Anything else inline-ish: take its contents.
    inlineTokens(ch, out, style);
  }
  return out;
}
function serializeRuby(el){
  let base = '', rt = '';
  for(const ch of (el.children || [])){
    if(ch.type === 'text'){ base += escapeHtml(ch.text); continue; }
    if(ch.name === 'rt'){ rt += serializeInlineHtml(ch); continue; }
    if(ch.name === 'rp') continue;
    base += serializeChild(ch);
  }
  const cls = classOf(el);
  return '<ruby'+(cls ? ' class="'+escapeHtml(cls)+'"' : '')+'>'+base+'<rt>'+rt+'</rt></ruby>';
}
// One inline child, WITH its own tag. serializeInlineHtml walks an element's
// children and so never emits the element's own wrapper; called directly on a
// <strong> it silently returned the text without the bold. These books mark
// the stressed syllable that way — <ruby>thir<strong>teen</strong><rt>…</rt>
// — so dropping it lost the one thing that paragraph was teaching.
function serializeChild(ch){
  if(ch.type === 'text') return escapeHtml(ch.text);
  if(ch.name === 'rt' || ch.name === 'rp') return '';
  if(ch.name === 'br') return '<br>';
  if(ch.name === 'ruby') return serializeRuby(ch);
  const wrap = INLINE_WRAP[ch.name];
  const inner = serializeInlineHtml(ch);
  return wrap ? '<'+wrap+'>'+inner+'</'+wrap+'>' : inner;
}
function serializeInlineHtml(el){
  let out = '';
  for(const ch of (el.children || [])) out += serializeChild(ch);
  return out;
}

/* ---- segmenting a token run ----
 * Same split / tag / merge shape as the Markdown builder, but driven off the
 * token list so the HTML stays exact and rubies stay whole. */
// A sentence can end INSIDE a ruby, because these books gloss word by word
// and the full stop travels with its word: <ruby>français.<rt>French.</rt>.
// Without this, a whole interlinear paragraph came out as a single segment —
// no sentence-level highlighting, and pausing would replay the entire
// paragraph rather than the sentence being read.
const ATOMIC_SENT_END = /[.!?\u2026]["'\u201d\u2019\u00bb)\]]*$/;

function splitTokenPieces(tokens){
  const pieces = [];
  for(const t of tokens){
    if(t.atomic || !t.speech){
      pieces.push({ speech: t.speech || '', html: t.html, style: t.style,
                    atomic: true, brk: !!t.brk,
                    endsSentence: !t.brk && ATOMIC_SENT_END.test((t.speech || '').trim()) });
      continue;
    }
    for(const sent of LE.splitSentences(t.speech)){
      const subs = LE.splitSeparators(sent.raw);
      subs.forEach((sub, i) => {
        pieces.push({
          speech: sub.raw,
          html: escapeHtml(sub.raw),
          style: t.style,
          endsSentence: (i === subs.length - 1) && sent.endsSentence,
          isSep: sub.isSep
        });
      });
    }
  }
  return pieces;
}
function wrapStyled(html, style){
  if(!style || style === 'plain') return html;
  return '<'+style+'>'+html+'</'+style+'>';
}
// `force` is a class-declared language that overrides scoring entirely.
function segmentTokens(tokens, seed, force){
  const pieces = splitTokenPieces(tokens);
  for(const p of pieces){
    p.lang = (p.isSep || !p.speech.trim()) ? 'none'
           : force ? force
           : classify(scoreText(p.speech));
  }
  const segs = [];
  for(const p of pieces){
    const cur = segs[segs.length - 1];
    const compatible = cur && !cur.closed && !p.brk &&
      (p.lang === 'none' || cur.lang === 'none' || cur.lang === p.lang);
    if(compatible){
      cur.pieces.push(p);
      if(cur.lang === 'none') cur.lang = p.lang;
    } else {
      segs.push({ lang: p.lang, pieces: [p], closed: false });
    }
    if(p.endsSentence || p.brk) segs[segs.length - 1].closed = true;
  }
  for(let i = 0; i < segs.length; i++){
    if(segs[i].lang !== 'none') continue;
    let lang = null;
    for(let j = i - 1; j >= 0 && !lang; j--) if(segs[j].lang !== 'none') lang = segs[j].lang;
    for(let j = i + 1; j < segs.length && !lang; j++) if(segs[j].lang !== 'none') lang = segs[j].lang;
    segs[i].lang = lang || seed || DEFAULT_LANG;
  }
  return segs.map(s => ({
    lang: s.lang,
    html: s.pieces.map(p => wrapStyled(p.html, p.style)).join(''),
    text: speechClean(speechText(s.pieces.map(p => p.speech).join('')))
  })).filter(s => s.html !== '');
}

// ============================== block building ==============================

function renderSegs(segs, counter, out){
  return segs.map(s => {
    if(!s.text || !s.text.trim()) return s.html;   // shown, never spoken
    const i = counter.n++;
    out.push({ lang: s.lang, text: s.text });
    return '<span class="ttsSeg" data-seg="'+i+'" data-lang="'+s.lang+'">'+s.html+'</span>';
  }).join('');
}

function buildInlineBlock(el, type, ctx, extra){
  const segs = [], counter = { n:0 };
  const force = classLang(el, ctx.lang);
  // A whole block marked as pronunciation is shown and skipped, not dropped:
  // returning null here would delete it from the page as well as from the
  // audio, and the respelling is the thing that paragraph exists to show.
  const html = isSilent(el)
    ? serializeInlineHtml(el)
    : renderSegs(segmentTokens(inlineTokens(el, [], 'plain'), ctx.seed, force), counter, segs);
  if(!segs.length && !html.trim()) return null;
  const block = Object.assign({ type: type, html: html, segs: segs }, extra || {});
  if(ctx.quote) block.quote = true;
  if(ctx.box) block.box = ctx.box;
  block._lines = [{ raw: flowSpeechOf(el), segFrom: 0, segTo: counter.n - 1 }];
  ctx.seed = segs.length ? segs[segs.length-1].lang : ctx.seed;
  return block;
}

function buildListBlock(el, ctx){
  const segs = [], counter = { n:0 };
  const force = classLang(el, ctx.lang);
  const ordered = el.name === 'ol';
  const type = (el.attrs && el.attrs.type) || '';
  // <ol start="7"> continues the numbering of an earlier list (vb05 splits
  // one exercise into JOUER 1-6, MANGER 7-9, FAIRE 10-12). Dropping it made
  // the page and the exercise panel both count 1, 2, 3 again.
  const startAttr = ordered && el.attrs ? String(el.attrs.start || '').trim() : '';
  const start = /^-?\d+$/.test(startAttr) ? parseInt(startAttr, 10) : 1;
  const lines = [];
  let html = '<'+(ordered ? 'ol' : 'ul')+' class="rbList"'+(type ? ' type="'+escapeHtml(type)+'"' : '')
           +(start !== 1 ? ' start="'+start+'"' : '')+'>';
  for(const li of (el.children || [])){
    if(li.type !== 'element' || li.name !== 'li') continue;
    const liForce = classLang(li, force);
    const from = counter.n;
    const inner = renderSegs(segmentTokens(inlineTokens(li, [], 'plain'), ctx.seed, liForce), counter, segs);
    html += '<li>' + inner + '</li>';
    lines.push({ raw: flowSpeechOf(li), segFrom: from, segTo: counter.n - 1 });
  }
  html += '</'+(ordered ? 'ol' : 'ul')+'>';
  if(!segs.length && !lines.length) return null;
  const block = { type:'list', ordered: ordered || undefined, listType: type || undefined,
                  html: html, segs: segs };
  if(ctx.quote) block.quote = true;
  if(ctx.box) block.box = ctx.box;
  block._lines = lines;
  if(start !== 1) block._start = start;
  return block;
}

const PRONUNCIATION_HEADER = /pronunciation|prononciation|phonetic|phon[ée]tique/i;
function buildTableBlock(el, ctx){
  const segs = [], counter = { n:0 };
  const force = classLang(el, ctx.lang);
  const rows = [];
  (function collect(node){
    for(const ch of (node.children || [])){
      if(ch.type !== 'element') continue;
      if(ch.name === 'tr'){ rows.push(ch); continue; }
      if(['thead','tbody','tfoot'].includes(ch.name)) collect(ch);
    }
  })(el);
  if(!rows.length) return null;

  const cellsOf = tr => (tr.children || []).filter(c => c.type === 'element' && (c.name === 'td' || c.name === 'th'));
  const header = cellsOf(rows[0]);
  const isHeaderRow = header.length > 0 && header.every(c => c.name === 'th');
  const headerText = header.map(speechOf);
  // As in the Markdown builder: a pronunciation column is shown but not read,
  // because a respelling like "(bohn-ZHOOR)" is noise in any voice.
  const skipCol = headerText.map(h => PRONUNCIATION_HEADER.test(h));

  let html = '<table class="rbTable">';
  const rowMap = [];
  rows.forEach((tr, ri) => {
    const cells = cellsOf(tr);
    const isHead = (ri === 0 && isHeaderRow);
    const from = counter.n;
    html += '<tr>';
    cells.forEach((cell, cx) => {
      const tag = cell.name === 'th' ? 'th' : 'td';
      if(!isHead && (skipCol[cx] || isSilent(cell))){
        html += '<'+tag+' class="noSpeak">'+serializeInlineHtml(cell)+'</'+tag+'>';
        return;
      }
      const cellForce = classLang(cell, force);
      const inner = renderSegs(segmentTokens(inlineTokens(cell, [], 'plain'), ctx.seed, cellForce), counter, segs);
      html += '<'+tag+'>'+inner+'</'+tag+'>';
    });
    html += '</tr>';
    if(!isHead) rowMap.push({ cells: cells.map(flowSpeechOf), segFrom: from, segTo: counter.n - 1 });
  });
  html += '</table>';
  if(!segs.length && !rowMap.length) return null;
  const block = { type:'table', html: html, segs: segs };
  if(ctx.quote) block.quote = true;
  if(ctx.box) block.box = ctx.box;
  block._rows = rowMap;
  block._header = headerText;
  return block;
}

// Recognised container classes, kept on the block so the reader can box them
// the way the source CSS does, and so the exercise pass can find questions.
function boxOf(cls){
  if(/\bexercise-box\b/.test(cls)) return 'exercise';
  if(/\banswer-key\b/.test(cls)) return 'answer';
  if(/\b(highlight-box|tip-box|tip|note|warning|nuance-note|formula-box|prereq-box|preview-box|celebration-box|compare-box)\b/.test(cls)) return 'note';
  return null;
}

function extractBook(file){
  const raw = fs.readFileSync(file, 'utf8');
  const doc = parseXhtml(raw, path.basename(file));
  const head = findElement(doc, 'head');
  const titleEl = head && findElement(head, 'title');
  const bookTitle = (titleEl ? speechText(textOf(titleEl)) : '') ||
                    path.basename(file, path.extname(file));
  const body = findElement(doc, 'body');
  if(!body) throw new Error('No <body> in ' + file);

  const chapters = [];
  let cur = null, curH1 = -1;
  function startChapter(text, level){
    if(level === 1) curH1 = chapters.length;
    cur = { title: text, level: level, h1: (level === 1 ? chapters.length : curH1),
            titleEl: null, blocks: [] };
    chapters.push(cur);
    return cur;
  }
  function ensureChapter(){
    if(!cur) startChapter(bookTitle, 1);
    return cur;
  }
  function push(block){ if(block){ ensureChapter().blocks.push(block); } }

  function walk(node, ctx){
    for(const ch of (node.children || [])){
      if(ch.type === 'text'){
        // Loose text directly inside a container: keep it as a paragraph
        // rather than dropping it.
        if(ch.text && ch.text.trim()){
          const fake = { type:'element', name:'p', attrs:{}, children:[ch] };
          push(buildInlineBlock(fake, 'p', ctx));
        }
        continue;
      }
      const n = ch.name;
      if(n === 'script' || n === 'style' || n === 'head') continue;

      const hm = /^h([1-6])$/.exec(n);
      if(hm){
        const level = parseInt(hm[1], 10);
        const text = speechOf(ch);
        if(!text){ continue; }
        if(level <= 3){
          const c = startChapter(text, level);
          c.titleEl = ch;
          // The box the heading itself sits in (a tip box's own title, say),
          // as opposed to the box of whatever follows it. Exercise matching
          // only; removed by stripBuildScaffolding.
          c._headBox = ctx.box || null;
        } else {
          push(buildInlineBlock(ch, 'heading', ctx, { level: level }));
        }
        continue;
      }
      if(n === 'hr') continue;
      if(n === 'p'){ push(buildInlineBlock(ch, 'p', ctx)); continue; }
      if(n === 'ul' || n === 'ol'){ push(buildListBlock(ch, ctx)); continue; }
      if(n === 'table'){ push(buildTableBlock(ch, ctx)); continue; }
      if(n === 'pre'){ push(buildInlineBlock(ch, 'art', ctx)); continue; }
      if(n === 'blockquote'){
        walk(ch, { lang: classLang(ch, ctx.lang), quote: true, box: ctx.box, seed: ctx.seed });
        continue;
      }
      if(BLOCK_TAGS.has(n)){
        const cls = classOf(ch);
        walk(ch, { lang: classLang(ch, ctx.lang), quote: ctx.quote,
                   box: boxOf(cls) || ctx.box, seed: ctx.seed });
        continue;
      }
      // An inline element sitting on its own between blocks.
      push(buildInlineBlock(ch, 'p', ctx));
    }
  }
  walk(body, { lang: null, quote: false, box: null, seed: null });

  if(EMIT_TITLE_BLOCK){
    for(const c of chapters){
      if(!c.titleEl) continue;
      const b = buildInlineBlock(c.titleEl, 'heading', { lang:null, seed:null },
                                 { level: c.level, chapterTitle: true });
      if(b) c.blocks.unshift(b);
    }
  }

  const kept = [];
  const remap = new Map();
  chapters.forEach((c, i) => {
    if(!c.blocks.length) return;
    remap.set(i, kept.length);
    kept.push(c);
  });
  // Keep every chapter's h1 pointer valid after empty ones are dropped.
  kept.forEach(c => {
    let h = c.h1;
    while(h >= 0 && !remap.has(h)) h--;
    c.h1 = remap.has(h) ? remap.get(h) : 0;
    delete c.titleEl;
  });

  return { title: bookTitle, source: path.basename(file), chapters: kept };
}

module.exports = { extractBook, segmentTokens, inlineTokens, buildTableBlock, classLang, boxOf };

/* ===========================================================================
 * EXERCISE MODE: pairing questions with the book's own answers
 * ===========================================================================
 * Same contract as the Markdown app — read the question, take a typed
 * attempt, then show and read the answer the book itself prints — and the same
 * governing principle: a confidently WRONG answer is far worse than no answer,
 * so a pairing is made only on an explicit key, and only when exactly one
 * candidate fits.
 *
 * These XHTML books give a much better key than the Markdown ones did: the
 * answer side repeats the question's heading VERBATIM.
 *
 *     <div class="exercise-box">            <div class="answer-key">
 *       <h3>A. Associez les systèmes…</h3>    <h3>A. Associez les systèmes…</h3>
 *       <ol><li>la démocratie directe</li>    <ol><li>c — la démocratie directe : …</li>
 *
 * and in the graded-reader layout the answer section mirrors the whole
 * hierarchy:
 *
 *     h2 Exercices de vocabulaire            h2 Les réponses
 *       h3 A. Associez                         h3 Exercices de vocabulaire
 *                                                h4 A. Associez
 *
 * So title equality is the primary rule, with letter+section, ordinal and
 * adjacency behind it for anything that doesn't line up that neatly.
 *
 * One structural difference from the Markdown builder: here h1/h2/h3 are all
 * CHAPTERS, so an exercise group is sometimes a chapter of its own and
 * sometimes an h4 heading inside one. The book is therefore flattened into a
 * linear list of groups first, each remembering the headings it sits under, so
 * both shapes are handled the same way.
 */

const ANS_HEADING = /\b(answers?|answer\s*keys?|r[ée]ponses?|corrig[ée]s?|solutions?|mod[èe]les?)\b/i;
const EX_HEADING  = /\b(exercices?|exercises?|drills?|quiz|practice\s+tests?|test\s+blanc|examen\s+blanc|activit[ée]s?)\b/i;
const EX_ORDINAL  = /\b(exercices?|exercises?|drills?|t[âa]ches?|tasks?|activit[ée]s?)\s*(?:n[°o]\s*)?(\d+)/i;
const EX_LETTER   = /^\s*([A-J])\s*[.)]\s/;
// The answer-key counterpart to EX_LETTER: these books' Corrigé sections
// rename "A. Vrai ou faux ?" to "Compréhension A" — the letter survives, but
// moves from the front to the back, and the label word changes too
// ("Compréhension" vs "Vrai ou faux"). EX_LETTER alone never matches that, so
// a group's letter falls back to a trailing one when there's no leading one.
// Deliberately narrow — a single isolated capital letter A-J at the very end,
// with nothing after it — so it doesn't fire on ordinary text that happens to
// end mid-sentence on a capital.
const EX_LETTER_TRAILING = /(?:^|\s)([A-J])\s*$/;
// A third shape, found in the vocabulary-builder answer keys: the letter
// survives, but sits right after a generic "Auto-évaluation" framing prefix
// instead of at either end — "Auto-évaluation B. Vocabulaire passif",
// "Auto-évaluation — B : Vocabulaire passif". Narrow to that one specific
// prefix (with its punctuation variants) rather than "any letter anywhere",
// so it can't misfire on ordinary text that happens to contain a capital
// letter mid-sentence.
const EX_LETTER_AFTER_PREFIX = /^Auto[- ]?[ée]valuation\s*[-:—.]?\s*([A-J])\b/i;
// "Exercise A", "Exercise B — Build the phrase": the letter follows a generic
// label word instead of leading the heading.
const EX_LETTER_AFTER_LABEL = /^(?:Exercises?|Exercices?|Activit[ée]s?|Tasks?|T[âa]ches?)\s+([A-J])\b/i;
const NUM_PREFIX  = /^\s*(\d+)\s*[.)]\s*/;
// Lists whose markers are letters or roman numerals are option pools to choose
// FROM ("Définitions: a) … b) …"), not the questions themselves.
const OPTION_LIST = /^[aAiI]$/;

// JS's \b is ASCII-only: it treats an accented letter as a NON-word
// character, so a trigger word that ENDS right on one — "Corrigé", not
// "Corrigés" — never reaches a \b at all and silently fails to match, while
// the plural form (ending in the ASCII "s") matches fine. That is a
// content-dependent bug, not a design choice, so headings are de-accented
// before ANS_HEADING/EX_HEADING/EX_ORDINAL ever see them; the char classes in
// those patterns already accept the plain-letter form ([ée], [èe]), so
// nothing about which spellings match changes — only whether \b can fire.
// Parenthetical asides are stripped too: headings in these books carry an
// inline English gloss — "B. Répondez aux questions (Answer the
// questions)" — and the bare word "Answer" inside that gloss was tripping
// ANS_HEADING on what is plainly a QUESTION heading. The structural cue
// these regexes are meant to catch ("Corrigé", "Les réponses", "Exercices…")
// is never inside the parenthetical translation, so stripping it costs
// nothing.
function headingCue(t){
  return String(t || '').replace(/\([^)]*\)/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
// ANS_HEADING is meant to catch a SECTION LABEL — "Corrigé", "Les réponses" —
// but "réponse" is also an ordinary noun inside exercise instructions:
// "G. Choisissez la bonne réponse" is a QUESTION heading, and matching it
// on that word filed a whole exercise as an answer key. Removing the
// "la bonne / meilleure / mauvaise / correcte réponse" idiom before testing
// keeps real labels matching while letting that instruction read as what it is.
function answerCue(t){
  return headingCue(t).replace(
    /\b(?:(?:la|une|cette|votre|sa)\s+)?(?:bonne|meilleure|mauvaise|correcte?|juste)\s+reponses?\b/gi, ' ')
    // "solutions" is also a trigger word (for a heading literally titled
    // "Solutions"), but just as often an ordinary noun in a vocabulary theme
    // — "Les tensions ET solutions" (problems-and-solutions is a normal pair
    // of things to learn words for). "X et solutions" is that phrase, not a
    // section label, so it doesn't get to trigger ANS_HEADING.
    .replace(/\w+\s+et\s+solutions?\b/gi, ' ');
}
function exOrdinal(t){
  const m = EX_ORDINAL.exec(headingCue(t));
  if(!m) return null;
  const w = m[1].toLowerCase();
  const kind = /^exerc/.test(w) ? 'ex' : /^drill/.test(w) ? 'drill' : /^t[âa]ch|^task/.test(w) ? 'task' : 'act';
  return kind + ':' + m[2];
}
function exLetter(t){
  const s = (t || '').trim();
  const m = EX_LETTER.exec(s);
  if(m) return m[1].toUpperCase();
  const mt = EX_LETTER_TRAILING.exec(s);
  if(mt) return mt[1].toUpperCase();
  const mp = EX_LETTER_AFTER_PREFIX.exec(s);
  if(mp) return mp[1].toUpperCase();
  const ml = EX_LETTER_AFTER_LABEL.exec(s);
  return ml ? ml[1].toUpperCase() : null;
}
function normTitle(t){
  return speechText(String(t || '')).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}
const SECTION_STOP = new Set(['de','du','des','la','le','les','un','une','et','aux','au',
  'the','of','and','for','with','chapter','chapitre','partie','part','les','reponses']);
function sectionWords(t){
  return new Set((normTitle(t).match(/[a-z]{3,}/g) || []).filter(w => !SECTION_STOP.has(w)));
}
function overlap(a, b){ for(const w of a) if(b.has(w)) return true; return false; }
// Compare on a 5-letter stem so "plural"/"plurals", "match"/"matching" and
// "vocabulaire"/"vocabulary" count as the same subject word.
function stem5(w){ return w.length >= 5 ? w.slice(0,5) : w; }
function overlapCount(a, b){
  const bs = new Set([...b].map(stem5));
  let n = 0; for(const w of a) if(bs.has(stem5(w))) n++; return n;
}
const GENERIC_HEADING_WORDS = new Set(['auto','evaluation','corrige','corriges','answer','answers',
  'key','reponse','reponses','exercice','exercices','exercise','exercises','chapitre','chapter']);
// Only true CATEGORY labels — broad enough to sit in dozens of unrelated
// chapters' ancestry — get demoted here. Words like "entrainement", "orale"
// or "pratique" stay: they're what actually identifies THOSE specific pairs
// ("Production orale" / "Production orale : exemples de réponses" would
// share nothing at all if "production" and "orale" were excluded too).
const TOPIC_GENERIC_WORDS = new Set(['grammaire','grammar','vocabulaire','vocabulary','comprehension',
  'annexe','annex','appendix','mots','mot','word','words','liste','list',
  'essentiels','essentiel','essential','strategies','strategie','strategy',
  'memorisation','memorization','points','culturels','culturel','cultural',
  'faut','retenir','remember','resume','summary','recap','recapitulatif',
  'what','that','this','these','those','with','from','have','about']);

// Items out of one block: list entries, numbered paragraphs, or table rows
// keyed by a numeric first column.
function itemsFromBlock(bl, blockIdx){
  if(bl.type === 'list'){
    if(bl.listType && OPTION_LIST.test(bl.listType)) return [];
    const first = bl._start || 1;
    return (bl._lines || []).map((ln, i) => {
      const m = NUM_PREFIX.exec(ln.raw);
      return { num: m ? parseInt(m[1],10) : (first+i), pos: i+1, blockIdx: blockIdx,
               segFrom: ln.segFrom, segTo: ln.segTo, text: ln.raw };
    });
  }
  if(bl.type === 'p'){
    const ln = (bl._lines || [])[0];
    if(!ln) return [];
    const m = NUM_PREFIX.exec(ln.raw);
    if(!m) return [];
    return [{ num: parseInt(m[1],10), pos: null, blockIdx: blockIdx,
              segFrom: ln.segFrom, segTo: ln.segTo, text: ln.raw }];
  }
  if(bl.type === 'table'){
    const out = [];
    (bl._rows || []).forEach(r => {
      const first = String(r.cells[0] || '').trim();
      // A bare number in its own cell ("1"), or the number written into the
      // cell with its text ("1. le père" — how the matching exercises in the
      // vocabulary builders are laid out). The second form was silently
      // producing zero items, so those exercises never reached the pairer.
      const m = /^(\d+)\s*(?:[.)]\s*(.*))?$/.exec(first);
      if(!m) return;
      const lead = m[2] ? [m[2]] : [];
      out.push({ num: parseInt(m[1],10), pos: null, blockIdx: blockIdx,
                 segFrom: r.segFrom, segTo: r.segTo,
                 text: lead.concat(r.cells.slice(1)).filter(Boolean).join(' \u2014 ') });
    });
    return out;
  }
  return [];
}

// Flatten the book into groups: a heading (chapter title or in-chapter h4+)
// plus the items that follow it, remembering the headings it sits under.
//
// The ancestry has to be the FULL chain, not just the h1. In the graded-reader
// layout the answer key is an h2 ("Les réponses") whose h3 children repeat the
// question sections ("Exercices de vocabulaire") and whose h4s repeat the
// groups ("A. Associez"). Tracking only the h1 left those h3s looking like
// question sections, and 466 of one book's questions went unmatched because
// their answers were never recognised as answers.
function collectGroups(book){
  const groups = [];
  const stack = [];                       // stack[level] = that level's current title
  book.chapters.forEach((ch, ci) => {
    stack[ch.level] = ch.title;
    stack.length = ch.level + 1;          // drop any deeper headings still held
    const ancestry = stack.slice(1, ch.level + 1).filter(Boolean);
    // Chapters whose "Question N" / "Answer N" blocks were already paired by
    // attachNumberedQA are finished. Left in, their prompt lines ("3.") and
    // "Check your answer" lists were read as stray numbered items and counted
    // as unmatched questions. Never set for books that don't use that layout.
    if(ch._qaPaired) return;
    // parents: the headings ABOVE the group (its ancestry minus its own title).
    let cur = { title: ch.title, chapterIdx: ci, ancestry: ancestry.slice(), parents: ancestry.slice(0, -1),
                box: null, headBox: ch._headBox || null, items: [], blockFrom: 0 };
    groups.push(cur);
    ch.blocks.forEach((bl, bi) => {
      if(bl.type === 'heading' && !bl.chapterTitle){
        cur.blockTo = bi - 1;
        cur = { title: speechText(bl.html.replace(/<[^>]+>/g,' ')),
                chapterIdx: ci, ancestry: ancestry.slice(), parents: ancestry.slice(), box: bl.box || null,
                headBox: bl.box || null, items: [], blockFrom: bi };
        groups.push(cur);
        return;
      }
      if(bl.box && !cur.box) cur.box = bl.box;
      // A number alone in a paragraph ("1.") with its content in the list that
      // follows: the Five-Language answer keys are laid out this way. Read
      // naively it gives an EMPTY item 1 plus separate list items that are
      // numbered again from 1, so the answers were lost. Fold the list into
      // the numbered item instead.
      if(bl.type === 'list' && cur._emptyNum && !(bl.listType && OPTION_LIST.test(bl.listType))){
        const lines = (bl._lines || []).map(l => String(l.raw || '').trim()).filter(Boolean);
        cur._emptyNum.text = cur._emptyNum.num + '. ' + lines.join(' / ');
        cur._emptyNum = null;
        return;
      }
      // A list or table in a note box INSIDE an exercise — the prescription
      // the questions are about, a tip — is material to read, not lines to
      // answer. Counted as questions, it made vb05's "H. Les instructions
      // médicales" nine lines against a six-answer key: no answers at all.
      if(bl.box === 'note' && cur.box === 'exercise'){ cur._emptyNum = null; return; }
      const its = itemsFromBlock(bl, bi);
      cur._emptyNum = (bl.type === 'p' && its.length === 1 && /^\s*\d+\s*[.)]\s*$/.test(its[0].text)) ? its[0] : null;
      cur.items.push(...its);
    });
    cur.blockTo = ch.blocks.length - 1;    // a group runs to the next heading or the chapter's end
  });
  // Two or more lettered lists in one group ("A. envoyez / B. enverrez / …"
  // under each "Question 8:") are the choices of multiple-choice questions,
  // not questions: a typed <ol type="a"> is skipped already, and a list
  // lettered in its text is now skipped the same way. Counted as questions,
  // a mock exam's ten questions became forty option lines, matched a forty-
  // answer Corrigé by count alone, and every option got some other
  // question's answer. In such a group only a NUMBERED line can be a
  // question; an unnumbered one is part of the document being read (a
  // Mini-TEF's notice, line by line) and goes too, or it would be paired
  // with the answers whenever its line count happened to match the key's.
  // (ONE lettered list is left alone: the option pool of a matching
  // exercise, or the lettered parts a, b, c of the exercise.)
  groups.forEach(g => {
    if(g.items.length < 4) return;
    const blocks = book.chapters[g.chapterIdx].blocks, lettered = new Set();
    for(let i = g.blockFrom; i <= g.blockTo; i++){
      const b = blocks[i];
      if(!b || b.type !== 'list' || (b.listType && OPTION_LIST.test(b.listType))) continue;
      const lines = (b._lines || []).map(l => l.raw || '');
      if(lines.length >= 2 && lines.every(t => LETTER_LABEL.test(t))) lettered.add(i);
    }
    if(lettered.size >= 2) g.items = g.items.filter(it => !lettered.has(it.blockIdx) && NUM_PREFIX.test(it.text));
  });
  return groups.map(g => {
    // Two kinds of heading never introduce an answer key, whatever words they
    // hold: one whose content is an exercise box ("A. Associez le problème à
    // la solution" — "solution" is a trigger word, so the exercise was filed
    // as an answer key and lost along with its real key), and one that sits
    // INSIDE a note box (the "Notes culturelles" and "Résumé" tip boxes that
    // end a chapter after its Corrigé, and so inherit the Corrigé ancestry —
    // they were being handed out as the "answers" to vocabulary lists).
    const notAnswer = g.box === 'exercise' || g.headBox === 'note';
    g.isAnswer = !notAnswer && (g.box === 'answer' || ANS_HEADING.test(answerCue(g.title)) ||
                 g.ancestry.some(a => ANS_HEADING.test(answerCue(a))));
    g.isExercise = !g.isAnswer && (g.box === 'exercise' ||
                 EX_HEADING.test(headingCue(g.title)) || g.ancestry.some(a => EX_HEADING.test(headingCue(a))));
    g.ord = exOrdinal(g.title);
    g.letter = exLetter(g.title);
    g.norm = normTitle(g.title);
    g.words = sectionWords(g.ancestry.join(' ') + ' ' + g.title);
    // Words that actually identify WHAT this exercise is about. Excluded: the
    // chapter's own title (ancestry[0] — every group in the chapter shares
    // it, so sharing it proves nothing) and generic framing words that sit on
    // both sides of unrelated exercises ("Auto-évaluation", "Corrigé",
    // "Réponses"). Without this, "B. Paires minimales" and "B. Vocabulaire
    // passif (Auto-évaluation)" counted as related because both mentioned
    // "auto-évaluation", and the wrong answer group was claimed — which then
    // starved the exercise that really owned it.
    g.info = new Set([...sectionWords(g.ancestry.slice(1).join(' ') + ' ' + g.title)]
                     .filter(w => !GENERIC_HEADING_WORDS.has(w)));
    // A stricter pool for Rule 2b, which (unlike the letter rule) has no
    // independent signal of its own to lean on — word overlap IS the entire
    // case, so it can't be satisfied by a shared SECTION-CATEGORY word alone.
    // "3. Numbers 0-30" and "Grammaire : entraînement" share nothing but
    // "grammaire", picked up from ancestry, not from either group's own
    // subject — demoting it stops that kind of coincidence from counting.
    g.topicInfo = new Set([...g.info].filter(w => !TOPIC_GENERIC_WORDS.has(w)));
    return g;
  });
}

// Subject words for Rule 2b, leaving out the headings the two groups SHARE.
// Siblings under one parent always share that parent's words, which proves
// nothing about whether one answers the other: FIA3's "Méthode" (strategy
// steps) and "Modèle" (a model exam answer) sit side by side under "Labo TEF",
// matched on "labo"/"tef" plus a count of four each, and the strategy steps
// became four questions with the model's lines as their answers.
function topicWordsApart(g, other){
  const p = g.parents || [], o = other.parents || [];
  let shared = 0;
  while(shared < p.length && shared < o.length && p[shared] === o[shared]) shared++;
  const own = p.slice(Math.max(1, shared)).join(' ') + ' ' + g.title;
  return new Set([...sectionWords(own)].filter(w => !GENERIC_HEADING_WORDS.has(w) && !TOPIC_GENERIC_WORDS.has(w)));
}

/* ---------------------------------------------------------------------------
 * WHOLE-SET EXERCISES
 * ---------------------------------------------------------------------------
 * Some exercises are answered as one set, not line by line:
 *   - matching ("Associez", "Relie", "Match", or a single lettered option
 *     list): a line asked on its own is cut off from the options it has to be
 *     matched with, and from the other lines whose options it uses up;
 *   - sorting into categories ("Classez", "Catégorisez"): the key is laid out
 *     by category ("Positif : généreux, honnête…"), so no single line has an
 *     answer of its own — unless every line carries its own blank and the key
 *     answers line by line, which stays line by line;
 *   - putting a set in order: paired by position, the question "Il se brosse
 *     les dents." got the answer "Il se réveille." — the first line of the
 *     ORDERED list. Only when the key really is an order (a reordering of the
 *     same lines, "C, E, A, D, B", lettered lines, or a key of another shape);
 *     "Mettez les mots dans l'ordre", one scrambled sentence per line with one
 *     sentence per answer, stays line by line;
 *   - exercises with nothing to pair line by line at all: blanks inside a
 *     dialogue's paragraphs, "find the five errors in this text", a key
 *     printed as one sentence, or (exact title or ordinal only) a key whose
 *     count differs from the question's.
 * Such an exercise becomes ONE question, asked once the whole exercise has
 * been read: the item points at the exercise's last readable block (as the
 * Maya layout does), the panel shows the whole exercise (qHtml), and the
 * answer is the whole answer group — shown, read aloud and compared as one.
 */
const SET_MATCH = /\b(?:associe[zr]?|associez-les|faites correspondre|fais correspondre|appariez|apparie[rz]?|match(?:es|ing)?)\b/i;
// "Relie(z)" is matching when it links X TO Y ("Reliez chaque mot à sa
// définition", "…aux activités"), not when it joins sentences WITH a word
// ("Relie les deux phrases avec dans laquelle…", one rewritten sentence per
// line). The first preposition after the verb decides. (The cue is
// unaccented, so "à" arrives as "a".)
function matchCue(cue){
  if(SET_MATCH.test(cue)) return true;
  const m = /\breli(?:e|ez|er)\b([\s\S]*)/i.exec(cue);
  if(!m) return false;
  const p = /\b(a|au|aux|avec)\b/i.exec(m[1]);
  return !!p && p[1].toLowerCase() !== 'avec';
}
const SET_SORT  = /\b(?:classez|classer|classe (?:les|ces|chaque|ce)|categorisez|categoriser|categorise (?:les|ces)|categori[sz]e|classify|triez|trier|trie (?:les|ces)|rangez (?:les|ces|chaque)|regroupez|sort (?:the|these|each|them|into)|put (?:the|these|each) [a-z ]{0,30}(?:column|categor|group))\b/i;
const SET_ORDER = /(?:dans l'ordre|dans le bon ordre|ordre (?:logique|chronologique)|\bin (?:the )?(?:right |correct |logical |chronological )?order\b|\breorder|\breordonne[zr]?\b)/i;
const LETTER_LABEL = /^\s*\(?[a-zA-Z]\s*[.)]\s*\S/;
const BLANK_MARK = /_{2,}|…|\.\.\.|\[\s*\]|\(\s*\)/;

// The blocks a group owns, its headings left out.
function groupBody(book, g){
  const blocks = book.chapters[g.chapterIdx].blocks, out = [];
  const to = g.blockTo == null ? blocks.length - 1 : g.blockTo;
  for(let i = g.blockFrom; i <= to; i++){
    const b = blocks[i];
    if(b && b.type !== 'heading' && (b.html || '').trim()) out.push(i);
  }
  return out;
}
function blockPlain(bl){
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
  if(bl.type === 'table') return (bl._rows || []).map(r => r.cells.map(clean).filter(Boolean).join(' — ')).filter(Boolean).join(' / ');
  return (bl._lines || []).map(l => clean(l.raw)).filter(Boolean).join(bl.type === 'list' ? ' / ' : ' ');
}
// One source block -> one panel block, as qaBlockHtml does for the Maya books.
function setBlockHtml(bl){
  const h = String(bl.html || '').replace(/ data-seg="\d+"/g, '');
  return h.trim() ? '<div class="exBlk' + (bl.type === 'table' ? ' rbTableWrap' : '') + '">' + h + '</div>' : '';
}
// The heading plus the instructions: the paragraphs before the exercise's
// first list or table. Content further down is never read for keywords.
function exerciseCue(book, g){
  const blocks = book.chapters[g.chapterIdx].blocks, parts = [g.title];
  for(const bi of groupBody(book, g)){
    const b = blocks[bi];
    if(b.type === 'list' || b.type === 'table') break;
    if(b.type === 'p' && !NUM_PREFIX.test(blockPlain(b))) parts.push(blockPlain(b));
  }
  return headingCue(parts.join(' ')).replace(/[‘’ʼ]/g, "'");
}
// Lettered option pools: a list typed a/A/i/I, a list whose every line opens
// with a letter label, or a table column whose every cell does (beside the
// numbered column). A matching exercise has ONE; a multiple-choice exercise
// has one per question. A lettered list that supplies ALL of the exercise's
// lines is the exercise itself — parts a, b, c… — not a pool to choose from.
function optionPools(book, g){
  const blocks = book.chapters[g.chapterIdx].blocks;
  let n = 0;
  const lettered = new Set();
  for(const bi of groupBody(book, g)){
    const b = blocks[bi];
    if(b.type === 'list'){
      const lines = (b._lines || []).map(l => l.raw || '');
      if(b.listType && OPTION_LIST.test(b.listType)) n++;
      else if(lines.length >= 3 && lines.every(t => LETTER_LABEL.test(t))){ n++; lettered.add(bi); }
    } else if(b.type === 'table'){
      const rows = b._rows || [];
      if(rows.length < 3) continue;
      const cols = Math.max(...rows.map(r => r.cells.length));
      for(let c = 1; c < cols; c++){
        if(rows.every(r => LETTER_LABEL.test(String(r.cells[c] || '')))){ n++; break; }
      }
    }
  }
  if(lettered.size && !g.items.some(it => !lettered.has(it.blockIdx))) n -= lettered.size;
  return n;
}
// "1 = d, 2 = f", "1, F; 2, B", "1-d", "1d": number-to-letter pairs. A key
// starts at 1 and counts up, which is what keeps clock times out ("À 8h, 12h,
// 16h et 20h" is three "pairs" too, with h for heures).
function keyNumbers(text){
  const re = /(?:^|[^\w])(\d{1,2})\s*(?:=|:|-|–|—|→|>|,)?\s*[a-jA-J](?![\w'’])/g;
  const nums = new Set();
  let m;
  while((m = re.exec(String(text || '')))) nums.add(parseInt(m[1], 10));
  return nums;
}
function mappingPairs(text){
  const nums = keyNumbers(text);
  return nums.has(1) && nums.has(2) && nums.has(3) ? nums.size : 0;
}
// "C, E, A, D, B", "2, 5, 4, 7, 1", "d → f → b", or letters with nothing but
// spaces between them ("d c b e f a" — and the spoken text drops the arrows,
// so "d → f → b" reaches this function as "d f b"): an order written as a key.
const KEY_SEQUENCE = /(?:^|[^\w])(?:(?:[a-jA-J]|\d{1,2})(?:\s*(?:,|;|→|->|-|–|—|>)\s*(?:[a-jA-J]|\d{1,2})(?![\w'’])){2,}|[a-jA-J](?:\s+[a-jA-J](?![\w'’])){2,})/;
const KEY_MAPPING = /(?:^|[^\w])\d{1,2}\s*(?:=|:|-|–|—|→|>|,)?\s*[a-jA-J](?:\s*[,;]\s*\d{1,2}\s*(?:=|:|-|–|—|→|>|,)?\s*[a-jA-J](?![\w'’])){2,}/;
// Lines with nothing in them but a number and a blank ("1. …", the cells of
// a sorting grid "… — 1. …"). They give no word to answer about, so in a
// sorting or ordering exercise they are slots of ONE answer, not questions.
function contentless(items){
  return items.length > 0 && items.every(it => !/\p{L}{2,}/u.test(String(it.text || '')
    .replace(NUM_PREFIX, '').replace(/_{2,}|…|\.\.\./g, ' ')));
}
function isPermutation(q, a){
  const norm = t => normTitle(String(t || '').replace(NUM_PREFIX, '').replace(/^\s*\(?[a-zA-Z]\s*[.)]\s+/, ''));
  const qs = q.items.map(i => norm(i.text)), as = a.items.map(i => norm(i.text));
  if(qs.length < 3 || qs.length !== as.length) return false;
  const have = new Set(qs);
  return as.filter(t => have.has(t)).length >= Math.ceil(as.length * 0.6) && qs.join('|') !== as.join('|');
}
// An exercise done with the recording ("Play Script 3: write the four
// sentences", "Écoute le script un et écris…"). Its script sits elsewhere in
// the chapter, so asked as a whole set it could only interrupt the reading
// with a question nobody can answer at that point. (A listening exercise that
// prints its own questions line by line is unaffected.)
const AUDIO_CUE = /\b(?:play script|script (?:\d+|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|one|two|three|four|five|seven|eight|nine|ten)\b|ecoutez? le script|ecoutez? l'enregistrement|ecoutez? le document|listen to (?:the )?(?:script|recording|audio))/i;
// 'match' | 'sort' | 'order' | 'whole' to ask the exercise as one set; 'skip'
// for a whole set that needs the recording; null to pair it line by line.
function setKind(book, q, a, rule){
  if(rule === 'key') return null;                 // Rule 5 splits one key across exercises by number
  const cue = exerciseCue(book, q);
  if(q.items.length){
    const aBlocks = book.chapters[a.chapterIdx].blocks;
    const aText = groupBody(book, a).map(bi => blockPlain(aBlocks[bi])).join(' ');
    const lettered = q.items.length >= 3 && q.items.every(i => LETTER_LABEL.test(i.text));
    const empty = contentless(q.items);
    if(SET_ORDER.test(cue) && (isPermutation(q, a) || KEY_SEQUENCE.test(aText) || lettered || empty ||
                               a.items.length !== q.items.length)) return 'order';
    if(SET_SORT.test(cue) && (empty || !(a.items.length === q.items.length && q.items.every(i => BLANK_MARK.test(i.text))))) return 'sort';
    if(matchCue(cue) || optionPools(book, q) === 1 || mappingPairs(aText) >= 3) return 'match';
    if(a.items.length === q.items.length) return null;
    if(a.items.length && rule !== 'title' && rule !== 'ordinal') return null;
    return AUDIO_CUE.test(cue) ? 'skip' : 'whole';
  }
  // No lines to pair at all: a set whatever it is, named from its instructions.
  if(AUDIO_CUE.test(cue)) return 'skip';
  return SET_ORDER.test(cue) ? 'order' : SET_SORT.test(cue) ? 'sort' : matchCue(cue) ? 'match' : 'whole';
}
// What "Identical to the book's answer" compares a whole-set answer with: the
// compact key when the answer has one ("1 = d, 2 = f…", "C, E, A, D, B"),
// otherwise nothing, and the reader falls back to the full answer text.
// Read one block at a time, so a key can't run on into the next block's text
// ("Ordre : d f b e a c g" followed by the list line "d. Le patient…").
// A matching key comes out as "1d 2f 3b…" whichever way the book wrote it:
// "1 = d, 2 = f", "1. c (…) 2. a (…)", or one key line per list item
// ("d (s'enregistrer = to check in)", "chaleureux b) warm").
function answerKeyOf(texts, items){
  for(const text of texts){
    const pairs = [], re = /(?:^|[^\w])(\d{1,2})\s*(?:[.)=:,>→–—-])?\s*([a-jA-J])(?![\w'’])/g;
    let m;
    while((m = re.exec(text))) pairs.push([parseInt(m[1], 10), m[2].toLowerCase()]);
    if(pairs.length >= 3 && pairs.every((p, i) => p[0] === i + 1)) return pairs.map(p => p[0] + p[1]).join(' ');
    const ms = KEY_SEQUENCE.exec(text);
    if(ms) return ms[0].replace(/^[^\w]+/, '').trim();
  }
  if(items.length >= 3){
    const letters = items.map(it => {
      const t = String(it.text || '').replace(NUM_PREFIX, '');
      const lead = /^\s*\(?([a-jA-J])(?:\s*[.):–—-]|\s+\()/.exec(t);
      if(lead) return lead[1];
      const tags = t.match(/(?:^|\s)\(?[a-jA-J](?:[.)](?=\s|$)|(?=\s+\())/g);
      return tags && tags.length === 1 ? tags[0].replace(/[^a-jA-J]/g, '') : null;
    });
    if(letters.every(Boolean)) return letters.map((l, i) => (i + 1) + l.toLowerCase()).join(' ');
  }
  return null;
}
function commitWholeSet(book, stats, q, a, rule, kind){
  const qBlocks = book.chapters[q.chapterIdx].blocks, aBlocks = book.chapters[a.chapterIdx].blocks;
  const qBody = groupBody(book, q), aBody = groupBody(book, a);
  // The reader asks once the item's block has been read, so point it at the
  // exercise's LAST readable block: by then every line and option is read.
  let anchor = -1;
  for(let k = qBody.length - 1; k >= 0; k--){
    const b = qBlocks[qBody[k]];
    if(b.segs && b.segs.length){ anchor = qBody[k]; break; }
  }
  if(anchor < 0) return false;
  const entry = { n: 1, whole: true, block: anchor, from: 0, to: qBlocks[anchor].segs.length - 1,
                  q: qBody.map(bi => blockPlain(qBlocks[bi])).filter(Boolean).join(' ') };
  const qHtml = qBody.map(bi => setBlockHtml(qBlocks[bi])).join('');
  if(qHtml) entry.qHtml = qHtml;
  const aText = aBody.map(bi => blockPlain(aBlocks[bi])).filter(Boolean).join(' ');
  const aHtml = aBody.map(bi => setBlockHtml(aBlocks[bi])).join('');
  if(aText && aHtml){
    const aSegs = [];
    aBody.forEach(bi => (aBlocks[bi].segs || []).forEach(sg => {
      if(sg.text && sg.text.trim()) aSegs.push({ lang: sg.lang, text: sg.text });
    }));
    entry.a = aText; entry.aHtml = aHtml; entry.aSegs = aSegs;
    const key = (kind === 'match' || kind === 'order')
      ? answerKeyOf(aBody.map(bi => blockPlain(aBlocks[bi])), a.items) : null;
    if(key) entry.aCmp = key;
    stats.answered++;
  }
  const set = { title: q.title, match: rule, whole: kind, source: a.title, sourceCh: a.chapterIdx, items: [entry] };
  if(q.items.length) set.lines = q.items.length;           // for the report: how many lines it replaces
  const ch = book.chapters[q.chapterIdx];
  (ch.exercises || (ch.exercises = [])).push(set);
  stats.items++;
  stats.sets++;
  stats.whole = (stats.whole || 0) + 1;
  stats.byRule[rule] = (stats.byRule[rule] || 0) + 1;
  q._matched = true;
  return true;
}

function answerPayload(text){
  const segs = LE.segmentLine(String(text || '').replace(/\s+/g,' ').trim(), null);
  // Exercise answers get the same treatment for SPEECH only: in the
  // pronunciation book the printed answer to "la musique → ___" IS the
  // respelling, and reading it out is noise. It still has to be SHOWN,
  // though — silencing it out of existence turned 20 real answers into "this
  // book doesn't print an answer for this one", which is simply false.
  return {
    html: segs.map(s => s.html).join('') || escapeHtml(String(text || '')),
    text: segs.map(s => s.text).filter(Boolean).join(' '),
    segs: segs.map(s => ({ lang: s.lang, text: speechClean(s.text) }))
              .filter(s => s.text && s.text.trim())
  };
}

// Pair one question group's items against one answer group's items, and if
// that succeeds, record the set on its chapter and fold the counts into
// stats. Shared by the deterministic rules and the AI fallback below, so
// BOTH paths are held to the same "a length mismatch means no answer" bar —
// picking the right group is necessary but not sufficient.
function commitPair(book, stats, q, a, rule){
  a._used = true;
  const kind = setKind(book, q, a, rule);
  if(kind === 'skip') return false;
  if(kind) return commitWholeSet(book, stats, q, a, rule, kind);
  const aItems = a.items;
  const bothNumbered = q.items.every(i => NUM_PREFIX.test(i.text)) &&
                       aItems.every(i => NUM_PREFIX.test(i.text));
  let lookup;
  if(bothNumbered){
    const m = new Map();
    aItems.forEach(i => { if(!m.has(i.num)) m.set(i.num, i); });
    const covered = q.items.filter(i => m.has(i.num)).length;
    if(covered < Math.ceil(q.items.length / 2)) return false;
    lookup = it => m.get(it.num);
  } else {
    if(aItems.length !== q.items.length) return false;
    lookup = (it, ix) => aItems[ix];
  }

  const set = { title: q.title, match: rule,
                source: a.title, sourceCh: a.chapterIdx, items: [] };
  q.items.forEach((it, ix) => {
    const entry = { n: it.num, block: it.blockIdx, from: it.segFrom, to: it.segTo,
                    q: speechText(it.text) };
    const ans = lookup(it, ix);
    if(ans && ans.text){
      const pay = answerPayload(ans.text.replace(NUM_PREFIX, ''));
      if(pay.text){ entry.a = pay.text; entry.aHtml = pay.html; entry.aSegs = pay.segs; stats.answered++; }
    }
    set.items.push(entry);
    stats.items++;
  });
  stats.byRule[rule] = (stats.byRule[rule] || 0) + 1;
  const ch = book.chapters[q.chapterIdx];
  (ch.exercises || (ch.exercises = [])).push(set);
  stats.sets++;
  q._matched = true;
  return true;
}

/* ---------------------------------------------------------------------------
 * NUMBERED "Question N" / "Answer N" LAYOUT  (Le journal de Maya)
 * ---------------------------------------------------------------------------
 * These books do not print questions as list items. Each question is a
 * paragraph opening "Question 7", followed by paragraphs holding its prompt or
 * its A) B) C) options; each answer is a paragraph opening "Answer 7",
 * followed by "Why:", "Bonus:" and quotation paragraphs. Numbers run straight
 * through an h1 part (Exercice 1 takes 1-4, Exercice 2 takes 5-8 ...), and the
 * answers sit together in that part's "Réponses" chapter. Nothing in the
 * generic rules can see this shape, so it is paired here, on the number alone.
 *
 * It follows the same rule as the rest of the exercise code: an explicit key,
 * and ambiguity is failure. A part is paired only if
 *   - its question numbers are unique, and so are its answer numbers,
 *   - the two sets of numbers are IDENTICAL, and
 *   - every answer comes after the question it answers.
 * Anything short of that leaves the part alone, exactly as before, so a book
 * that merely happens to print "Question 3" somewhere cannot be mis-paired.
 *
 * What counts as the answer: EVERYTHING from the "Answer N" paragraph up to the
 * next "Answer N" (or the end of the chapter) — the answer line, the "Why:"
 * explanation, the quoted French, the "Bonus:" notes, "Check your answer"
 * lists. That is the whole entry in the book, and the reader shows and reads
 * all of it. It ships as block-structured HTML (one <div class="exBlk"> per
 * source paragraph, bold/italic/lists intact) so the panel looks like the
 * page; the question is shipped the same way as qHtml. The "Question N" /
 * "Answer N" labels themselves are dropped — the panel already numbers them.
 */
const QA_QUESTION = /^Question\s*(\d+)\b\s*([\s\S]*)$/;
const QA_ANSWER   = /^Answer\s*(\d+)\b\s*([\s\S]*)$/;
// The label at the very start of a block's HTML (inside its first ttsSeg span).
const QA_LABEL_HTML = /^(<span class="ttsSeg"[^>]*>)\s*(?:Question|Answer)(?:\s|&nbsp;|&#160;)*\d+(?:\s|&nbsp;|&#160;)*/;

// One source paragraph -> one panel line. data-seg is dropped (the panel has no
// use for it); the ttsSeg/data-lang spans stay so the French tint applies here
// exactly as it does on the page.
function qaBlockHtml(bl, dropLabel, firstLang){
  let h = String(bl.html || '').replace(/ data-seg="\d+"/g, '');
  if(dropLabel){
    h = h.replace(QA_LABEL_HTML, '$1');
    h = h.replace(/^<span class="ttsSeg"[^>]*><\/span>/, '');      // label was a segment of its own
    h = h.replace(/^(<span[^>]*>)\s+/, '$1');
    // The label ("Answer 4") is English, so a segment it was merged into was
    // tagged English even when what is left is French. Re-tag that first span
    // from the label-free text so the on-screen tint matches what is spoken.
    if(firstLang) h = h.replace(/^(<span class="ttsSeg" data-lang=")(?:fr|en)(")/, '$1' + firstLang + '$2');
  }
  return h.trim() ? '<div class="exBlk">' + h + '</div>' : '';
}
function qaPlain(bl){
  return (bl._lines || []).map(l => String(l.raw || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
}

function attachNumberedQA(book, stats){
  const rawOf = bl => (bl && bl.type === 'p' && bl._lines && bl._lines[0])
    ? String(bl._lines[0].raw || '').replace(/\s+/g, ' ').trim() : '';

  const parts = new Map();
  book.chapters.forEach((c, i) => {
    if(!parts.has(c.h1)) parts.set(c.h1, []);
    parts.get(c.h1).push(i);
  });

  for(const idxs of parts.values()){
    const qs = [], as = [];
    for(const ci of idxs){
      let cur = null;
      book.chapters[ci].blocks.forEach((bl, bi) => {
        const raw = rawOf(bl);
        const mq = QA_QUESTION.exec(raw);
        const ma = mq ? null : QA_ANSWER.exec(raw);
        if(mq){ cur = { num: parseInt(mq[1], 10), ci: ci, bi: bi, body: mq[2].trim(), blocks: [bi] }; qs.push(cur); }
        else if(ma){ cur = { num: parseInt(ma[1], 10), ci: ci, bi: bi, body: ma[2].trim(), blocks: [bi] }; as.push(cur); }
        else if(bl.type === 'heading'){ cur = null; }
        else if(cur){ cur.blocks.push(bi); }
      });
    }
    if(!qs.length || qs.length !== as.length) continue;
    if(new Set(qs.map(x => x.num)).size !== qs.length) continue;
    if(new Set(as.map(x => x.num)).size !== as.length) continue;
    const aBy = new Map(as.map(a => [a.num, a]));
    if(!qs.every(q => aBy.has(q.num))) continue;
    const follows = (a, q) => a.ci > q.ci || (a.ci === q.ci && a.bi > q.bi);
    if(!qs.every(q => follows(aBy.get(q.num), q))) continue;

    // The part passed. Build one set per question chapter.
    const sets = new Map();
    for(const q of qs){
      const qBlocks = book.chapters[q.ci].blocks;
      // The reader stops for input after the block it is pointed at, so point
      // it at the LAST readable block of the question: by then the prompt or
      // every option has been read out.
      let tb = -1;
      for(let k = q.blocks.length - 1; k >= 0; k--){
        const b = qBlocks[q.blocks[k]];
        if(b.segs && b.segs.length){ tb = q.blocks[k]; break; }
      }
      if(tb < 0) continue;                              // nothing speakable

      const a = aBy.get(q.num);
      const aBlocks = book.chapters[a.ci].blocks;

      // ---- question: plain text for the report/fallback, HTML for the panel
      const qText = [q.body].concat(q.blocks.slice(1).map(bi => qaPlain(qBlocks[bi])))
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const entry = { n: q.num, block: tb, from: 0, to: qBlocks[tb].segs.length - 1, q: qText };
      const qFirst = q.body ? answerPayload(q.body).segs[0] : null;
      const qHtml = q.blocks.map((bi, k) => qaBlockHtml(qBlocks[bi], k === 0, qFirst && qFirst.lang)).join('');
      if(qHtml) entry.qHtml = qHtml;

      // ---- answer: the whole extent, up to the next "Answer N"
      // Speech: the "Answer N ..." line is re-segmented WITHOUT its label (the
      // label is tagged English and would be read as "Answer four" in the
      // English voice); every later paragraph already carries the page's own
      // language-tagged segments, so those are reused as they are.
      const first = a.body ? answerPayload(a.body) : null;
      const aSegs = first ? first.segs.slice() : [];
      const aPlain = a.body ? [first.text || a.body] : [];
      let aHtml = '';
      a.blocks.forEach((bi, k) => {
        const bl = aBlocks[bi];
        aHtml += qaBlockHtml(bl, k === 0, first && first.segs[0] && first.segs[0].lang);
        if(k > 0){
          (bl.segs || []).forEach(sg => { if(sg.text && sg.text.trim()) aSegs.push({ lang: sg.lang, text: sg.text }); });
          const t = qaPlain(bl);
          if(t) aPlain.push(t);
        }
      });
      const aText = aPlain.join(' ').replace(/\s+/g, ' ').trim();
      if(aText && aHtml){
        entry.a = aText; entry.aHtml = aHtml; entry.aSegs = aSegs;
        // The reader's "identical to the book's answer" note compares against
        // this, not the full explanation, which nobody would type out.
        if(first && first.text) entry.aCmp = first.text;
        stats.answered++;
      }
      if(!sets.has(q.ci)){
        sets.set(q.ci, { title: book.chapters[q.ci].title, match: 'key',
                         source: book.chapters[a.ci].title, sourceCh: a.ci, items: [] });
      }
      sets.get(q.ci).items.push(entry);
      stats.items++;
    }
    for(const [ci, set] of sets){
      if(!set.items.length) continue;
      (book.chapters[ci].exercises || (book.chapters[ci].exercises = [])).push(set);
      stats.sets++;
      stats.byRule.key = (stats.byRule.key || 0) + 1;
    }
    // Mark every chapter that held a question or an answer as handled.
    new Set(qs.concat(as).map(x => x.ci)).forEach(ci => { book.chapters[ci]._qaPaired = true; });
  }
}

async function attachExercises(book, opts){
  opts = opts || {};
  const stats = { sets:0, items:0, answered:0, unmatched:0, byRule:{} };
  attachNumberedQA(book, stats);
  const groups = collectGroups(book);
  const answers = groups.filter(g => g.isAnswer && g.items.length);
  // WHOLE-SET exercises (see setKind) may have no items at all on one side: a
  // dialogue with its blanks inside the paragraphs, "find the five errors in
  // this text", a key printed as a sentence ("C, E, A, D, B.") or as labelled
  // lines ("Positif : généreux, honnête…"). Such groups join the pools, but
  // only an EXPLICIT key — identical title, letter + subject words, ordinal —
  // may pair them, never the count-based guesses, and an item-less question
  // must be an exercise in its own right.
  const bare = new Set(groups.filter(g => !g.items.length && groupBody(book, g).length));
  const pool = answers.concat(groups.filter(g => g.isAnswer && bare.has(g)));
  if(!pool.length) return stats;
  // With --ai-pairing / --export-unmatched, hand the model (or the worksheet)
  // every non-answer group that has items, not just the ones EX_HEADING
  // recognised — a human decides an exercise by where it sits in the
  // chapter, not by whether its own heading happens to contain the word
  // "exercice". BUT that widening is scoped to h1s that actually contain an
  // answer-key group somewhere. An h1 with NO answer groups at all (a front-
  // matter "Introduction", say) has nothing to pair against regardless — its
  // ordinary prose sections aren't exercises that got missed, they're just
  // not exercises, and reporting a dozen of them as "unmatched questions"
  // per book is noise a person then has to see through, not a real gap.
  const h1sWithAnswers = new Set(answers.map(a => book.chapters[a.chapterIdx].h1));
  // Widening isn't just for the AI stage — it's what lets a strict rule (exact
  // title, or letter + shared section-name words) even SEE a group like
  // "A. Vrai ou faux ?" whose own heading and immediate parent never contain
  // an "exercice" trigger word. Rules 1-3 only commit on a specific positive
  // match (identical title; same letter AND overlapping section words; same
  // ordinal), so a bigger candidate pool doesn't make them more likely to
  // guess — it just gives them something to check in the first place. Rule 4
  // (the one actual guess — nearest unclaimed neighbor) stays restricted to
  // g.isExercise regardless, so widening never reaches it.
  const questions = groups.filter(g => !g.isAnswer && (g.items.length ?
    (g.isExercise ||
     h1sWithAnswers.has(book.chapters[g.chapterIdx].h1) ||
     answers.some(a => a.norm && a.norm === g.norm))
    : g.isExercise && bare.has(g)));
  // Exact-title twins belong to each other. A question whose heading repeats
  // an answer heading (or the reverse) is never handed to anyone else by the
  // count-based rules, even when its twin has nothing they could pair item by
  // item. Without this, TEF's "6. Remets dans l'ordre", whose key is a
  // sentence, took the five answers of "7. Jeu de rôle" because the counts
  // agreed, and the "Son et écoute" pronunciation lists took the answers of
  // "6. Écoute active" through the shared word "écoute" — wrong answers in
  // one place, none in the other.
  // (Same length floor as Rule 1: a bare "A." is not a title.)
  const twinKey = g => book.chapters[g.chapterIdx].h1 + '\u0001' + g.norm;
  const titled = g => g.norm && g.norm.length > 3;
  const qTwins = new Set(groups.filter(g => !g.isAnswer && titled(g)).map(twinKey));
  const aTwins = new Set(groups.filter(g => g.isAnswer && titled(g)).map(twinKey));

  const leftover = [];
  for(const q of questions){
    const candidates = [];
    const qBare = !q.items.length;
    const qReserved = titled(q) && aTwins.has(twinKey(q));
    for(const a of pool){
      if(a.chapterIdx < q.chapterIdx) continue;          // answers follow questions
      // Every rule is scoped to the enclosing h1. Without this, an exercise
      // whose own answer key is missing reached hundreds of chapters forward
      // and took a later chapter's — three different "B. Vocabulaire passif"
      // exercises all pulled from one key 400 chapters away. Same-part scoping
      // is what the Markdown builder does, for the same reason.
      if(book.chapters[a.chapterIdx].h1 !== book.chapters[q.chapterIdx].h1) continue;
      // An answer group answers ONE exercise. Without this, a weaker rule
      // could re-take a group a stronger one had already claimed: a
      // "B. Vocabulaire passif" exercise matched by letter onto the answers
      // for "B. Complétez les phrases", which the title rule had correctly
      // given to the exercise those answers actually belong to. Questions are
      // visited in reading order, so the earliest claimant is the nearest one.
      if(a._used) continue;
      // Rule 1 — the answer heading repeats the question heading verbatim.
      if(q.norm && a.norm === q.norm && q.norm.length > 3){
        candidates.push({ a:a, rule:'title', dist: a.chapterIdx - q.chapterIdx }); continue;
      }
      // Rule 2 — same letter, and the surrounding section names agree.
      if(q.letter && a.letter === q.letter){
        const score = overlapCount(q.info, a.info);
        if(score > 0){
          candidates.push({ a:a, rule:'letter', score:score, dist: a.chapterIdx - q.chapterIdx }); continue;
        }
        // An answer heading that is nothing but a label ("Exercise A") has no
        // subject words to overlap on. Same letter, same section and the same
        // number of items is then all the evidence there can be — and there is
        // nothing in the heading that could contradict it.
        if(a.info.size === 0 && a.items.length && a.items.length === q.items.length){
          candidates.push({ a:a, rule:'letter', score:0, dist: a.chapterIdx - q.chapterIdx }); continue;
        }
      }
      // Rule 3 — an explicit ordinal on both sides.
      if(q.ord && a.ord === q.ord){
        candidates.push({ a:a, rule:'ordinal', dist: a.chapterIdx - q.chapterIdx }); continue;
      }
      // Everything below decides on item counts, so it needs items on both
      // sides, and it never touches a group whose exact-title twin exists.
      if(qBare || !a.items.length) continue;
      if(qReserved || qTwins.has(twinKey(a))) continue;
      // Rule 2b — neither side carries a letter at all ("Entraînement
      // (Practice)" -> "Grammaire : entraînement", "Production orale" ->
      // "Production orale : exemples de réponses"), so there is no letter to
      // match on. The substitute evidence: real subject words shared (not
      // just "auto-évaluation"/"corrigé"), AND the exact same item count —
      // together not something two unrelated groups get by coincidence, and
      // still subject to the same top-score-only, no-ambiguity filtering as
      // the letter rule below.
      if(!q.letter && !q.ord && !a.letter && !a.ord && a.items.length === q.items.length){
        const score = overlapCount(topicWordsApart(q, a), topicWordsApart(a, q));
        if(score > 0){
          candidates.push({ a:a, rule:'topic', score:score, dist: a.chapterIdx - q.chapterIdx }); continue;
        }
      }
      // Rule 4 — no key at all: the next answer group with no key of its own
      // and the same number of items.
      if(!q.letter && !q.ord && !a.letter && !a.ord && q.isExercise &&
         a.items.length === q.items.length){
        candidates.push({ a:a, rule:'adjacent', dist: a.chapterIdx - q.chapterIdx }); continue;
      }
    }

    let pick = null;
    for(const rule of ['title','letter','topic','ordinal','adjacent']){
      let c = candidates.filter(x => x.rule === rule);
      if(!c.length) continue;
      if(rule === 'letter' || rule === 'topic'){
        // Several answers can share a letter; the one whose heading actually
        // shares the most subject words with this question is the match, not
        // whichever happens to sit nearest.
        const best = Math.max(...c.map(x => x.score));
        c = c.filter(x => x.score === best);
      }
      c.sort((x,y) => x.dist - y.dist);
      // Ambiguity is failure for the keyed rules: several equally good
      // candidates means the key identified nothing. For the un-keyed rule the
      // nearest following group is the intended one, and it must not already
      // have been claimed by an earlier exercise.
      if(rule === 'adjacent'){
        pick = c[0];
      } else if(c.length === 1 || c[0].dist < c[1].dist){
        pick = c[0];
      }
      if(pick) break;
    }
    if(!pick){ leftover.push(q); continue; }
    if(!commitPair(book, stats, q, pick.a, pick.rule)) leftover.push(q);
  }

  // ---- Rule 5: one combined answer key numbered across several exercises ----
  // Some books print a single "Answer key" for the whole chapter whose items
  // are numbered 1..N straight through, and number the chapter's lettered
  // exercises the same way (A has 1-3, B has 4, C has 5-6 ...). No single
  // exercise matches that key by heading, but together they cover it exactly.
  // Accepted only when the numbers those exercises carry are each used once
  // and add up to precisely the key's 1..N — a coincidence can't do that.
  {
    const genericKey = /^(answer\s*keys?|answers?|corrig[ée]s?|r[ée]ponses?)\b/i;
    const lettered = /^(?:[A-J]\s*[.)]\s|(?:exercises?|exercices?)\s+[A-J]\b)/i;
    for(const a of answers){
      if(a._used || a.items.length < 2) continue;
      if(!genericKey.test(headingCue(a.title).trim())) continue;
      if(!a.items.every(i => NUM_PREFIX.test(i.text))) continue;
      const N = a.items.length, h1 = book.chapters[a.chapterIdx].h1;
      const ansNums = new Set(a.items.map(i => i.num));
      const cands = leftover.filter(q => !q._matched &&
          book.chapters[q.chapterIdx].h1 === h1 && q.chapterIdx <= a.chapterIdx &&
          lettered.test(q.title.trim()) && q.items.every(i => NUM_PREFIX.test(i.text)))
        .sort((x,y) => x.chapterIdx - y.chapterIdx || x.blockFrom - y.blockFrom);
      const seen = new Set(), take = [];
      for(const q of cands){
        const qn = q.items.map(i => i.num);
        if(qn.some(n => seen.has(n) || !ansNums.has(n))) continue;
        qn.forEach(n => seen.add(n)); take.push(q);
      }
      if(seen.size !== N) continue;
      for(const q of take) commitPair(book, stats, q, a, 'key');
    }
  }

  // ---- AI fallback: only what rules 1-4 refused, still scoped to one h1 ----
  // Two ways to get an AI opinion: a live API call (opts.aiPairing), or a
  // pairing file computed ahead of time — by hand, or by pasting the leftover
  // groups to Claude in a normal chat and saving its answer — and passed in
  // via opts.aiPairingMap. The map path makes zero network calls, so it costs
  // nothing beyond however the mapping itself was produced; that's the whole
  // point of supporting it, for a one-book-at-a-time workflow that avoids API
  // billing entirely. Either way the result lands through the exact same
  // commitPair() item-alignment check below.
  if((opts.aiPairing || opts.aiPairingMap || opts.collectLeftover) && leftover.length){
    const byH1 = new Map();
    leftover.filter(q => !q._matched).forEach(q => {
      const h1 = book.chapters[q.chapterIdx].h1;
      (byH1.get(h1) || byH1.set(h1, []).get(h1)).push(q);
    });
    for(const [h1, qs] of byH1){
      const candidateAnswers = answers.filter(a =>
        !a._used && book.chapters[a.chapterIdx].h1 === h1 &&
        a.chapterIdx >= Math.min(...qs.map(q => q.chapterIdx)));
      // --export-unmatched: write the worksheet regardless of whether there
      // happen to be any candidate answers in this h1 — an h1 with leftover
      // questions but NO candidate answers is itself useful for a human (or
      // Claude, reading it back) to see: it means this section's answer key
      // is missing entirely, not just mismatched.
      if(opts.collectLeftover){
        opts.collectLeftover.push({
          book: book.title, h1: book.chapters[h1].title,
          questions: qs.map(q => exportCard(q, groupKey(q))),
          answers: candidateAnswers.map(a => exportCard(a, groupKey(a)))
        });
      }
      if(!candidateAnswers.length || !(opts.aiPairing || opts.aiPairingMap)) continue;
      let picks, rule;
      if(opts.aiPairingMap){
        rule = 'ai-file';
        picks = pairFromMap(qs, candidateAnswers, opts.aiPairingMap);
      } else {
        rule = 'ai';
        try{ picks = await aiPairGroups(qs, candidateAnswers, opts); }
        catch(err){ console.error('  [ai-pairing] '+book.title+' h1#'+h1+': '+err.message); continue; }
      }
      for(const p of picks){
        const q = qs[p.qi], a = p.ai == null ? null : candidateAnswers[p.ai];
        if(p.why === '(not in pairing file)') continue;   // nothing was decided about it; don't clutter the report
        if(opts.aiLog) opts.aiLog.push({
          book: book.title, question: q.title, ancestry: q.ancestry.join(' > '),
          answer: a ? a.title : null, confidence: p.confidence, why: p.why || '',
          accepted: false // filled in below
        });
        const logEntry = opts.aiLog && opts.aiLog[opts.aiLog.length - 1];
        if(!a || p.confidence !== 'high') continue;
        if(a._used) continue;                 // model tried to reuse a claimed group
        const ok = commitPair(book, stats, q, a, rule);
        if(logEntry) logEntry.accepted = ok;
      }
    }
    leftover.forEach(q => { if(!q._matched) stats.unmatched += q.items.length; });
  } else {
    leftover.forEach(q => { if(!q._matched) stats.unmatched += q.items.length; });
  }

  book.chapters.forEach(ch => {
    if(ch.exercises) ch.exercises.sort((x,y) =>
      (x.items[0] ? x.items[0].block : 0) - (y.items[0] ? y.items[0].block : 0));
  });
  return stats;
}

// A group's identity for the offline pairing file: its own heading plus the
// headings it sits under. Titles alone can repeat across an h1 ("A." shows up
// in several sections), so ancestry disambiguates the same way it does for
// the scoping rule above — this key only ever has to be unique WITHIN one h1,
// since that's the only scope pairFromMap is ever called with.
function groupKey(g){ return g.ancestry.join(' > ') + ' :: ' + g.title; }

// The offline counterpart to aiPairGroups: no network call, just a lookup
// against a map built from a JSON file the person supplies (see
// --ai-pairing-file). Same output shape — {qi, ai, confidence, why} indices
// into THIS call's qs/candidateAnswers — so it drops into the exact same
// commit path as a live API pick, including the "high confidence only, one
// answer per question" rule.
function pairFromMap(qs, candidateAnswers, map){
  const aByTitle = new Map();
  candidateAnswers.forEach((a,i) => { if(!aByTitle.has(a.title)) aByTitle.set(a.title, i); });
  const claimed = new Set();
  return qs.map((q, qi) => {
    const row = map.get(groupKey(q));
    if(!row) return { qi, ai:null, confidence:'low', why:'(not in pairing file)' };
    let ai = null;
    if(row.a != null && aByTitle.has(row.a) && !claimed.has(row.a)){
      ai = aByTitle.get(row.a); claimed.add(row.a);
    }
    return { qi, ai, confidence: row.confidence || 'high', why: row.why || '' };
  });
}

// Truncate an item's text for the prompt: the model needs enough to judge a
// match, not the whole exercise, and these calls are billed per token.
function snippet(t, n){ t = String(t||'').replace(/\s+/g,' ').trim(); return t.length > n ? t.slice(0,n)+'…' : t; }

function groupCard(g, id){
  return { id: id, title: g.title, under: g.ancestry.join(' > '),
           items: g.items.slice(0,4).map(it => snippet(it.text, 140)),
           itemCount: g.items.length };
}

// The --export-unmatched counterpart to groupCard, used ONLY for the
// worksheet file, never for a live API prompt. A live call is billed per
// token, so groupCard stays deliberately thin (4 items, 140 chars). The
// worksheet costs nothing extra to make richer, and a human or Claude reading
// it in a normal chat benefits from seeing every item, not a sample — the
// count alone isn't always enough to judge a match by (see: "Vocabulaire A"
// printing 8 answers as one line, which only shows up if you can see the
// whole item, not just the first 140 characters of it).
function exportCard(g, id){
  return { id: id, title: g.title, under: g.ancestry.join(' > '),
           items: g.items.map(it => snippet(it.text, 500)),
           itemCount: g.items.length };
}

// One Claude API call per h1, matching a handful of still-unpaired question
// groups against a handful of still-unclaimed answer groups from the SAME
// h1. The model is told explicitly to return null over a guess: an
// exercise mode that shows a confidently wrong answer is worse than one that
// says the book prints none, so a "low"-confidence or missing pairing here
// is treated exactly like a rule that found no candidate at all.
async function aiPairGroups(questionGroups, answerGroups, opts){
  const qCards = questionGroups.map((q,i) => groupCard(q, 'q'+i));
  const aCards = answerGroups.map((a,i) => groupCard(a, 'a'+i));
  const prompt = [
    'You are matching exercise QUESTIONS to their ANSWER KEY in a French-learning',
    'textbook chapter. Each item below is one heading-delimited group from the',
    'chapter, given as its heading, the headings it sits under, and a few of its',
    'items (question text, or answer text, truncated).',
    '',
    'QUESTIONS:',
    JSON.stringify(qCards, null, 1),
    '',
    'CANDIDATE ANSWER GROUPS (from the same chapter\'s answer key):',
    JSON.stringify(aCards, null, 1),
    '',
    'For each question id, decide which answer id (if any) holds the worked',
    'answers for THAT SPECIFIC question group. Match on meaning: topic, item',
    'content, and position in the answer key\'s own structure, not on exact',
    'wording. Some questions genuinely have no printed answer in this chapter',
    '(e.g. open-ended speaking or writing prompts) — for those, or whenever you',
    'are not clearly sure, return null and "confidence":"low" rather than guess.',
    'Each answer id may be used for at most one question.',
    '',
    'Respond with ONLY a JSON array, no prose, no code fences, one entry per',
    'question, in this exact shape:',
    '[{"q":"q0","a":"a2","confidence":"high","why":"one short phrase"}, ...]',
    'confidence is "high" or "low". a is an answer id or null.'
  ].join('\n');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: opts.aiModel || 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role:'user', content: prompt }]
    })
  });
  if(!resp.ok) throw new Error('API HTTP '+resp.status+': '+(await resp.text()).slice(0,300));
  const data = await resp.json();
  if(opts.aiUsage && data.usage){
    opts.aiUsage.calls++;
    opts.aiUsage.inputTokens  += data.usage.input_tokens  || 0;
    opts.aiUsage.outputTokens += data.usage.output_tokens || 0;
  }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = text.replace(/^```json\s*|\s*```$/g,'').trim();
  let parsed;
  try{ parsed = JSON.parse(clean); }
  catch(e){ throw new Error('could not parse model output as JSON: '+clean.slice(0,200)); }
  if(!Array.isArray(parsed)) throw new Error('model output was not a JSON array');

  const qIndex = new Map(qCards.map((c,i) => [c.id, i]));
  const aIndex = new Map(aCards.map((c,i) => [c.id, i]));
  const claimed = new Set();
  const out = [];
  for(const row of parsed){
    if(!row || !qIndex.has(row.q)) continue;               // ignore malformed rows
    const qi = qIndex.get(row.q);
    let ai = null;
    if(row.a != null){
      if(!aIndex.has(row.a) || claimed.has(row.a)) { ai = null; }
      else { ai = aIndex.get(row.a); claimed.add(row.a); }
    }
    out.push({ qi, ai, confidence: row.confidence, why: row.why });
  }
  return out;
}

function stripBuildScaffolding(book){
  for(const ch of book.chapters){
    for(const bl of ch.blocks){ delete bl._lines; delete bl._rows; delete bl._header; delete bl.chapterTitle; delete bl._start; }
    delete ch._qaPaired;
    delete ch._headBox;
  }
}

module.exports.attachExercises = attachExercises;
module.exports.collectGroups = collectGroups;
module.exports.stripBuildScaffolding = stripBuildScaffolding;

// ============================== driver ==============================

if(require.main === module){
  if(!fs.existsSync(SRC)){ console.error('Source folder not found: '+SRC); process.exit(1); }
  const files = fs.readdirSync(SRC).filter(f => /\.x?html?$/i.test(f));
  if(!files.length){ console.error('No .xhtml files in '+SRC); process.exit(1); }

  const aiLog = [];      // filled in only when --ai-pairing is on
  const aiUsage = { calls:0, inputTokens:0, outputTokens:0 };
  const leftoverExport = [];   // filled in only when --export-unmatched is on

  function writeReports(books){
    const lines = [];
    books.forEach(b => {
      lines.push('='.repeat(78));
      lines.push('BOOK: '+b.title+'   ['+b.id+']   <- '+b.source);
      lines.push('='.repeat(78));
      b.chapters.forEach((c,ci) => {
        lines.push('');
        lines.push('--- CHAPTER '+(ci+1)+' (h'+c.level+'): '+c.title);
        c.blocks.forEach((bl,bi) => {
          lines.push('  [block '+(bi+1)+'] '+bl.type+(bl.level?(' h'+bl.level):'')+(bl.box?(' .'+bl.box):'')+(bl.quote?' (quote)':''));
          bl.segs.forEach((s,si) => lines.push('    '+String(si).padStart(3)+'  '+s.lang.toUpperCase()+'  '+s.text));
        });
      });
    });
    fs.writeFileSync(path.join(DATA,'segments-report.txt'), lines.join('\n'), 'utf8');

    const ex = [];
    books.forEach(b => {
      if(!b.chapters.some(c => c.exercises)) return;
      ex.push('='.repeat(78));
      ex.push('BOOK: '+b.title+'   <- '+b.source);
      ex.push('='.repeat(78));
      b.chapters.forEach((c,ci) => {
        if(!c.exercises) return;
        ex.push('');
        ex.push('--- CHAPTER '+(ci+1)+': '+c.title);
        c.exercises.forEach(set => {
          ex.push('  SET: '+set.title);
          ex.push('       matched by: '+set.match+'   from answer group: '+(set.source||'?')
            +'  [chapter '+(set.sourceCh+1)+']');
          if(set.whole){
            // One question for the whole exercise (see setKind).
            ex.push('       asked as ONE whole set ('+set.whole+')'
              +(set.lines ? ' instead of '+set.lines+' separate lines' : ''));
            set.items.forEach(it => {
              ex.push('    WHOLE  '+it.q);
              ex.push('      A    '+(it.a !== undefined ? it.a : '*** NO ANSWER FOUND ***'));
              if(it.aCmp) ex.push('      KEY  '+it.aCmp);
            });
            return;
          }
          set.items.forEach(it => {
            ex.push('    Q'+it.n+'  '+it.q);
            ex.push('      A   '+(it.a !== undefined ? it.a : '*** NO ANSWER FOUND ***'));
          });
        });
      });
    });
    fs.writeFileSync(path.join(DATA,'exercises-report.txt'), ex.join('\n'), 'utf8');

    // Every pairing the model proposed, accepted or not — so a wrong "high"
    // confidence pick, or a plausible "low" one it correctly declined, can
    // both be checked by a human rather than just trusted.
    if(aiLog.length){
      const price = AI_PRICING[AI_MODEL];
      const cost = price ? (aiUsage.inputTokens/1e6)*price.in + (aiUsage.outputTokens/1e6)*price.out : null;
      const header = 'AI pairing usage: '+aiUsage.calls+' call(s), '+aiUsage.inputTokens+' input / '
        +aiUsage.outputTokens+' output tokens'
        + (cost !== null ? '  \u2248 $'+cost.toFixed(4)+' at '+AI_MODEL+' rates (verify current pricing)' : '')
        + '\n' + '='.repeat(78) + '\n';
      const al = aiLog.map(r =>
        (r.accepted ? '  ACCEPTED' : '  skipped ') +
        '  ['+r.confidence+']  '+r.book+' :: '+r.ancestry+' > '+r.question+
        '\n           -> '+(r.answer || '(no match)')+
        (r.why ? '   ('+r.why+')' : ''));
      fs.writeFileSync(path.join(DATA,'ai-pairing-report.txt'), header + al.join('\n\n'), 'utf8');
    }
  }

  (async () => {
    const books = [];
    for(const f of files){
      const b = extractBook(path.join(SRC, f));
      b.exStats = await attachExercises(b, { aiPairing: WANT_AI_PAIRING, aiModel: AI_MODEL, aiLog: aiLog, aiUsage: aiUsage, aiPairingMap: AI_PAIRING_MAP, collectLeftover: EXPORT_UNMATCHED ? leftoverExport : null });
      stripBuildScaffolding(b);
      books.push(b);
    }
    books.sort((a,b) => a.title.localeCompare(b.title));

    const usedIds = [];
    books.forEach(b => {
      let base = b.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'book';
      let id = base, n = 2;
      while(usedIds.includes(id)) id = base + '-' + (n++);
      usedIds.push(id); b.id = id;
    });

    const passphrase = (await getPassphrase()).trim();
    if(!passphrase){ console.error('No passphrase provided (set BOOK_PASSPHRASE or type one). Aborting.'); process.exit(1); }
    // Key-derivation settings, in priority order:
    //   1. --reuse-salt-from=PATH  (explicit override, loaded near the top)
    //   2. an existing <dataDir>/manifest.json  (automatic — read BEFORE the
    //      folder is wiped below, so the same passphrase keeps deriving the
    //      same key across rebuilds)
    //   3. a brand-new random salt
    // The passphrase is never stored. Each book still gets a fresh random
    // AES-GCM IV regardless.
    let cryptoConfig = null;
    if(REUSE_SALT){
      cryptoConfig = { alg:'AES-GCM', kdf:'PBKDF2', hash:'SHA-256', iter:REUSE_ITER, salt: REUSE_SALT.toString('base64') };
    } else {
      const oldManifestPath = path.join(DATA, 'manifest.json');
      if(fs.existsSync(oldManifestPath)){
        console.log('Existing manifest.json found \u2014 reusing its encryption settings.');
        try{
          const oldManifest = JSON.parse(fs.readFileSync(oldManifestPath, 'utf8'));
          if(!oldManifest.crypto || !oldManifest.crypto.salt){
            throw new Error('manifest.json does not contain valid crypto settings.');
          }
          cryptoConfig = oldManifest.crypto;
        }catch(err){
          console.error('Could not reuse existing manifest.json: ' + err.message);
          console.error('Fix or delete '+oldManifestPath+' (deleting it generates a NEW key that will not open previously built books).');
          process.exit(1);
        }
      } else {
        console.log('No existing manifest.json found \u2014 generating new encryption settings.');
        cryptoConfig = {
          alg:'AES-GCM', kdf:'PBKDF2', hash:'SHA-256', iter:PBKDF2_ITER,
          salt: crypto.randomBytes(16).toString('base64')
        };
      }
    }

    if(cryptoConfig.alg !== 'AES-GCM' || cryptoConfig.kdf !== 'PBKDF2' ||
       cryptoConfig.hash !== 'SHA-256' || !Number.isInteger(cryptoConfig.iter) ||
       cryptoConfig.iter <= 0 || typeof cryptoConfig.salt !== 'string'){
      console.error('Unsupported or invalid crypto settings in manifest.json.');
      process.exit(1);
    }
    const salt = Buffer.from(cryptoConfig.salt, 'base64');
    if(salt.length !== 16){
      console.error('Invalid encryption salt in manifest.json: expected 16 bytes.');
      process.exit(1);
    }
    const key = crypto.pbkdf2Sync(passphrase, salt, cryptoConfig.iter, 32, 'sha256');

    // Safe to rebuild now: the old crypto settings have been captured.
    fs.rmSync(DATA, { recursive:true, force:true });
    fs.mkdirSync(DATA, { recursive:true });

    const manifest = {
      crypto: cryptoConfig,
      ruby: true,
      books: books.map(b => {
        const rel = DATA_NAME + '/' + b.id + '.enc';
        fs.writeFileSync(path.join(OUT, rel),
          JSON.stringify(encryptJSON({ title:b.title, chapters:b.chapters }, key)));
        return {
          id: b.id, title: b.title, source: b.source, file: rel,
          // Level and owning-h1 index travel with each chapter so the reader
          // can drive its two dropdowns: h1s in the first, that h1 plus its
          // h2s and h3s in the second.
          chapters: b.chapters.map(c => ({ t: c.title, l: c.level, h: c.h1 }))
        };
      })
    };
    fs.writeFileSync(path.join(DATA,'manifest.json'), JSON.stringify(manifest));
    if(WANT_REPORT) writeReports(books);

    console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'manifest.json')+'  (block text encrypted)');
    books.forEach(b => {
      let blocks=0, segs=0, fr=0, ruby=0;
      b.chapters.forEach(c => c.blocks.forEach(bl => {
        blocks++; if(bl.html.indexOf('<ruby')>=0) ruby++;
        bl.segs.forEach(s => { segs++; if(s.lang==='fr') fr++; });
      }));
      const h1 = b.chapters.filter(c => c.level===1).length;
      console.log('  '+b.title);
      console.log('    ['+b.id+']  '+b.chapters.length+' chapters ('+h1+' h1), '+blocks+' blocks ('
        + ruby+' with ruby), '+segs+' segments \u2014 '+fr+' FR / '+(segs-fr)+' EN   <- '+b.source);
      const x = b.exStats;
      if(x && (x.items || x.unmatched)){
        const byRule = Object.keys(x.byRule).map(r => r+':'+x.byRule[r]).join(' ');
        console.log('      exercises: '+x.sets+' sets'
          + (x.items ? ', '+x.items+' questions, '+x.answered+' with an answer from the book ('
                        +(100*x.answered/x.items).toFixed(1)+'%)' : '')
          + (x.whole ? ', '+x.whole+' of them asked as one whole set' : '')
          + (byRule ? '  ['+byRule+']' : '')
          + (x.unmatched ? '; '+x.unmatched+' left unmatched'
                            +(x.sets ? '' : ' (rules found 0 candidates for any of them \u2014 try --export-unmatched)') : ''));
      }
    });
    if(WANT_REPORT){
      console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'segments-report.txt')+'  (language tagging audit)');
      console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'exercises-report.txt')+'  (exercise pairing audit)');
      if(aiLog.length){
        console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'ai-pairing-report.txt')+'  ('
          + aiLog.filter(r=>r.accepted).length+'/'+aiLog.length+' AI pairings accepted)');
      }
    }
    // Cost is printed unconditionally — not just under --report — because
    // it's the one number from this run that costs real money, and it comes
    // straight from the API's own usage field on each response, not a
    // token-counting estimate.
    if(AI_PAIRING_MAP){
      console.log('AI pairing: 0 API calls (used '+AI_PAIRING_FILE+') \u2014 $0.00');
    } else if(WANT_AI_PAIRING){
      const price = AI_PRICING[AI_MODEL];
      const dollars = price ?
        (aiUsage.inputTokens/1e6)*price.in + (aiUsage.outputTokens/1e6)*price.out : null;
      console.log('AI pairing: '+aiUsage.calls+' API call'+(aiUsage.calls===1?'':'s')
        +', '+aiUsage.inputTokens+' input + '+aiUsage.outputTokens+' output tokens'
        + (dollars !== null
            ? '  \u2248 $'+dollars.toFixed(4)+'  ('+AI_MODEL+' @ $'+price.in+'/$'+price.out+' per MTok'
              +' \u2014 verify current pricing at docs.claude.com)'
            : '  (no $ rate on file for model \"'+AI_MODEL+'\" \u2014 check docs.claude.com/en/docs/about-claude/pricing)'));
    }
    if(EXPORT_UNMATCHED){
      fs.writeFileSync(EXPORT_UNMATCHED, JSON.stringify(leftoverExport, null, 1), 'utf8');
      const qCount = leftoverExport.reduce((n,g) => n + g.questions.length, 0);
      console.log('Wrote '+EXPORT_UNMATCHED+'  ('+leftoverExport.length+' section(s), '
        +qCount+' unmatched question group(s) \u2014 hand this to Claude, get back "a"/"confidence"/"why"'
        +' filled in, then rerun with --ai-pairing-file on that same file)');
    }
  })();
}
