import sys
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS=None
out=sys.argv[1]; files=sys.argv[2:]
tw,th=480,270; cols=3; rows=(len(files)+cols-1)//cols
S=Image.new('RGB',(cols*tw,rows*(th+16)),'#444')
d=ImageDraw.Draw(S)
for i,f in enumerate(files):
    im=Image.open(f).convert('RGB'); im.thumbnail((tw,th))
    x,y=(i%cols)*tw,(i//cols)*(th+16)
    S.paste(im,(x,y+16)); d.text((x+2,y+2),f"{i}:{f.split('/')[-1][:40]} {Image.open(f).size}",fill='white')
S.save(out)
