/* xhtml_parse.js — a small, strict XML parser, enough for these XHTML books.
 *
 * Why not a real HTML parser: these files are genuine XHTML (they start with
 * an XML declaration, every tag is closed, every void element is
 * self-closed), and all four sample books parse as well-formed XML. A strict
 * parser over well-formed input is about eighty lines, has no dependencies,
 * and — the important part — FAILS LOUDLY on anything it doesn't understand
 * instead of silently guessing a tree, which is exactly what a forgiving HTML
 * parser would do. A book that silently loses half a chapter to a tag-soup
 * recovery rule is far worse than a build that stops and says where.
 *
 * Returns a tree of:
 *   { type:'element', name, attrs:{}, children:[] }
 *   { type:'text', text }
 *
 * Entities: the five XML ones plus numeric, plus the handful of HTML named
 * entities these books might pick up later (&nbsp; and friends). An unknown
 * entity throws rather than being passed through, because passing it through
 * means it ends up spoken aloud as "ampersand n b s p semicolon".
 */
'use strict';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00a0', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  laquo: '\u00ab', raquo: '\u00bb', eacute: '\u00e9', egrave: '\u00e8',
  agrave: '\u00e0', ccedil: '\u00e7', ugrave: '\u00f9', acirc: '\u00e2',
  ecirc: '\u00ea', icirc: '\u00ee', ocirc: '\u00f4', ucirc: '\u00fb',
  euml: '\u00eb', iuml: '\u00ef', uuml: '\u00fc', oelig: '\u0153',
  bull: '\u2022', deg: '\u00b0', times: '\u00d7', middot: '\u00b7'
};

function decodeEntities(s, where){
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if(body[0] === '#'){
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if(!isFinite(code)) throw new Error('Bad numeric entity '+m+' '+where);
      return String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body];
    if(v === undefined) throw new Error('Unknown entity '+m+' '+where+
      ' — add it to NAMED_ENTITIES in xhtml_parse.js');
    return v;
  });
}

// Elements that may legitimately appear unclosed even in XHTML-ish input.
const VOID = new Set(['br','hr','img','meta','link','input','col','area','base','source','wbr']);

function parseXhtml(src, file){
  // Strip what carries no content but would confuse the element scanner.
  let s = src.replace(/^\uFEFF/, '')
             .replace(/<\?[\s\S]*?\?>/g, '')          // XML declaration / PIs
             .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '')
             .replace(/<!--[\s\S]*?-->/g, '');        // comments

  const root = { type:'element', name:'#root', attrs:{}, children:[] };
  const stack = [root];
  const where = () => 'in ' + (file || 'input');
  let i = 0;

  function lineAt(pos){ return src.slice(0, pos).split('\n').length; }

  while(i < s.length){
    const lt = s.indexOf('<', i);
    if(lt < 0){ pushText(s.slice(i)); break; }
    if(lt > i) pushText(s.slice(i, lt));

    const gt = findTagEnd(s, lt);
    if(gt < 0) throw new Error('Unterminated tag at line '+lineAt(lt)+' '+where());
    const raw = s.slice(lt + 1, gt);
    i = gt + 1;

    if(raw[0] === '/'){                                  // closing tag
      const name = raw.slice(1).trim().toLowerCase();
      // Walk back to the matching open element. Anything still open above it
      // was never closed, which in well-formed input cannot happen — so say
      // so rather than quietly re-parenting the rest of the book.
      let depth = -1;
      for(let k = stack.length - 1; k > 0; k--) if(stack[k].name === name){ depth = k; break; }
      if(depth < 0) throw new Error('Closing </'+name+'> with no opening tag, line '+lineAt(lt)+' '+where());
      if(depth !== stack.length - 1){
        throw new Error('Mismatched tags: </'+name+'> closes while <'+
          stack[stack.length-1].name+'> is still open, line '+lineAt(lt)+' '+where());
      }
      stack.pop();
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const inner = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([A-Za-z_][\w.:-]*)/.exec(inner);
    if(!nameMatch) throw new Error('Unreadable tag "<'+raw.slice(0,40)+'" at line '+lineAt(lt)+' '+where());
    const name = nameMatch[1].toLowerCase();
    const attrs = {};
    const attrRe = /([A-Za-z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am;
    while((am = attrRe.exec(inner.slice(nameMatch[0].length)))){
      attrs[am[1].toLowerCase()] = decodeEntities(am[3] !== undefined ? am[3] : am[4], where());
    }
    const el = { type:'element', name: name, attrs: attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if(!selfClosing && !VOID.has(name)) stack.push(el);
  }

  if(stack.length !== 1){
    throw new Error('Unclosed <'+stack[stack.length-1].name+'> at end of file '+where());
  }
  return root;

  function pushText(t){
    if(!t) return;
    stack[stack.length - 1].children.push({ type:'text', text: decodeEntities(t, where()) });
  }
}

// A ">" inside a quoted attribute value must not end the tag.
function findTagEnd(s, start){
  let q = null;
  for(let k = start + 1; k < s.length; k++){
    const c = s[k];
    if(q){ if(c === q) q = null; continue; }
    if(c === '"' || c === "'"){ q = c; continue; }
    if(c === '>') return k;
  }
  return -1;
}

function findElement(node, name){
  if(node.type === 'element' && node.name === name) return node;
  for(const c of (node.children || [])){
    const f = findElement(c, name);
    if(f) return f;
  }
  return null;
}

module.exports = { parseXhtml, findElement, decodeEntities };
