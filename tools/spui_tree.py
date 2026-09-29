import sys,json; sys.path.insert(0,__import__('os').path.dirname(__file__))
from spore.spui import parse, Designer
D=Designer()
d=parse(open(sys.argv[1],'rb').read(),D)
base=d['reference_base']; els=d['elements']
def ref(i): return els[i-base] if i is not None and i>=base else None
def v(e,k):
    p=e['props'].get(k); return p['value'] if isinstance(p,dict) else p
def show(e,depth=0,seen=set()):
    if e['index'] in seen: return
    seen.add(e['index'])
    cid=v(e,'ControlID'); area=v(e,'Area'); cap=v(e,'Caption')
    s='  '*depth+'%s #%d id=%s area=%s'%(e['class'],e['index'],('%08x'%cid[0]) if cid else '-',[round(x) for x in area[0]] if area else '-')
    if cap: s+=' cap=%s'%cap
    fd=v(e,'FillDrawable')
    if fd:
        de=ref(fd[0])
        if de:
            img=v(de,'Image')
            s+=' draw=%s'%de['class']
            if img:
                ie=ref(img[0])
                if ie and v(ie,'Atlas'):
                    a=v(ie,'Atlas')[0]; s+=' img=atlas#%s uv=%s'%(a, [round(x,3) for x in v(ie,'UV Coordinates')[0]])
    for wp in (v(e,'WinProcs') or []):
        we=ref(wp)
        if we and we['class']=='Tooltip':
            s+=' tip=%s'%v(we,'Tooltip string')
        elif we: s+=' proc=%s'%we['class']
    print(s)
    for c in (v(e,'Children') or []):
        ce=ref(c)
        if ce: show(ce,depth+1,seen)
for e in els:
    if e['root']: show(e)
