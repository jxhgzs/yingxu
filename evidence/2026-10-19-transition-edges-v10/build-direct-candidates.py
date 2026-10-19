from pathlib import Path
import re
root=Path('artifacts/qa/transitions-v10')
for kind in ['wipe','circle']:
 original=Path('artifacts/qa/transitions-v9/product-'+kind+'/filter.txt').read_text()
 for mode,flags in [('direct-bilinear','bilinear'),('direct-accurate','accurate_rnd+full_chroma_int')]:
  lines=[]
  for line in original.split(';\n'):
   m=re.search(r'\[visualtransition1([ab])\]$',line)
   if m:
    side=m.group(1);prefix=line.split(',setparams=colorspace=')[0];lines.append(prefix+f',setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv,scale=out_color_matrix=bt709:out_range=tv:flags={flags},format=yuv420p[transition1{side}yuv]')
   elif re.search(r'\[transition1[ab](base|premult)\]',line):continue
   else:lines.append(line)
  text=';\n'.join(lines)
  assert 'premult' not in text and 'visualtransition1' not in text
  (root/f'{kind}-{mode}.filter').write_text(text)
print('4 independent side-conversion candidates; original base stack, blend mask/time and encoder retained')
