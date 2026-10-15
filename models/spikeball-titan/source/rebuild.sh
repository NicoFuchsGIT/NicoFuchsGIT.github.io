set -e
cd "$(dirname "$0")"; S=/root/.claude/skills/img2threejs
python3 build_spec.py
for m in rim-yellow net-black net-sheet plastic-black logo-yellow; do python3 $S/forge/stage1_intake/extract_pbr_evidence.py crops/$m.png --out-dir pbr --material-id $m --target-threshold 0.7 --spec object-sculpt-spec.json --in-place >/dev/null 2>&1; python3 $S/forge/stage1_intake/analyze_texture.py crops/$m.png --spec object-sculpt-spec.json --material-id $m --in-place >/dev/null 2>&1; done
python3 - <<'PY'
import json
s=json.load(open('object-sculpt-spec.json'))
R={'rim-yellow':0.62,'net-black':0.85,'net-sheet':0.9,'plastic-black':0.45,'logo-yellow':0.6}
for m in s['materials']:
    m['metalness']={'base':0.0,'variation':0.0}; m['roughness']['base']=R[m['id']]; m['clearcoat']=0.0
    m['finishOverrideNote']="Classifier suggested metal; reference is polymer/nylon (dielectric) so metalness forced to 0 after visual review."
json.dump(s,open('object-sculpt-spec.json','w'),indent=1)
PY
python3 - <<'PY'
# flat-paint materials: keep extracted evidence under pbr_extracted/, ship uniform solid maps (solid albedo for flat paint)
import json, os, shutil
from PIL import Image
s=json.load(open('object-sculpt-spec.json'))
os.makedirs('pbr_extracted',exist_ok=True)
for m in s['materials']:
    mid=m['id']
    for ch in ('albedo','roughness','height','normal','ao'):
        f=f'pbr/{mid}_{ch}.png'
        if os.path.exists(f) and not os.path.exists(f'pbr_extracted/{mid}_{ch}.png'): shutil.copy(f,f'pbr_extracted/{mid}_{ch}.png')
    col=tuple(int(m['baseColor'][i:i+2],16) for i in (1,3,5))
    rough=int(255*m['roughness']['base'])
    for ch,c in (('albedo',col),('roughness',(rough,)*3),('height',(128,)*3),('normal',(128,128,255)),('ao',(255,)*3)):
        Image.new('RGB',(8,8),c).save(f'pbr/{mid}_{ch}.png')
    if mid in ('plastic-black','rim-yellow','logo-yellow') and os.environ.get('GRAIN','1')=='1':
        import numpy as np
        rng=np.random.default_rng({'plastic-black':7,'rim-yellow':11,'logo-yellow':13}[mid])
        N=256
        def blur(x,k):
            for _ in range(k):
                x=(x+np.roll(x,1,0)+np.roll(x,-1,0)+np.roll(x,1,1)+np.roll(x,-1,1))/5
            return x
        h=blur(rng.random((N,N)),2); h=(h-h.min())/(h.max()-h.min())           # fine grain height, tileable via roll
        amp={'plastic-black':3.0,'rim-yellow':2.0,'logo-yellow':1.0}[mid]
        gx=(np.roll(h,-1,1)-np.roll(h,1,1))*amp; gy=(np.roll(h,-1,0)-np.roll(h,1,0))*amp
        nz=np.ones_like(h); ln=np.sqrt(gx**2+gy**2+nz**2)
        nrm=np.stack([(-gx/ln*0.5+0.5),(-gy/ln*0.5+0.5),(nz/ln*0.5+0.5)],-1)
        Image.fromarray((nrm*255).astype('uint8')).save(f'pbr/{mid}_normal.png',optimize=True)
        Image.fromarray((h*255).astype('uint8')).save(f'pbr/{mid}_height.png',optimize=True)
        rv=np.clip(rough/255+(h-0.5)*0.16,0,1); Image.fromarray((rv*255).astype('uint8')).save(f'pbr/{mid}_roughness.png',optimize=True)
        ao=1-0.25*blur(rng.random((N,N)),4); ao=(ao-ao.min())/(ao.max()-ao.min())*0.12+0.88
        Image.fromarray((ao*255).astype('uint8')).save(f'pbr/{mid}_ao.png',optimize=True)
    grain = mid in ('plastic-black','rim-yellow','logo-yellow') and os.environ.get('GRAIN','1')=='1'
    src = 'procedural-seeded-grain (flat-paint colour)' if grain else 'flat-paint-uniform'
    for holder,key in ((m.get('albedo'),'map'),(m.get('roughness'),'map'),(m.get('normal'),'map'),(m.get('normal'),'heightSource')):
        if isinstance(holder,dict) and isinstance(holder.get(key),dict): holder[key]['source']=src
    rp=m.get('referencePbr')
    if isinstance(rp,dict):
        for ch,e in (rp.get('maps') or {}).items():
            if isinstance(e,dict): e['source']=src
    if isinstance(m.get('referencePbr'),dict): m['referencePbr']['flatPaintNote']='uniform solid maps shipped for flat paint; raw extracted maps kept in pbr_extracted/ as provenance'
# repo-relative texture URLs + scrub scratch paths
PFX='models/spikeball-titan/pbr/'
def fix(o):
    if isinstance(o,dict):
        for k,v in list(o.items()):
            if k in ('path','url') and isinstance(v,str) and v.endswith('.png') and '_' in os.path.basename(v) and os.path.basename(v).split('_')[-1][:-4] in ('albedo','roughness','height','normal','ao'):
                o[k]=PFX+os.path.basename(v)
            elif k=='sourceImage' and isinstance(v,str) and v.startswith('/'): o[k]='crops/'+os.path.basename(v)
            else: fix(v)
    elif isinstance(o,list):
        for v in o: fix(v)
fix(s)
json.dump(s,open('object-sculpt-spec.json','w'),indent=1)
PY
python3 $S/forge/stage2_spec/validate_sculpt_spec.py object-sculpt-spec.json --strict-quality | head -8
