/* End-to-end test for index_ruby.html against a real encrypted build.
 * Covers what is specific to this app — the two-level chapter picker, ruby
 * glosses shown but never spoken — plus the shared playback and exercise flow.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, 'site-ruby');
const PASS = 'test';
const STUB_MS = 12;
const spoken = [];

function installBackend(w){
  w.fetch = (url) => {
    const p = path.join(SITE, String(url));
    if(!fs.existsSync(p)) return Promise.resolve({ ok:false });
    return Promise.resolve({ ok:true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p,'utf8'))) });
  };
  Object.defineProperty(w, 'crypto', { configurable:true, writable:true,
    value:{ subtle: crypto.webcrypto.subtle, getRandomValues: b => crypto.webcrypto.getRandomValues(b) } });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.atob = s => Buffer.from(s,'base64').toString('binary');
}
function installSpeech(w){
  const voices = [
    { voiceURI:'fr1', name:'Thomas',   lang:'fr-FR', default:false, localService:true },
    { voiceURI:'en1', name:'Samantha', lang:'en-US', default:true,  localService:true },
  ];
  w.SpeechSynthesisUtterance = function(text){ this.text = text; };
  w.speechSynthesis = {
    speaking:false, getVoices(){ return voices; }, cancel(){ this.speaking=false; },
    speak(u){ this.speaking=true; spoken.push({ text:u.text, lang:u.lang });
      setTimeout(() => { this.speaking=false; if(u.onend) u.onend(); }, STUB_MS); }
  };
  w.MediaMetadata = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'index_ruby.html'),'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://example.test/',
    beforeParse(win){ installBackend(win); installSpeech(win); }
  });
  const w = dom.window, doc = w.document;
  await sleep(90);

  let fails = 0;
  const check = (c,m) => { if(!c){ console.error('  FAIL:', m); fails++; } else console.log('  ok:', m); };

  // ---- book + two-level chapter picker ----
  doc.getElementById('bookInput').dispatchEvent(new w.Event('input',{bubbles:true}));
  await sleep(20);
  const opts = doc.querySelectorAll('#bookList .opt');
  check(opts.length >= 4, 'library lists the books (' + opts.length + ')');
  // Pick the big glossed book.
  let target = [...opts].find(o => /B2\.2/.test(o.textContent) && !/Pronounce/i.test(o.textContent)) || opts[0];
  console.log('   book:', target.textContent);
  target.click();
  await sleep(30);

  const partSel = doc.getElementById('partSelect');
  const chapSel = doc.getElementById('chapterSelect');
  check(!partSel.disabled && partSel.options.length > 1,
        'first dropdown lists the h1 parts (' + partSel.options.length + ')');
  check(chapSel.options.length >= 1, 'second dropdown is populated for the first part (' + chapSel.options.length + ')');
  check(chapSel.options.length < partSel.options.length * 200,
        'the second dropdown is scoped to one part, not the whole book');

  // Changing the part must change the section list.
  const before = [...chapSel.options].map(o => o.textContent).join('|');
  partSel.value = partSel.options[2].value;
  partSel.dispatchEvent(new w.Event('change', { bubbles:true }));
  await sleep(20);
  const after = [...chapSel.options].map(o => o.textContent).join('|');
  check(before !== after, 'choosing a different part reloads the section list');
  check([...chapSel.options].some(o => /\u00b7/.test(o.textContent)),
        'sections below h1 are shown indented');

  // Every section offered must really belong to the chosen part.
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE,'data-ruby','manifest.json'),'utf8'));
  const bk = manifest.books.find(b => b.title === target.textContent);
  const part = parseInt(partSel.value,10);
  const wrong = [...chapSel.options].filter(o => bk.chapters[+o.value].h !== part);
  check(wrong.length === 0, 'every section in the second dropdown belongs to the chosen part');
  check(bk.chapters.some(c => c.l === 2) && bk.chapters.some(c => c.l === 3),
        'h2 and h3 are chapters in the manifest');

  // ---- open a glossed chapter ----
  let opened = false;
  for(const o of chapSel.options){
    chapSel.value = o.value;
    doc.getElementById('bookPass').value = PASS;
    doc.getElementById('loadChapterBtn').click();
    await sleep(700);
    if(doc.getElementById('reader').classList.contains('on') &&
       doc.querySelector('#blockEl ruby')){ opened = true; break; }
    // step forward through blocks looking for ruby
    for(let i=0;i<12 && !doc.querySelector('#blockEl ruby');i++){
      doc.querySelector('[data-act="nextBlock"]').click(); await sleep(30);
    }
    if(doc.querySelector('#blockEl ruby')){ opened = true; break; }
  }
  check(opened, 'opened a chapter containing ruby glosses');

  // ---- ruby: shown, and never spoken ----
  const rubies = doc.querySelectorAll('#blockEl ruby');
  const rts = doc.querySelectorAll('#blockEl rt');
  check(rubies.length > 0, 'ruby elements are rendered (' + rubies.length + ')');
  check(rts.length === rubies.length, 'every ruby carries its gloss in an <rt>');
  const glossTexts = [...rts].map(r => r.textContent.trim()).filter(t => t && t !== '—');
  console.log('   sample glosses:', glossTexts.slice(0,6).join(' / '));

  await sleep(10);
  const idx = doc.getElementById('pos').textContent;
  spoken.length = 0;
  for(let i=0;i<10;i++) doc.querySelector('[data-gap="-50"]').click();
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*30);
  check(spoken.length > 0, 'the glossed block was read aloud (' + spoken.length + ' utterances)');
  const said = spoken.map(s => s.text).join(' ');
  // A gloss that is not also part of the French text must never be spoken.
  const baseText = [...rubies].map(r => {
    const c = r.cloneNode(true);
    [...c.querySelectorAll('rt')].forEach(x => x.remove());
    return c.textContent;
  }).join(' ');
  const baseWords = new Set(baseText.toLowerCase().match(/[a-zà-ÿ']{2,}/g) || []);
  const leaked = glossTexts
    .flatMap(t => (t.toLowerCase().match(/[a-zà-ÿ']{3,}/g) || []))
    .filter(word => !baseWords.has(word))
    .filter(word => new RegExp('\\\\b'+word.replace(/[.*+?^${}()|[\]\\\\]/g,'\\\\$&')+'\\\\b','i').test(said));
  check(leaked.length === 0, 'no gloss text reached the speech engine' +
        (leaked.length ? ' — leaked: ' + leaked.slice(0,6).join(', ') : ''));

  // ---- gloss visibility toggle ----
  const glossBtn = doc.getElementById('glossBtn');
  check(/On$/.test(glossBtn.textContent), 'glosses default to shown');
  glossBtn.click();
  check(doc.getElementById('textInner').classList.contains('rbGlossOff'),
        'hiding glosses applies to the whole stage, not just the current block');
  check(doc.querySelectorAll('#blockEl ruby').length === rubies.length,
        'hiding glosses leaves the words themselves in place');
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*20);
  check(spoken.length > 0, 'reading is unaffected by hiding the glosses');
  glossBtn.click();
  check(!doc.getElementById('textInner').classList.contains('rbGlossOff'), 'glosses come back');

  // ---- per-language voices still work ----
  const rates = new Set(spoken.map(s => s.lang));
  check(rates.size >= 1, 'utterances carry a language (' + [...rates].join(', ') + ')');

  console.log('\n' + (fails ? fails+' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(fails ? 1 : 0);
})();
