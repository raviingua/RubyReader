#!/usr/bin/env node
/* Verify a built ruby library against its XHTML sources.
 *
 * Four things matter here, and all four are checked against the real
 * encrypted output rather than against the builder's own internals:
 *
 *   integrity — every data-seg span has a segs entry and vice versa
 *   coverage  — every visible word in the source reaches the reader
 *   ruby      — the <ruby> markup survives into the display HTML
 *   glosses   — and no <rt> gloss text ever reaches the speech text, which is
 *               the single most important property of this app: a gloss read
 *               aloud turns "développé" into "développé developed" and ruins
 *               the sentence
 *
 * Usage: node tools/verify_ruby.js <siteDir> <srcDir> [passphrase]
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { parseXhtml, findElement } = require(path.join(__dirname, '..', 'xhtml_parse.js'));

const SITE = process.argv[2] || 'site-ruby';
const SRC  = process.argv[3] || 'books-xhtml';
const PASS = process.argv[4] || 'test';

const man = JSON.parse(fs.readFileSync(path.join(SITE,'data-ruby','manifest.json'),'utf8'));
const c = man.crypto;
const key = crypto.pbkdf2Sync(PASS, Buffer.from(c.salt,'base64'), c.iter, 32, 'sha256');
function decrypt(file){
  const raw = JSON.parse(fs.readFileSync(path.join(SITE, file),'utf8'));
  const ct = Buffer.from(raw.ct,'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv,'base64'));
  d.setAuthTag(ct.slice(-16));
  return JSON.parse(Buffer.concat([d.update(ct.slice(0,-16)), d.final()]).toString('utf8'));
}

const words = s => (String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .match(/[a-z0-9']{2,}/g) || []);

// Visible text of the source, and separately the gloss text, so the two can be
// checked in opposite directions.
function sourceText(file){
  const doc = parseXhtml(fs.readFileSync(file,'utf8'), path.basename(file));
  const body = findElement(doc,'body');
  let visible = '', glosses = '', rubies = 0;
  (function walk(n, inRt){
    if(n.type === 'text'){ if(inRt) glosses += ' ' + n.text; else visible += ' ' + n.text; return; }
    if(n.name === 'script' || n.name === 'style') return;
    if(n.name === 'ruby') rubies++;
    const rt = inRt || n.name === 'rt' || n.name === 'rp';
    for(const ch of (n.children||[])) walk(ch, rt);
  })(body, false);
  return { visible, glosses, rubies };
}

let fails = 0;
console.log('book'.padEnd(44) + 'integ  coverage        ruby kept   glosses spoken');
for(const b of man.books){
  const book = decrypt(b.file);
  const src = sourceText(path.join(SRC, b.source));

  let integrity = 0, rubyBlocks = 0;
  const speech = [], html = [];
  for(const ch of book.chapters){
    for(const bl of ch.blocks){
      const found = new Set([...bl.html.matchAll(/data-seg="(\d+)"/g)].map(m => +m[1]));
      for(const i of found) if(i >= bl.segs.length) integrity++;
      for(let i = 0; i < bl.segs.length; i++) if(!found.has(i)) integrity++;
      for(const s of bl.segs){
        if(s.lang !== 'fr' && s.lang !== 'en') integrity++;
        speech.push(s.text);
      }
      html.push(bl.html);
      if(bl.html.indexOf('<ruby') >= 0) rubyBlocks++;
    }
  }
  const outHtml = html.join(' ');
  const outSpeech = speech.join(' ');

  // Coverage: how much of the source's visible vocabulary reached the reader.
  const outWords = new Set(words(outHtml.replace(/<rt>[\s\S]*?<\/rt>/g,' ')));
  const srcWords = words(src.visible);
  const srcUniq = [...new Set(srcWords)];
  const covered = srcUniq.filter(w => outWords.has(w)).length;
  const covPct = 100 * covered / Math.max(1, srcUniq.length);

  // Ruby: the markup must survive into the display HTML.
  const outRubies = (outHtml.match(/<ruby/g) || []).length;
  const rubyPct = src.rubies ? 100 * outRubies / src.rubies : 100;

  // Glosses: words that appear ONLY in <rt> and nowhere in the visible text
  // must not appear in the speech text. Words shared with the base text can't
  // be attributed either way, so they're excluded from the test.
  const visSet = new Set(srcWords);
  const glossOnly = [...new Set(words(src.glosses))].filter(w => !visSet.has(w));
  const spokenSet = new Set(words(outSpeech));
  const leaked = glossOnly.filter(w => spokenSet.has(w));

  const ok = integrity === 0 && covPct > 99 && rubyPct > 99 && leaked.length === 0;
  if(!ok) fails++;
  console.log(
    b.id.slice(0,42).padEnd(44) +
    String(integrity).padEnd(7) +
    (covered+'/'+srcUniq.length+' '+covPct.toFixed(1)+'%').padEnd(16) +
    (outRubies+'/'+src.rubies+' '+rubyPct.toFixed(1)+'%').padEnd(12) +
    (leaked.length ? leaked.length+' LEAKED: '+leaked.slice(0,5).join(',') : '0 of '+glossOnly.length+' gloss-only words') +
    (ok ? '' : '   <-- CHECK'));
  if(covPct <= 99){
    const miss = srcUniq.filter(w => !outWords.has(w)).slice(0,8);
    console.log('        source words not displayed: ' + miss.join(', '));
  }
}
console.log(fails ? '\n' + fails + ' book(s) need attention' : '\nall books clean');
process.exit(fails ? 1 : 0);
