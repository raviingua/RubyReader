/* Whole-set exercise test, against a real encrypted build.
 * A matching / sorting / ordering exercise (or one with nothing to pair line
 * by line) is ONE question: the reader reads the whole exercise, stops once,
 * shows the whole exercise in the panel without a line number, and takes the
 * whole key as the answer. Checks that, and that "1d 2f…" / "d f…" count as
 * the book's "1 = d, 2 = f…".
 *
 *   APP_SITE=site-ruby APP_HTML=index_ruby.html APP_CHAPTER="Que signifient" \
 *   APP_TYPED="1d 2f 3b 4g 5c 6h 7e 8a" node test_wholeset.js
 *
 * APP_TYPED is an answer that should count as identical to the book's key for
 * that chapter's set; leave it out to skip that check. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, process.env.APP_SITE || 'site-ruby');
const APP  = process.env.APP_HTML || 'index_ruby.html';
const CHAPTER_RE = new RegExp(process.env.APP_CHAPTER || 'Que signifient', 'i');
const TYPED = process.env.APP_TYPED || '';
const PASS = 'test';
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
    speaking:false,
    getVoices(){ return voices; },
    cancel(){ this.speaking = false; },
    speak(u){ this.speaking=true; spoken.push({ text:u.text, lang:u.lang });
      setTimeout(() => { this.speaking=false; if(u.onend) u.onend(); }, 8); }
  };
  w.MediaMetadata = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, APP),'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://example.test/',
    beforeParse(win){ installBackend(win); installSpeech(win); }
  });
  const w = dom.window, doc = w.document;
  await sleep(80);
  let fails = 0;
  const check = (c,m) => { if(!c){ console.error('  FAIL:', m); fails++; } else console.log('  ok:', m); };

  doc.getElementById('bookInput').dispatchEvent(new w.Event('input',{bubbles:true}));
  await sleep(20);
  doc.querySelector('#bookList .opt').click();
  await sleep(20);
  const chapSel = doc.getElementById('chapterSelect');
  const partSel = doc.getElementById('partSelect');
  if(partSel){
    for(const p of partSel.options){
      partSel.value = p.value;
      partSel.dispatchEvent(new w.Event('change', { bubbles:true }));
      await sleep(10);
      if([...chapSel.options].some(o => CHAPTER_RE.test(o.textContent))) break;
    }
  }
  const ci = [...chapSel.options].findIndex(o => CHAPTER_RE.test(o.textContent));
  if(ci < 0){ console.error('FAIL: no chapter matching', CHAPTER_RE); process.exit(1); }
  console.log('chapter:', chapSel.options[ci].textContent.trim().slice(0,70));
  chapSel.value = chapSel.options[ci].value;
  doc.getElementById('bookPass').value = PASS;
  doc.getElementById('loadChapterBtn').click();
  await sleep(800);
  check(doc.getElementById('reader').classList.contains('on'), 'chapter opened');

  const panel = doc.getElementById('exPanel');
  doc.getElementById('exModeBtn').click();
  for(let i=0;i<10;i++) doc.querySelector('[data-gap="-50"]').click();
  doc.querySelector('[data-act="reset"]').click(); await sleep(10);
  spoken.length = 0;
  doc.getElementById('playBtn').click();
  let waited = 0;
  while(!panel.classList.contains('on') && waited < 600){ await sleep(25); waited++; }
  check(panel.classList.contains('on'), 'playback stopped and opened the panel');

  const exQ = doc.getElementById('exQ');
  check(exQ.classList.contains('whole'), 'the question is a whole set');
  check(!exQ.querySelector('.exNum'), 'no line number is shown for a whole set');
  check(exQ.querySelectorAll('.exBlk').length >= 2, 'the panel shows the whole exercise (' + exQ.querySelectorAll('.exBlk').length + ' blocks)');
  check(/whole set/i.test(doc.getElementById('exInput').placeholder), 'the input asks for the whole set');

  // The whole exercise was read before the panel opened: the text of its
  // LAST block (the option list, typically) is among what was spoken.
  const blocks = exQ.querySelectorAll('.exBlk');
  const lastBlk = blocks[blocks.length-1];
  const lastLine = [...lastBlk.querySelectorAll('li, tr')].pop() || lastBlk;
  const lastText = lastLine.textContent.replace(/\s+/g,' ').trim();
  const probe = lastText.split(/\s+/).slice(-3).join(' ').replace(/[^\p{L}\p{N} ]/gu,'').trim();
  // (A label such as "F." can be spoken as a segment of its own, so look in
  // the last few utterances joined, not in any single one.)
  const tail = spoken.slice(-12).map(s => s.text || '').join(' ').replace(/[^\p{L}\p{N} ]/gu,'').replace(/\s+/g,' ');
  check(tail.indexOf(probe.replace(/\s+/g,' ')) >= 0,
        'the exercise was read to its last block before asking ("' + probe + '")');
  const atWait = spoken.length;
  await sleep(150);
  check(spoken.length === atWait, 'reading is stopped while waiting');

  // Answer it.
  const input = doc.getElementById('exInput');
  input.value = TYPED || 'my answer';
  spoken.length = 0;
  doc.getElementById('exSubmit').click();
  await sleep(60);
  const book = doc.getElementById('exBook');
  check(doc.getElementById('exCompare').style.display !== 'none', 'both answers are revealed');
  check(book.textContent.trim().length > 0, 'the whole key is shown: ' + JSON.stringify(book.textContent.trim().slice(0,60)));
  check(spoken.length > 0, 'the key is read aloud');
  const same = doc.getElementById('exSame');
  if(TYPED){
    check(same.style.display !== 'none', '"' + TYPED + '" counts as identical to the book’s key');
  } else {
    check(same.style.display === 'none', 'an unrelated answer is not called identical');
  }

  // Next: the following question (a line-by-line one, if the chapter has
  // one) gets its number and the normal prompt back.
  doc.getElementById('exNext').click();
  waited = 0;
  while(!panel.classList.contains('on') && waited < 600){ await sleep(25); waited++; }
  if(panel.classList.contains('on') && !exQ.classList.contains('whole')){
    check(!!exQ.querySelector('.exNum'), 'a following line-by-line question has its number again');
    check(!/whole set/i.test(doc.getElementById('exInput').placeholder), 'and the normal prompt');
  }

  console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})();
