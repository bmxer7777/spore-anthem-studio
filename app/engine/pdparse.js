// Parser for Pure Data patch text (as shipped inside Spore's packages).
//
// A patch is a sequence of records terminated by an unescaped ';'. Inside records,
// '\,' '\;' and '\$' are escaped message-box separators / dollar signs.
// Produces a tree of canvases whose `items` keep Pd's object numbering
// (every #X obj/msg/text/atom/restore occupies one index, exactly like Pd).

export const COMMA = { sep: ',' };
export const SEMI = { sep: ';' };

// Split text into records of raw tokens. Tokens keep their escapes.
function tokenize(text) {
  const records = [];
  let rec = [];
  let tok = '';
  let esc = false;
  const flushTok = () => { if (tok.length) { rec.push(tok); tok = ''; } };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) { tok += '\\' + c; esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === ';') { flushTok(); records.push(rec); rec = []; continue; }
    if (c === ',') { flushTok(); rec.push(','); continue; }
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { flushTok(); continue; }
    tok += c;
  }
  flushTok();
  if (rec.length) records.push(rec);
  return records;
}

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// Convert a raw token into an atom: number, string, separator, or dollar template.
export function atomize(tok) {
  if (tok === '\\,') return COMMA;
  if (tok === '\\;') return SEMI;
  if (NUM.test(tok)) return parseFloat(tok);
  let s = tok.replace(/\\(.)/g, '$1');
  if (/\$\d/.test(s)) return { dollar: s };  // "$1", "$0-foo", "foo-$2"
  return s;
}

// Raw object-box args: keep "\$n" as dollar templates for creation-time substitution.
function objArgs(tokens) { return tokens.map(atomize); }

export function parsePatch(text) {
  const records = tokenize(text);
  const stack = [];
  let root = null;
  let lastItem = null;
  for (const r of records) {
    if (!r.length) continue;
    const head = r[0];
    if (head === '#N' && r[1] === 'canvas') {
      const c = { items: [], conns: [], name: r[6] !== undefined ? r[6] : null };
      if (!root) root = c;
      stack.push(c);
      continue;
    }
    if (head === '#X') {
      const kind = r[1];
      const cur = stack[stack.length - 1];
      if (kind === 'restore') {
        const sub = stack.pop();
        const parent = stack[stack.length - 1];
        const x = parseFloat(r[2]), y = parseFloat(r[3]);
        // "#X restore x y pd name" or "#X restore x y graph"
        const item = { kind: 'sub', x, y, canvas: sub, args: objArgs(r.slice(5)), cls: r[4] };
        parent.items.push(item);
        lastItem = item;
        continue;
      }
      if (kind === 'connect') {
        cur.conns.push([+r[2], +r[3], +r[4], +r[5]]);
        continue;
      }
      if (kind === 'obj') {
        const x = parseFloat(r[2]), y = parseFloat(r[3]);
        const toks = r.slice(4);
        const item = { kind: 'obj', x, y, cls: toks.length ? toks[0].replace(/\\(.)/g, '$1') : '',
                       args: objArgs(toks.slice(1)), raw: toks };
        cur.items.push(item);
        lastItem = item;
        continue;
      }
      if (kind === 'msg') {
        const item = { kind: 'msg', x: +r[2], y: +r[3], atoms: r.slice(4).map(t => t === ',' ? COMMA : atomize(t)) };
        cur.items.push(item);
        lastItem = item;
        continue;
      }
      if (kind === 'floatatom' || kind === 'symbolatom') {
        const item = { kind, x: +r[2], y: +r[3], args: r.slice(4) };
        cur.items.push(item);
        lastItem = item;
        continue;
      }
      if (kind === 'text') {
        cur.items.push({ kind: 'text', x: +r[2], y: +r[3] });
        continue;
      }
      if (kind === 'array') {
        // "#X array name size float flags" lives inside a graph canvas; not an indexed item.
        cur.arrays = cur.arrays || [];
        const arr = { name: r[2], size: +r[3] };
        cur.arrays.push(arr);
        lastItem = arr;
        continue;
      }
      // coords, declare, etc.: no index
      continue;
    }
    if (head === '#C' && lastItem) {
      // EA/Max-style embedded coll data: "#C list key v1 v2 ..."
      (lastItem.coll = lastItem.coll || []).push(r.slice(2).map(atomize));
      continue;
    }
    if (head === '#A' && lastItem) {
      if (r[1] === 'setproperties') continue;
      // "#A start v1 v2 ..." array contents
      (lastItem.data = lastItem.data || []).push({ start: +r[1], values: r.slice(2).map(Number) });
      continue;
    }
  }
  return root;
}
