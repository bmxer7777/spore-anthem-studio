import struct
TYPES={0x01:('bool',1),0x05:('u8',1),0x09:('i32',4),0x0A:('u32',4),0x0D:('float',4),0x12:('string8',None),0x13:('string16',None),0x20:('key',12),0x22:('text',None),0x30:('vec2',8),0x31:('vec3',12),0x32:('colorRGB',12),0x33:('vec4',16),0x38:('transform',None),0x39:('bbox',24),0x02:('i8',1),0x03:('u8b',1),0x06:('i16',2),0x07:('u16',2),0x0B:('i64',8),0x0C:('u64',8),0x0E:('double',8)}
def val(t,b,p,size=None):
    n,sz=TYPES.get(t,('?',None))
    if n=='bool': return b[p]!=0,1
    if n in('u8','u8b'): return b[p],1
    if n=='i32': return struct.unpack_from('>i',b,p)[0],4
    if n=='u32': return struct.unpack_from('>I',b,p)[0],4
    if n=='float': return struct.unpack_from('>f',b,p)[0],4
    if n=='key':
        # resource keys are stored little-endian (instance, type, group), unlike the rest of the file
        i,t2,g=struct.unpack_from('<III',b,p); return ('%08x!%08x.%08x'%(g,i,t2)),12
    if n=='string8':
        L=struct.unpack_from('>I',b,p)[0]; return b[p+4:p+4+L].decode('latin1'),4+L
    if n=='string16':
        L=struct.unpack_from('>I',b,p)[0]; return b[p+4:p+4+2*L].decode('utf-16-le'),4+2*L
    if n in('vec2','vec3','vec4','colorRGB','bbox'):
        k=TYPES[t][1]//4; return list(struct.unpack_from('>%df'%k,b,p)),TYPES[t][1]
    if n=='text':
        tid,iid=struct.unpack_from('<II',b,p); s=b[p+8:p+8+512].decode('utf-16-le').split('\0')[0]; return ('text %08x %08x %s'%(tid,iid,s)),520
    raise ValueError('type %x'%t)
def parse(b):
    cnt=struct.unpack_from('>I',b,0)[0]; p=4; out=[]
    for _ in range(cnt):
        k,t,fl=struct.unpack_from('>IHH',b,p); p+=8
        if fl&0x30:
            n,isz=struct.unpack_from('>II',b,p); p+=8; arr=[]
            for i in range(n):
                if TYPES.get(t,('?',0))[0] in ('string8','string16','key','text'):
                    v,s=val(t,b,p)
                else:
                    v,_=val(t,b,p); s=isz
                arr.append(v); p+=s
            out.append((k,TYPES.get(t,('?',))[0],arr))
        else:
            v,s=val(t,b,p); s=16 if TYPES.get(t,('',))[0]=='key' else s; p+=s; out.append((k,TYPES.get(t,('?',))[0],v))
    return out
