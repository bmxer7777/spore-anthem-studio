import numpy as np, struct, wave
T=[0.0,0.9375,1.796875,1.53125,0.0,0.0,-0.8125,-0.859375]
def dec_frame(fr):
    out=np.zeros(128,np.int16); n=0
    for g in range(4):
        h=struct.unpack_from('<I',fr,g*4)[0]
        c1=T[h&0xF if (h&0xF)<4 else 0]; c2=T[(h&0xF)+4 if (h&0xF)<4 else 4]
        h2=np.int16(h&0xFFF0).item() if False else ((h&0xFFF0) ^ 0x8000) - 0x8000
        h1=(((h>>16)&0xFFF0) ^ 0x8000) - 0x8000
        sh=(h>>16)&0xF
        out[n]=h2; out[n+1]=h1; n+=2
        for row in range(15):
            b=fr[16+row*4+g]
            for nib in (b>>4, b&0xF):
                s=((nib<<12)^0x8000)-0x8000 if False else (((nib<<12)&0xFFFF)^0x8000)-0x8000
                s=(s>>sh)+h1*c1+h2*c2
                s=int(max(-32768,min(32767,round(s) if False else int(s))))
                out[n]=s; n+=1; h2=h1; h1=s
    return out
def decode_snr(d):
    codec=d[0]; ch=(d[1]>>2)+1; rate=int.from_bytes(d[2:4],'big')
    w=int.from_bytes(d[4:8],'big'); ns=w&0x1FFFFFFF; loop=bool(w&0x20000000); kind=w>>30
    p=8; loopstart=None
    if loop: loopstart=int.from_bytes(d[8:12],'big'); p+=4
    if kind==2: ns=int.from_bytes(d[p:p+4],'big'); p+=4  # gigasample: only the prefetch part is in this file
    if codec!=4: raise ValueError('codec %d not XAS'%codec)
    chans=[[] for _ in range(ch)]
    while p<len(d):
        bh=int.from_bytes(d[p:p+4],'big'); bsize=bh&0x00FFFFFF; flag=bh>>24
        q=p+8; end=p+bsize
        while q+0x4c*ch<=end:
            for c in range(ch): chans[c].append(dec_frame(d[q+c*0x4c:q+(c+1)*0x4c]))
            q+=0x4c*ch
        p=end
        if flag&0x80: break
    a=np.stack([np.concatenate(c)[:ns] for c in chans],1)
    return a,rate,loopstart
def write_wav(path,a,rate):
    w=wave.open(path,'wb'); w.setnchannels(a.shape[1]); w.setsampwidth(2); w.setframerate(rate); w.writeframes(a.astype('<i2').tobytes()); w.close()
