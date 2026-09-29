"""Analysis helper: for an object class, list what connects into it and what it feeds.

usage: python tools/pdscan.py <class>
"""
import collections
import glob
import re
import sys

STMT_SPLIT = re.compile(r'(?<!\\);\s*\n')


def parse_canvases(text):
    stm = [s.strip().replace('\r', '').replace('\n', ' ').rstrip(';') for s in STMT_SPLIT.split(text)]
    stack, out = [], []
    for s in stm:
        if s.startswith('#N canvas'):
            stack.append({'objs': [], 'conns': []})
        elif s.startswith('#X restore'):
            c = stack.pop()
            out.append(c)
            stack[-1]['objs'].append(('obj', ' '.join(s.split()[4:])))
        elif s.startswith('#X connect'):
            a = s.split()
            stack[-1]['conns'].append(tuple(int(x) for x in a[2:6]))
        elif s.startswith('#X '):
            parts = s.split(None, 4)
            kind = parts[1]
            if kind in ('obj', 'msg', 'floatatom', 'symbolatom', 'text'):
                stack[-1]['objs'].append((kind, parts[4] if len(parts) > 4 else ''))
            elif kind == 'array':
                stack[-1]['objs'].append(('array', parts[2] if len(parts) > 2 else ''))
    if stack:
        out.append(stack[0])
    return out


def main(cls, pattern='original_assets/raw/audio/pd/Spore_Audio*_*.pd'):
    ins, outs, args = collections.Counter(), collections.Counter(), collections.Counter()
    for fn in glob.glob(pattern):
        for c in parse_canvases(open(fn, 'rb').read().decode('latin1')):
            objs = c['objs']
            for i, (k, t) in enumerate(objs):
                if k != 'obj' or (t.split() or [''])[0] != cls:
                    continue
                args[' '.join(t.split()[1:])] += 1
                for a, ao, b, bi in c['conns']:
                    if b == i and a < len(objs):
                        sk, st = objs[a]
                        ins[(bi, sk, st[:70] if sk == 'msg' else (st.split() or ['?'])[0], ao)] += 1
                    if a == i and b < len(objs):
                        dk, dt = objs[b]
                        outs[(ao, dk, dt[:40] if dk == 'msg' else ' '.join(dt.split()[:3]), bi)] += 1
    print('ARGS', args.most_common(40))
    print('IN (inlet, kind, text, src outlet)')
    for k, n in ins.most_common(120):
        print('  ', k, n)
    print('OUT (outlet, kind, text, dst inlet)')
    for k, n in outs.most_common(40):
        print('  ', k, n)


if __name__ == '__main__':
    main(*sys.argv[1:])


def graph(fn, canvas_contains=None):
    """Print each canvas as 'index: text  -> dst:inlet' lines."""
    for c in parse_canvases(open(fn, 'rb').read().decode('latin1')):
        txt = ' '.join(t for _, t in c['objs'])
        if canvas_contains and canvas_contains not in txt:
            continue
        print('=' * 20)
        for i, (k, t) in enumerate(c['objs']):
            if k == 'text' or t.startswith('bng ') or t.startswith('tgl ') or k in ('floatatom', 'symbolatom'):
                outs = ['%d>%d:%d' % (ao, b, bi) for a, ao, b, bi in c['conns'] if a == i]
                if k == 'text' or not outs:
                    continue
            outs = ['%d>%d:%d' % (ao, b, bi) for a, ao, b, bi in c['conns'] if a == i]
            print('%3d %s%s  %s' % (i, '' if k == 'obj' else k.upper() + ' ', t[:90], ' '.join(outs)))
