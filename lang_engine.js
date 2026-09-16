/* lang_engine.js — the FR/EN language tagger, shared by the XHTML (ruby)
 * builder.
 *
 * This is the same engine build_books_mixed.js uses for the Markdown books:
 * function-word scoring, French elision and accent placement, French
 * punctuation spacing, cognate neutrality, the generated lexicon, citation
 * splitting, and the split/tag/merge segmentation that keeps a segment to at
 * most one sentence.
 *
 * It is a SEPARATE COPY on purpose. build_books_mixed.js is deliberately left
 * untouched, so nothing about the Markdown app can change as a result of work
 * on the XHTML one. The cost is that a fix to the tagger has to be applied in
 * both places; the benefit is that the two apps cannot break each other. (If
 * you would rather have one copy, the Markdown builder can be pointed at this
 * module later — but that is a change to a working app, so it isn't done
 * here by default.)
 *
 * Exported:
 *   classify(text)          -> 'fr' | 'en' | 'none'
 *   segmentLine(line, seed) -> [{ lang, html, text }]   (Markdown-ish inline)
 *   speechText(raw)         -> what a voice should actually say
 *   scoreText / escapeHtml / splitSentences / splitSeparators / SEP_RE ...
 * plus the word lists, so the tests can check list hygiene.
 */
'use strict';
const path = require('path');

// The language used for a fragment with no evidence at all and no tagged
// neighbour. The Markdown builder exposes this as --default-lang; here the
// caller sets it through setDefaultLang().
let DEFAULT_LANG = 'en';
function setDefaultLang(l){ DEFAULT_LANG = (l === 'fr') ? 'fr' : 'en'; }

// ==================== language identification ====================
//
// Function words first: they are the highest-signal, lowest-effort way to
// tell these two languages apart, and they work on fragments far too short
// for anything statistical ("un peu" -> fr, "a little" -> en).

const FR_FUNCTION = new Set([
  // pronouns
  'je','tu','il','elle','nous','vous','ils','elles','te','se','me',
  'moi','toi','lui','leur','leurs','y','en','ce','cela','ça',
  // articles / determiners
  'le','la','les','un','une','des','du','cet','cette','ces',
  'mon','ma','mes','ton','ta','tes','sa','ses','notre','nos','votre','vos',
  'quel','quelle','quels','quelles','tout','toute','tous','toutes','chaque',
  // prepositions / conjunctions
  'de','à','au','aux','dans','sur','sous','avec','sans','pour','par','chez',
  'vers','entre','depuis','pendant','selon','contre','avant','après','sauf',
  'et','ou','mais','donc','ni','puis','alors','parce','car','comme','lorsque',
  'que','qui','quoi','dont','où','quand','comment','pourquoi','combien',
  'si','ne','pas','moins','très','trop','aussi','encore','jamais',
  'toujours','ici','là','oui','non','bien','peu','beaucoup','rien','tout',
  // être / avoir / aller / faire and other high-frequency verbs
  'est','sont','suis','es','êtes','sommes','être','était','étaient','sera',
  'ai','avons','avez','ont','avoir','avait','avaient','aura',
  'vais','vas','va','allons','allez','vont','aller','allait',
  'fais','fait','faites','faisons','font','faire','faisait',
  'veux','veut','voulez','voulons','veulent','vouloir',
  'peux','peut','pouvez','pouvons','peuvent','pouvoir',
  'dois','doit','devez','devons','doivent','devoir',
  'sais','sait','savez','savons','savent','savoir',
  'dit','dis','dites','disons','disent','dire',
  'utilisez','utilise','utilisent','choisissez','complétez','écrivez',
  'mettez','traduisez','répondez','décidez','décrivez','placez','accordez',
  'conjuguez','identifiez','transformez','lisez','regardez',
]);

const EN_FUNCTION = new Set([
  'the','an','this','that','these','those','is','are','was','were','be',
  'been','being','am','to','of','and','in','at','for','with','from','by',
  'but','so','or','nor','not','no','yes',
  'you','he','she','they','we','it','i','him','her','them','us',
  'his','their','my','your','our','its','mine','yours','hers','theirs',
  'have','has','had','do','does','did','will','would','can','could','should',
  'shall','may','might','must','going','get','got','make','makes','made',
  'what','which','who','whom','whose','when','where','why','how',
  'about','into','onto','than','then','there','here','very','too','also',
  'if','because','while','during','between','against','without','through',
  'over','under','after','before','again','once','all','both','each','every',
  'some','any','most','more','much','many','few','little','other','another',
  'own','same','such','only','just','even','still','yet','out','up','down',
  'now','always','never','often','sometimes','usually','well','back',
]);

// French content words that settle a fragment on their own, with no French
// function word present. Deliberately weighted toward what these course
// books actually put in headings, table cells and one-word utterances.
const FR_LEXICON = new Set([
  'bonjour','bonsoir','bonne','bon','nuit','journée','matin','soir','jour',
  'salut','merci','voilà','voici','pardon','excusez','enchanté','enchantée',
  'bienvenue','accord','demain','hier','aujourd','maintenant','ensuite',
  'français','française','françaises','anglais','anglaise','langue','langues',
  'livre','livres','lettre','lettres','histoire','chapitre','chapitres',
  'partie','parties','leçon','leçons','exemple','exemples','règle','règles',
  'niveau','niveaux','voisin','voisine','voisins','mère','père','grand',
  'grande','petit','petite','ami','amie','amis','famille','fille','fils',
  'femme','homme','gens','personne','personnes','enfant','enfants',
  'présenter','présente','présentations','appelle','appelez','appelles',
  'salutations','salutation','pronom','pronoms','verbe','verbes','nom','noms',
  'adjectif','adjectifs','conjugaison','singulier',
  'pluriel','masculin','féminin','nombre','nombres','accord',
  'vouvoyer','tutoyer','politesse','exercice','exercices',
  'réponse','réponses','corrigé','vocabulaire','grammaire',
  'astuce','mémorisation','remarque','importants',
  'importante','importantes','autres','mots',
  'fatigué','fatiguée','gentil','gentille','beau','belle','joli','jolie',
  'thé','pain','eau','chaise','tasse',
  'prochain','prochaine','suivant','suivante','début','fin','travail',
  'formel','formelle','informel','informelle','poli','polie',
  'métier','métiers','profession','professions','nationalité','nationalités',
  'mot','forme','formes',
  'utilisation','utilisations','sens','titre',
  'apprendre','apprenez','appris','parler','parlez','comprendre','écouter',
  'être','avoir','aller','faire','venir','prendre','mettre','partir',
  'premier','première','deuxième','troisième','dernier','dernière',
  'rencontre','rencontrer','aide','comptoir','magasin','marché','boulangerie',
  'jeudi','vendredi','samedi','dimanche','lundi','mardi','mercredi',
  'semaine','mois','année','heure','heures','minute','minutes',
  'chose','choses','fois','moyen','façon','manière','endroit','monde',
  'droite','gauche','devant','derrière','dessus','dessous','loin','près',
]);

// English content words in the same spirit: what shows up in this book's
// English headings, glosses and table columns.
const EN_LEXICON = new Set([
  'hello','goodbye','good','evening','morning','night','day','thanks','thank',
  'please','welcome','sorry','excuse','name','little','tired','neighbor',
  'neighbour','grandmother','grandfather','tomorrow','yesterday','today',
  'greeting','greetings','introduction','introductions','pronoun','pronouns',
  'verb','verbs','noun','nouns','adjective','adjectives',
  'number','numbers','gender','singular','plural','masculine','feminine',
  'formal','informal','polite','politeness','usage','use','used','using',
  'meaning','means','meant','example','examples','exercise','exercises',
  'answer','answers','key','vocabulary','grammar','summary','story',
  'cultural','practice','review','preview','next','coming','first',
  'second','third','fourth','person','people','family','friend','friends',
  'mother','father','daughter','woman','man','child','children',
  'chapter','chapters','part','book','books','level','levels','lesson',
  'lessons','page','pages','word','words','sentence',
  'sentences','tips','memory',
  'spotlight','sidebar','box','list','lists','guide',
  'pronunciation','learn','learned','learning','learner','learners','speak',
  'speaking','spoken','say','says','said','said','write','writing','written',
  'read','reading','listen','listening','understand','understanding',
  'english','french','spanish','german','american','british','canadian',
  'beginner','beginners','complete','completely','difference',
  'differences','between','choose','choosing','correct','correctly','wrong',
  'translate','translation','complete','fill','blank','blanks','order',
  'describe','identify','transform','conjugate','match',
  'work','works','working','job','jobs','city','town','house',
  'home','coffee','shop','market','airport','train','bus','station',
  // food words the frequency generator declines because their French
  // zipf is inflated by proper nouns and abbreviations ('ham', 'lamb')
  'ham','pork','beef','lamb','onion','garlic','cabbage','pear','peach',
  'plum','grape','grapes','carrot','sausage','strawberry','apple',
  'focus','rule','rules','golden',
  'insight','glance','series','edition','coverage','target','range','score',
  'skill','skills','program','minimum','typical','primary','when','whenever',
  'one','two','three','four','five','seven','eight','nine','ten',
  'zero','hundred','thousand','half','whole','full','empty','new','old',
  'goal','goals','step','steps','stage','stages','start','starting','end',
  'ending','ready','done','next','previous','above','below','left','right',
  'true','false','same','different','similar','common','rare',
  'easy','hard','difficult','clear','unclear','helps','help',
  'helping','helpful','choice',
  'choices','relationship','shows','show',
]);

// Words that are NOT evidence, and would be actively misleading if counted:
// loan-words, honorifics, proper names — and, most importantly, the many
// French/English pairs spelled identically ("dialogue", "table", "important",
// "question", "articles", "culture"). A cognate in either lexicon casts a
// vote it has no business casting: "les tables" came out English purely
// because "tables" was on the English list, cancelling out "les".
const NEUTRAL = new Set([
  // identical in both languages — never evidence for either side
  // ambiguous across the two languages — spelled the same, or common in
  // both ('on', 'son', 'as', 'a', 'six', 'plus', 'village')
  'on','son','as','a','six','plus','village',
  'article','articles','table','tables','question','questions','phrase',
  'phrases','expression','expressions','culture','cultures','dialogue',
  'dialogues','important','note','notes','moment','moments','situation',
  'situations','genre','genres','possible','simple','respect','age','image',
  'nation','national','social','animal','animals','capital','festival',
  'attention','exception','exceptions','plus','regions','region','service',
  'services','conversation','conversations','conversation','information',
  'construction','position','positions','description','descriptions',
  'transformation','communication',
  'café','cafés','cafe','cafes','croissant','croissants','baguette','menu',
  'fiancé','fiancée','résumé','cliché','déjà','vu','naïve','naive','crêpe',
  'crêpes','crepe','crepes','crème','creme','pâté','purée','soufflé','éclair',
  'éclairs','brûlée','flambé','sauté','entrée','entrées','saké','madame',
  'monsieur','mademoiselle','mesdames','messieurs','bravo',
  'emma','marcel','sophie','élise','lucas','henri','martin','dubois',
  'france','paris','tours','saint','véran','loire','portland','oregon',
  'québec','quebec','delf','tef','tcf','clb','tgv','a1','a2','b1','b2','c1',
  'ok','okay','um','uh','oh','ah','eh','mm','hmm',
]);

// Last resort for a phrase that simply cannot be judged from its own words.
// Tested against the fragment's cleaned text, in order, before scoring; the
// first match wins. Add entries here when --report shows something wrong
// that no word-list change can fix.
const LANG_OVERRIDES = [
  // [ /pattern/i, 'fr' | 'en' ],
  // e.g. [ /^Tu vs Vous$/i, 'fr' ],
];

/* ---------------------------------------------------------------------------
 * GENERATED LEXICON  (lexicon.js, produced by tools/make_lexicon.py)
 * ---------------------------------------------------------------------------
 * The hand-written lists above encode what reading the audit report taught us
 * about THIS book. They can't cover the long tail, though, and that gap
 * caused a real misreading: a table column of "20 vingt / 21 vingt et un /
 * 22 vingt-deux / …" had no French function word in most cells, so almost
 * every cell scored as no-evidence and one stray miscount flipped the whole
 * column to English.
 *
 * Filling that tail by hand is how cognate bugs get in — "six" is French AND
 * English, as are "cent", "sept", "pour", "table", "chat", "main", "plus".
 * So lexicon.js is generated from corpus frequencies instead, keeping a word
 * only when it is at least 100x commoner in one language than the other AND
 * not an everyday word in the other language at all. Cognates fail both tests
 * and are dropped automatically rather than being noticed later.
 *
 * Precedence is deliberate: NEUTRAL wins over everything, the curated lists
 * win over the generated ones, and a generated word that would contradict a
 * curated one is discarded rather than turning that curated word ambiguous.
 * So adding this file can only ever ADD evidence where there was none — it
 * cannot overturn a decision the hand lists were already making.
 *
 * If lexicon.js is missing the build still works, with a warning; it just
 * falls back to the curated lists alone.
 */
let GEN_FR = new Set(), GEN_EN = new Set();
(function loadGeneratedLexicon(){
  let gen;
  try { gen = require(path.join(__dirname,'lexicon.js')); }
  catch(e){
    console.warn('NOTE: lexicon.js not found next to this script — using the built-in word lists only.');
    console.warn('      Regenerate it with:  python3 tools/make_lexicon.py > lexicon.js');
    return;
  }
  const handFr = new Set([...FR_FUNCTION, ...FR_LEXICON]);
  const handEn = new Set([...EN_FUNCTION, ...EN_LEXICON]);
  let droppedFr = 0, droppedEn = 0;
  for(const w of (gen.fr||[])){
    if(NEUTRAL.has(w) || handEn.has(w)){ droppedFr++; continue; }
    GEN_FR.add(w);
  }
  for(const w of (gen.en||[])){
    if(NEUTRAL.has(w) || handFr.has(w)){ droppedEn++; continue; }
    GEN_EN.add(w);
  }
  if(process.env.LEXICON_VERBOSE){
    console.log('lexicon.js: +'+GEN_FR.size+' FR, +'+GEN_EN.size+' EN  ('
      + droppedFr+'/'+droppedEn+' dropped as already curated or neutral)');
  }
})();

// Words sitting on both sides cancel out in score() and are therefore dead
// weight rather than evidence — easy to introduce by editing a list and not
// noticing. Say so at build time instead of letting it go quiet.
(function checkLexiconCollisions(){
  const both = [...FR_FUNCTION, ...FR_LEXICON].filter(w => EN_FUNCTION.has(w) || EN_LEXICON.has(w));
  const neut = [...FR_FUNCTION, ...FR_LEXICON, ...EN_FUNCTION, ...EN_LEXICON].filter(w => NEUTRAL.has(w));
  if(both.length) console.warn('NOTE: '+both.length+' word(s) are in BOTH the French and English lists, so they vote for neither: '+both.slice(0,12).join(', ')+(both.length>12?'…':''));
  if(neut.length) console.warn('NOTE: '+neut.length+' word(s) are in a language list AND in NEUTRAL, so the list entry has no effect: '+neut.slice(0,12).join(', ')+(neut.length>12?'…':''));
})();

const DIACRITIC = /[àâäçéèêëîïôöùûüÿœæ]/i;
// French elision — l'arrivée, j'ai, qu'il, aujourd'hui. A very strong signal,
// and one that survives in fragments too short for anything else to work.
const ELISION = /\b(?:j|l|d|n|m|t|s|c|qu|jusqu|lorsqu|puisqu|quelqu|aujourd)['\u2019][a-zà-ÿœæ]/i;
// French typography puts a space before ! ? ; : and inside « »; English never
// does. This turns out to be one of the most reliable signals in the whole
// book — across all 18,500 segments it appears in 1,262 unmistakably French
// ones and exactly 1 English one (and that one is a French imperative quoted
// inside an English sentence). It rescues short French fragments that carry
// no other evidence at all: "Sachons !", "Allons-y !", "Culture : …".
const FR_PUNCT_SPACE = /\s[!?;:\u00bb]|\u00ab\s/;
const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
// Endings that are English and essentially never French. These matter more
// than they look: English's most useful marker, "a", is also the French verb
// "a" (il a) and therefore has to be ignored as ambiguous, which leaves plenty
// of ordinary English fragments ("Saying hello", "Usually formal") with no
// function word at all to vote for them.
const EN_SUFFIX = /^[a-z]{3,}(?:ing|ly|ness|ful|less)$/;

function tokens(text){
  return (text.replace(/['\u2019]/g,' ').match(WORD_RE) || []);
}

// 'fr' | 'en' | 'none' for one fragment. 'none' is a real answer, not a
// failure: it means "no evidence", and the caller resolves it from context
// rather than guessing here.
// Is this token's spelling itself French evidence?
//   lowercase + accent anywhere      -> French ("français", "écrivez", "été")
//   capitalised + accent inside      -> French ("Première", "Réponses")
//   capitalised + accent ONLY first  -> not evidence: that shape is almost
//                                       always a name or loan-word dropped
//                                       into English text ("Élise", "Été" as
//                                       a title), and counting it made whole
//                                       English sentences come out French.
function accentEvidence(t){
  if(NEUTRAL.has(t.toLowerCase())) return false;
  if(!DIACRITIC.test(t)) return false;
  if(/^[a-zà-ÿœæ]/.test(t)) return true;      // lowercase word -> French
  return DIACRITIC.test(t.slice(1));          // capitalised -> accent must be inside
}

function score(text){
  const toks = tokens(text);
  let fr = 0, en = 0;
  for(const t of toks){
    const lt = t.toLowerCase();
    if(NEUTRAL.has(lt)) continue;
    const isFr = FR_FUNCTION.has(lt) || FR_LEXICON.has(lt) || GEN_FR.has(lt);
    const isEn = EN_FUNCTION.has(lt) || EN_LEXICON.has(lt) || GEN_EN.has(lt) || EN_SUFFIX.test(lt);
    if(isFr && isEn) continue;       // e.g. "a", "on", "sur" — ambiguous, ignore
    if(isFr) fr++;
    if(isEn) en++;
  }
  // Orthographic evidence, independent of vocabulary: elision, accent
  // placement, and French punctuation spacing. Each counts once per fragment,
  // and together they also decide a tie — a fragment that LOOKS French is
  // French even when its words were all unrecognised.
  const hasElision = ELISION.test(text);
  const hasAccent = toks.some(accentEvidence);
  const hasFrPunct = FR_PUNCT_SPACE.test(text);
  const frOrtho = hasElision || hasAccent || hasFrPunct;
  return {
    fr: fr + (hasElision ? 1 : 0) + (hasAccent ? 1 : 0) + (hasFrPunct ? 1 : 0),
    en: en,
    frOrtho: frOrtho
  };
}
// A CITED word is not the language of the sentence citing it. These books
// quote French constantly inside English explanations ('Saying "Bonjour": A
// Golden Rule'), and the quoted word would otherwise outvote the sentence
// around it. So the sentence is scored with its quoted spans removed; only if
// that leaves no evidence at all does the full text get scored instead.
// (Quoted spans are also split out as their own fragments upstream, so the
// cited word still gets read in its own language where the quoting is
// unambiguous — this is only about not letting it hijack its neighbours.)
const QUOTED = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d|\u00ab[^\u00bb\n]*\u00bb/g;
function wordCount(s){ return (s.match(WORD_RE) || []).length; }

function classify(text){
  if(!text || !text.trim()) return 'none';
  for(const [re, lang] of LANG_OVERRIDES){ if(re.test(text.trim())) return lang; }

  const unquoted = text.replace(QUOTED,' ');
  const restWords = wordCount(unquoted);
  const quotedWords = wordCount(text) - restWords;
  // Discount the quotation only when there is a real sentence around it doing
  // the citing. When the quote is most of the fragment — 'Mini response (to
  // "Qu'est-ce qui est important pour réussir dans la vie?")' — the quote IS
  // the content, and scoring the two remaining words instead would hand a long
  // French question to the English voice.
  const citingSentence = restWords >= 2 && restWords >= quotedWords;
  let s = citingSentence ? score(unquoted) : score(text);
  if(s.fr === 0 && s.en === 0) s = score(text);

  if(s.fr === 0 && s.en === 0) return 'none';
  if(s.fr > s.en) return 'fr';
  if(s.en > s.fr) return 'en';
  return s.frOrtho ? 'fr' : 'en';   // tie -> French orthography decides
}

// ============================== text utilities ==============================

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Characters no voice can say usefully. Beyond emoji this has to cover the
// symbol ranges these grammar books actually use: arrows in transformation
// rules ("je -> j'"), the box-drawing and geometric characters of their ASCII
// flowcharts, the clock and triangle markers, and literal bullet glyphs. Left
// in, a flowchart gets read out as "vertical line, down-pointing triangle,
// box drawings light horizontal..." for a couple of minutes.
const SYMBOLS = new RegExp('[' +
  '\\u{1F000}-\\u{1FAFF}' +   // emoji & pictographs
  '\\u{1F1E6}-\\u{1F1FF}' +   // regional indicators (flags)
  '\\u2190-\\u21FF' +         // arrows
  '\\u2300-\\u23FF' +         // misc technical
  '\\u2500-\\u257F' +         // box drawing
  '\\u2580-\\u259F' +         // block elements
  '\\u25A0-\\u25FF' +         // geometric shapes
  '\\u2600-\\u27BF' +         // dingbats
  '\\u2022\\u2023\\u2043\\u00b7' +  // bullet glyphs
  '\\u{FE0F}\\u{20E3}' +      // variation selector, combining keycap
  ']', 'gu');

// What gets handed to the speech engine. The display keeps everything; speech
// drops what no voice can say usefully: the symbols above, and the long runs
// of underscores these books use as fill-in-the-blank slots (an engine either
// says nothing or spells "underscore" eight times) - replaced by an ellipsis,
// which most engines render as a short pause.
function speechText(raw){
  let s = raw.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'');
  s = s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  s = s.replace(SYMBOLS,' ');
  s = s.replace(/[_]{2,}/g,' \u2026 ');
  s = s.replace(/\*+/g,'');
  return s.replace(/\s+/g,' ').trim();
}
// Same cleanup, but used for CLASSIFYING rather than speaking, so the scorer
// never sees emoji or markdown leftovers as words.
function scoreText(raw){ return speechText(raw); }

// ============================== fragmenting one line ==============================

// Bold / italic spans. "_" is intentionally absent: in these books "_____"
// is an answer blank, not emphasis, and treating it as italic markup mangles
// every exercise.
const SPAN_RE = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*/g;
function splitSpans(line){
  const out = [];
  let pos = 0, m;
  SPAN_RE.lastIndex = 0;
  while((m = SPAN_RE.exec(line))){
    if(m.index > pos) out.push({ kind:'plain', raw: line.slice(pos, m.index) });
    if(m[1] !== undefined) out.push({ kind:'bold', raw: m[1] });
    else out.push({ kind:'italic', raw: m[2] || '' });
    pos = m.index + m[0].length;
  }
  if(pos < line.length) out.push({ kind:'plain', raw: line.slice(pos) });
  return out;
}

// Sentence ends: terminal punctuation plus any closing quote/bracket, and
// French's spaced-out "?" / "!" come along for free since we only look left.
const SENT_END = /[.!?\u2026]+["'\u201d\u2019\u00bb)\]]*(?=\s|$)/g;
function splitSentences(text){
  const out = [];
  let last = 0, m;
  SENT_END.lastIndex = 0;
  while((m = SENT_END.exec(text))){
    const end = m.index + m[0].length;
    out.push({ raw: text.slice(last, end), endsSentence: true });
    last = end;
  }
  if(last < text.length) out.push({ raw: text.slice(last), endsSentence: false });
  return out.filter(p => p.raw !== '');
}

// The places these books switch language mid-line with no other warning:
//   " / "            "### Salutations / Greetings"
//   " — "            "**Book One: L'Héritage** — *You are here*"
//   ": "             "Exception: … take -s: le festival, les festivals"
//                    (English-style only — a colon with a space BEFORE it is
//                    French typography, and splitting there would throw away
//                    that signal: "Introduction :" would lose the very thing
//                    that identifies it as French)
//   (parentheses)    "### Les Salutations (Greetings)"
//   "quoted text"    'Saying "Bonjour": A Golden Rule'
//   le/la/les        "Only 3rd person changes: le/la/les (direct)"
// Split on all of them but KEEP the separator as its own fragment, so the
// line can be reassembled character for character.
//
// Two subtleties, both learned from real misreadings:
//   * The parenthesis pattern deliberately refuses to match a parenthetical
//     containing a quote, so that in 'Mini response (to "Qu'est-ce qui est
//     important…?"):' the quoted French is split out on its own instead of
//     being swallowed whole by the parentheses around it.
//   * A slash-joined cluster with NO spaces ("le/la/les", "je/tu/il/ils",
//     "nous/vous") is how the grammar books cite a set of French forms inside
//     an English sentence. Treating it as one fragment lets it be tagged
//     French on its own merits without dragging the English sentence with it.
//     " / " with spaces stays a plain separator — that's the bilingual
//     heading pattern, a different thing.
const SEP_RE = /(\s+\/\s+|\s*[\u2014\u2013]\s*|(?<=\S):\s+|[\w'\u2019\u00e0-\u00ff-]+(?:\/[\w'\u2019\u00e0-\u00ff-]+)+|\([^()"\u201c\u00ab]*\)|"[^"\n]*"|\u201c[^\u201d\n]*\u201d|\u00ab[^\u00bb\n]*\u00bb)/;
// Pure punctuation separators carry no language of their own; a parenthesised,
// quoted or slash-joined fragment does, and gets classified like any other.
const PURE_SEP = /^(?:\s+\/\s+|\s*[\u2014\u2013]\s*|:\s+)$/;
function splitSeparators(text){
  return text.split(SEP_RE).filter(s => s !== '' && s !== undefined)
             .map(s => ({ raw:s, isSep: PURE_SEP.test(s) }));
}

// One source line -> ordered, tagged, merged segments.
// `seed` is the language to fall back to for a fragment with no evidence and
// no tagged neighbour — normally the language of the previous line, so a
// multi-line dialogue or list doesn't flip voice on its untaggable lines.
function segmentLine(line, seed){
  const pieces = [];
  for(const span of splitSpans(line)){
    for(const sent of splitSentences(span.raw)){
      const subs = splitSeparators(sent.raw);
      subs.forEach((sub, i) => {
        const isLast = (i === subs.length - 1);
        pieces.push({
          kind: span.kind,
          raw: sub.raw,
          // Only the fragment that actually carries the terminal punctuation
          // closes the sentence, so merging stops in the right place.
          endsSentence: isLast && sent.endsSentence,
          lang: sub.isSep ? 'none' : classify(scoreText(sub.raw))
        });
      });
    }
  }

  // Merge while the tags agree and no sentence has ended. An untagged
  // fragment joins whatever it is next to rather than becoming its own
  // one-word utterance.
  const segs = [];
  for(const p of pieces){
    const cur = segs[segs.length - 1];
    const compatible = cur && !cur.closed &&
      (p.lang === 'none' || cur.lang === 'none' || cur.lang === p.lang);
    if(compatible){
      cur.pieces.push(p);
      if(cur.lang === 'none') cur.lang = p.lang;
    } else {
      segs.push({ lang: p.lang, pieces: [p], closed: false });
    }
    if(p.endsSentence) segs[segs.length - 1].closed = true;
  }

  // Anything still untagged takes its nearest tagged neighbour's language.
  for(let i = 0; i < segs.length; i++){
    if(segs[i].lang !== 'none') continue;
    let lang = null;
    for(let j = i - 1; j >= 0 && !lang; j--) if(segs[j].lang !== 'none') lang = segs[j].lang;
    for(let j = i + 1; j < segs.length && !lang; j++) if(segs[j].lang !== 'none') lang = segs[j].lang;
    segs[i].lang = lang || seed || DEFAULT_LANG;
  }

  return segs.map(s => {
    const html = s.pieces.map(p => {
      const esc = escapeHtml(p.raw);
      if(p.kind === 'bold') return '<strong>'+esc+'</strong>';
      if(p.kind === 'italic') return '<em>'+esc+'</em>';
      return esc;
    }).join('');
    return { lang: s.lang, html: html, text: speechText(s.pieces.map(p => p.raw).join('')) };
  }).filter(s => s.html.trim() !== '');
}

module.exports = {
  setDefaultLang,
  classify, score, scoreText, speechText, escapeHtml,
  segmentLine, splitSentences, splitSeparators, splitSpans,
  tokens, accentEvidence,
  SEP_RE, PURE_SEP, SENT_END, SYMBOLS,
  FR_FUNCTION, FR_LEXICON, EN_FUNCTION, EN_LEXICON, NEUTRAL,
  get GEN_FR(){ return GEN_FR; }, get GEN_EN(){ return GEN_EN; },
  LANG_OVERRIDES
};
