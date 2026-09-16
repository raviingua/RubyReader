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
LE.setDefaultLang(DEFAULT_LANG);

const { classify, scoreText, speechText, escapeHtml } = LE;

// ============================== encryption ==============================
// Identical scheme and passphrase workflow to the other three builders.

const PBKDF2_ITER = 250000;
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

function textOf(node){
  if(node.type === 'text') return node.text;
  if(node.name === 'rt') return '';            // a gloss is never part of the text
  return (node.children || []).map(textOf).join('');
}
// The text as it will be SPOKEN: ruby bases only, glosses dropped.
function speechOf(node){ return speechText(textOf(node)); }

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
    text: speechText(s.pieces.map(p => p.speech).join(''))
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
  const html = renderSegs(segmentTokens(inlineTokens(el, [], 'plain'), ctx.seed, force), counter, segs);
  if(!segs.length) return null;
  const block = Object.assign({ type: type, html: html, segs: segs }, extra || {});
  if(ctx.quote) block.quote = true;
  if(ctx.box) block.box = ctx.box;
  block._lines = [{ raw: speechOf(el), segFrom: 0, segTo: counter.n - 1 }];
  ctx.seed = segs.length ? segs[segs.length-1].lang : ctx.seed;
  return block;
}

function buildListBlock(el, ctx){
  const segs = [], counter = { n:0 };
  const force = classLang(el, ctx.lang);
  const ordered = el.name === 'ol';
  const type = (el.attrs && el.attrs.type) || '';
  const lines = [];
  let html = '<'+(ordered ? 'ol' : 'ul')+' class="rbList"'+(type ? ' type="'+escapeHtml(type)+'"' : '')+'>';
  for(const li of (el.children || [])){
    if(li.type !== 'element' || li.name !== 'li') continue;
    const liForce = classLang(li, force);
    const from = counter.n;
    const inner = renderSegs(segmentTokens(inlineTokens(li, [], 'plain'), ctx.seed, liForce), counter, segs);
    html += '<li>' + inner + '</li>';
    lines.push({ raw: speechOf(li), segFrom: from, segTo: counter.n - 1 });
  }
  html += '</'+(ordered ? 'ol' : 'ul')+'>';
  if(!segs.length) return null;
  const block = { type:'list', ordered: ordered || undefined, listType: type || undefined,
                  html: html, segs: segs };
  if(ctx.quote) block.quote = true;
  if(ctx.box) block.box = ctx.box;
  block._lines = lines;
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
      if(!isHead && skipCol[cx]){
        html += '<'+tag+' class="noSpeak">'+serializeInlineHtml(cell)+'</'+tag+'>';
        return;
      }
      const cellForce = classLang(cell, force);
      const inner = renderSegs(segmentTokens(inlineTokens(cell, [], 'plain'), ctx.seed, cellForce), counter, segs);
      html += '<'+tag+'>'+inner+'</'+tag+'>';
    });
    html += '</tr>';
    if(!isHead) rowMap.push({ cells: cells.map(speechOf), segFrom: from, segTo: counter.n - 1 });
  });
  html += '</table>';
  if(!segs.length) return null;
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
const NUM_PREFIX  = /^\s*(\d+)\s*[.)]\s*/;
// Lists whose markers are letters or roman numerals are option pools to choose
// FROM ("Définitions: a) … b) …"), not the questions themselves.
const OPTION_LIST = /^[aAiI]$/;

function exOrdinal(t){
  const m = EX_ORDINAL.exec(t || '');
  if(!m) return null;
  const w = m[1].toLowerCase();
  const kind = /^exerc/.test(w) ? 'ex' : /^drill/.test(w) ? 'drill' : /^t[âa]ch|^task/.test(w) ? 'task' : 'act';
  return kind + ':' + m[2];
}
function exLetter(t){ const m = EX_LETTER.exec((t || '').trim()); return m ? m[1].toUpperCase() : null; }
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

// Items out of one block: list entries, numbered paragraphs, or table rows
// keyed by a numeric first column.
function itemsFromBlock(bl, blockIdx){
  if(bl.type === 'list'){
    if(bl.listType && OPTION_LIST.test(bl.listType)) return [];
    return (bl._lines || []).map((ln, i) => {
      const m = NUM_PREFIX.exec(ln.raw);
      return { num: m ? parseInt(m[1],10) : (i+1), pos: i+1, blockIdx: blockIdx,
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
      if(!/^\d+$/.test(first)) return;
      out.push({ num: parseInt(first,10), pos: null, blockIdx: blockIdx,
                 segFrom: r.segFrom, segTo: r.segTo,
                 text: r.cells.slice(1).filter(Boolean).join(' \u2014 ') });
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
    let cur = { title: ch.title, chapterIdx: ci, ancestry: ancestry.slice(),
                box: null, items: [], blockFrom: 0 };
    groups.push(cur);
    ch.blocks.forEach((bl, bi) => {
      if(bl.type === 'heading' && !bl.chapterTitle){
        cur = { title: speechText(bl.html.replace(/<[^>]+>/g,' ')),
                chapterIdx: ci, ancestry: ancestry.slice(), box: bl.box || null,
                items: [], blockFrom: bi };
        groups.push(cur);
        return;
      }
      if(bl.box && !cur.box) cur.box = bl.box;
      cur.items.push(...itemsFromBlock(bl, bi));
    });
  });
  return groups.map(g => {
    g.isAnswer = g.box === 'answer' || ANS_HEADING.test(g.title) ||
                 g.ancestry.some(a => ANS_HEADING.test(a));
    g.isExercise = !g.isAnswer && (g.box === 'exercise' ||
                 EX_HEADING.test(g.title) || g.ancestry.some(a => EX_HEADING.test(a)));
    g.ord = exOrdinal(g.title);
    g.letter = exLetter(g.title);
    g.norm = normTitle(g.title);
    g.words = sectionWords(g.ancestry.join(' ') + ' ' + g.title);
    return g;
  });
}

function answerPayload(text){
  const segs = LE.segmentLine(String(text || '').replace(/\s+/g,' ').trim(), null);
  return {
    html: segs.map(s => s.html).join('') || escapeHtml(String(text || '')),
    segs: segs.filter(s => s.text && s.text.trim()).map(s => ({ lang: s.lang, text: s.text })),
    text: segs.map(s => s.text).filter(Boolean).join(' ')
  };
}

function attachExercises(book){
  const stats = { sets:0, items:0, answered:0, unmatched:0, byRule:{} };
  const groups = collectGroups(book);
  const answers = groups.filter(g => g.isAnswer && g.items.length);
  if(!answers.length) return stats;
  const questions = groups.filter(g => !g.isAnswer && g.items.length &&
    (g.isExercise || answers.some(a => a.norm && a.norm === g.norm)));

  for(const q of questions){
    const candidates = [];
    for(const a of answers){
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
      if(q.letter && a.letter === q.letter && overlap(q.words, a.words)){
        candidates.push({ a:a, rule:'letter', dist: a.chapterIdx - q.chapterIdx }); continue;
      }
      // Rule 3 — an explicit ordinal on both sides.
      if(q.ord && a.ord === q.ord){
        candidates.push({ a:a, rule:'ordinal', dist: a.chapterIdx - q.chapterIdx }); continue;
      }
      // Rule 4 — no key at all: the next answer group with no key of its own
      // and the same number of items.
      if(!q.letter && !q.ord && !a.letter && !a.ord && q.isExercise &&
         a.items.length === q.items.length){
        candidates.push({ a:a, rule:'adjacent', dist: a.chapterIdx - q.chapterIdx }); continue;
      }
    }

    let pick = null;
    for(const rule of ['title','letter','ordinal','adjacent']){
      const c = candidates.filter(x => x.rule === rule);
      if(!c.length) continue;
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
    if(!pick){ stats.unmatched += q.items.length; continue; }
    pick.a._used = true;

    // Pair on printed numbers when both sides have them; otherwise by
    // position, and then only when the two lists are the same length — a
    // mismatch means these are not the same exercise.
    const aItems = pick.a.items;
    const bothNumbered = q.items.every(i => NUM_PREFIX.test(i.text)) &&
                         aItems.every(i => NUM_PREFIX.test(i.text));
    let lookup;
    if(bothNumbered){
      const m = new Map();
      aItems.forEach(i => { if(!m.has(i.num)) m.set(i.num, i); });
      const covered = q.items.filter(i => m.has(i.num)).length;
      if(covered < Math.ceil(q.items.length / 2)){ stats.unmatched += q.items.length; continue; }
      lookup = it => m.get(it.num);
    } else {
      if(aItems.length !== q.items.length){ stats.unmatched += q.items.length; continue; }
      lookup = (it, ix) => aItems[ix];
    }

    const set = { title: q.title, match: pick.rule,
                  source: pick.a.title, sourceCh: pick.a.chapterIdx, items: [] };
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
    stats.byRule[pick.rule] = (stats.byRule[pick.rule] || 0) + 1;
    const ch = book.chapters[q.chapterIdx];
    (ch.exercises || (ch.exercises = [])).push(set);
    stats.sets++;
  }
  book.chapters.forEach(ch => {
    if(ch.exercises) ch.exercises.sort((x,y) =>
      (x.items[0] ? x.items[0].block : 0) - (y.items[0] ? y.items[0].block : 0));
  });
  return stats;
}

function stripBuildScaffolding(book){
  for(const ch of book.chapters){
    for(const bl of ch.blocks){ delete bl._lines; delete bl._rows; delete bl._header; delete bl.chapterTitle; }
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

  const books = files.map(f => {
    const b = extractBook(path.join(SRC, f));
    b.exStats = attachExercises(b);
    stripBuildScaffolding(b);
    return b;
  });
  books.sort((a,b) => a.title.localeCompare(b.title));

  const usedIds = [];
  books.forEach(b => {
    let base = b.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'book';
    let id = base, n = 2;
    while(usedIds.includes(id)) id = base + '-' + (n++);
    usedIds.push(id); b.id = id;
  });

  function writeReports(){
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
          set.items.forEach(it => {
            ex.push('    Q'+it.n+'  '+it.q);
            ex.push('      A   '+(it.a !== undefined ? it.a : '*** NO ANSWER FOUND ***'));
          });
        });
      });
    });
    fs.writeFileSync(path.join(DATA,'exercises-report.txt'), ex.join('\n'), 'utf8');
  }

  (async () => {
    const passphrase = (await getPassphrase()).trim();
    if(!passphrase){ console.error('No passphrase provided (set BOOK_PASSPHRASE or type one). Aborting.'); process.exit(1); }
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITER, 32, 'sha256');

    fs.rmSync(DATA, { recursive:true, force:true });
    fs.mkdirSync(DATA, { recursive:true });

    const manifest = {
      crypto: { alg:'AES-GCM', kdf:'PBKDF2', hash:'SHA-256', iter:PBKDF2_ITER, salt: salt.toString('base64') },
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
    if(WANT_REPORT) writeReports();

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
      if(x && x.items){
        console.log('      exercises: '+x.sets+' sets, '+x.items+' questions, '+x.answered
          + ' with an answer from the book ('+(100*x.answered/x.items).toFixed(1)+'%)  ['
          + Object.keys(x.byRule).map(r => r+':'+x.byRule[r]).join(' ') + ']'
          + (x.unmatched ? '; '+x.unmatched+' left unmatched' : ''));
      }
    });
    if(WANT_REPORT){
      console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'segments-report.txt')+'  (language tagging audit)');
      console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'exercises-report.txt')+'  (exercise pairing audit)');
    }
  })();
}
