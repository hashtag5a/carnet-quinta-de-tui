# Fondo «Patrocinadores» del panel (photocall). Logos en blanco en logos/: el número delante es el nivel
# (1 = principales: Concepto by Persa, S.E.T.A., MensaTui; 2 = Casa Pote, Marangel, Alipa, Inglesiños, Cluber; 3 = resto).
# Para cambiar patrocinadores: añadir o quitar PNG blancos con fondo transparente en logos/ y ejecutar python3 tools/patrocinadores/fondo.py
import os, itertools
from PIL import Image, ImageDraw, ImageFilter
D=os.path.dirname(os.path.abspath(__file__))
logos={1:[],2:[],3:[]}
for f in sorted(os.listdir(D+'/logos')):
    t=int(f[0]); logos[t].append((f[2:-4], Image.open(D+'/logos/'+f)))
order1=['persa','seta','mensatui']
logos[1].sort(key=lambda x: order1.index(x[0]))
CFG={1:(150,330,0.34,215),2:(92,230,0.25,128),3:(60,190,0.17,84)}  # alto máx, ancho máx, opacidad, tamaño (raíz del área)
def fit(im,t,k):
    h,mw,_,sz=CFG[t]; h*=k; mw*=k; sz*=k
    s=min(h/im.height, mw/im.width, sz/((im.width*im.height)**0.5)); return im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))), Image.LANCZOS)
def put(base,im,x,y,op):
    a=im.split()[3].point(lambda v:int(v*op)); im2=im.copy(); im2.putalpha(a); base.alpha_composite(im2,(int(x),int(y)))
def fondo(W,H,path):
    k=W/1080
    base=Image.new('RGBA',(W,H),(12,12,12,255))
    # leve luz superior como el fondo estándar
    g=Image.new('L',(W,H),0); dg=ImageDraw.Draw(g)
    for r in range(int(H*0.65),0,-8): dg.ellipse((W/2-r,-r,W/2+r,r),fill=int(26*(1-r/(H*0.65))))
    base.alpha_composite(Image.merge('RGBA',(g,g,g,g.point(lambda v:v*6 if v*6<255 else 255))))
    t2=itertools.cycle([l for l in logos[2]]); t3=itertools.cycle([l for l in logos[3]])
    y=int(30*k); row=0; rot=0
    while y < H:
        if row%2==0:
            # fila de los tres principales
            seq=logos[1][rot%3:]+logos[1][:rot%3]; rot+=1
            ims=[fit(im,1,k) for _,im in seq]
            rh=int(CFG[1][0]*k); gap=(W-sum(i.width for i in ims))/len(ims)
            x=gap/2 + (-gap/4 if row%4==0 else gap/4)
            for im in ims:
                put(base,im,x,y+(rh-im.height)/2,CFG[1][2]); x+=im.width+gap
            y+=rh+int(48*k)
        else:
            # fila mezclada: segundos y resto
            rh=int(CFG[2][0]*k); x=int((20 if row%4==1 else 70)*k); pat=[2,3,3,2,3,3]
            items=[]
            for t in itertools.cycle(pat):
                name,im=next(t2) if t==2 else next(t3); im=fit(im,t,k)
                if x+im.width>W-int(20*k): break
                items.append((t,im,x)); x+=im.width+int(46*k)
            spare=(W-int(20*k))-x+int(46*k)
            for i,(t,im,xx) in enumerate(items):
                put(base,im,xx+spare*(i+0.5)/len(items),y+(rh-im.height)/2,CFG[t][2])
            y+=rh+int(48*k)
        row+=1
    base.convert('RGB').save(path,quality=90)
OUT=os.path.join(D,'..','..','docs','panel','fondos')
for n,(W,H) in {'story':(1080,1920),'post':(1080,1350),'cuadrado':(1080,1080)}.items():
    fondo(W,H,os.path.join(OUT,f'patrocinadores-{n}.jpg')); print(n)
