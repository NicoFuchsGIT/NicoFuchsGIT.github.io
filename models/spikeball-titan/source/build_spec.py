import json, copy, math
s = json.load(open('object-sculpt-spec.json'))
tmpl = copy.deepcopy(s['componentTree'][0])
mt = copy.deepcopy(s['materials'][0])

def mat(id, name, color, rough, metal=0.0, secondary=None, notes=""):
    m = copy.deepcopy(mt)
    m.update(id=id, name=name, baseColor=color, color=color)
    m['albedo'] = {"dominant": color, "secondary": secondary or [color], "samplingNotes": notes or "sampled from reference crop"}
    m['colorVariation'] = {"palette": [color], "pattern": "flat", "amplitude": 0.02, "heightCorrelation": 0.0}
    m['roughness'] = dict(m['roughness'], base=rough, variation=0.05)
    m['metalness'] = {"base": metal, "variation": 0.0}
    m['localOverrides'] = []
    m['notes'] = notes
    return m

mats = [
  mat("rim-yellow", "Yellow rim band (polymer wrap)", "#F0C000", 0.62, secondary=["#D9AE00", "#FFDD3C"], notes="vivid yellow, satin"),
  mat("net-black", "Black nylon net cord", "#111111", 0.85, secondary=["#1E1E1E"], notes="matte cord"),
  mat("net-sheet", "Net sheet (open mesh, mostly see-through)", "#111111", 0.85, notes="net field between cords; opacity ~0.5 approximates the optical density of a fine black mesh seen at distance (open holes + cords)"),
  mat("plastic-black", "Black injection-moulded plastic", "#161616", 0.42, secondary=["#262626"], notes="brackets and feet, slight sheen"),
  mat("logo-yellow", "Yellow printed logo", "#F0C000", 0.6, notes="flat paint decal"),
]
# local overrides so every material carries a wear/sheen entry
mats[0]['localOverrides'] = [{"id": "rim-edge-sheen", "region": "rim top edge", "roughness": 0.4, "note": "lower roughness on top bead"}]
mats[2]['localOverrides']=[{'id':'net-sheet-holes','region':'net field','roughness':0.9,'note':'open holes dominate'}]
mats[1]['localOverrides'] = [{"id": "knot-darkening", "region": "cord crossings", "roughness": 0.9, "note": "knots read darker/rougher"}]
mats[3]['localOverrides'] = [{"id": "foot-sheen", "region": "foot front face", "roughness": 0.35, "note": "glossier moulded faces"}]
mats[4]['localOverrides'] = [{"id": "decal-flat", "region": "logo faces", "roughness": 0.6, "note": "print sits flat on plastic"}]

comps = []
def comp(id, name, level, role, prim, dims, pos, mat_id, parent="root", rot=(0,0,0), desc=None, rationale="", topo="assembled-solid", conf=0.7, feats=None, fixrot=False):
    c = copy.deepcopy(tmpl)
    c.update(id=id, name=name, level=level, role=role, primitive=prim, parent=parent, material=mat_id, materialLayers=[mat_id],
             topologyClass=topo, topologyRationale=rationale or f"{name}: simple solid of revolution/box form per surface_topology decision tree",
             confidence=conf, fidelityTier={"macro":"blockout","meso":"structural-pass","micro":"form-refinement"}[level])
    c['dimensions'] = dict(width=dims[0], height=dims[1], depth=dims[2], units="meters", confidence=conf)
    if prim=='torus' and not fixrot: rot=(math.pi/2,0,0)
    c['transform'] = dict(position=list(pos), rotation=list(rot))
    if desc: c['geometryDescriptor'].update(desc)
    c['localFeatures'] = feats or []
    c['attachment'] = None
    c['actionProfile']['animationRole'] = role
    comps.append(c)
    return c

root = comp("root", "Net disc", "macro", "body", "cylinder", (0.90, 0.004, 0.90), (0, 0.11, 0), "net-black",
            parent=None, rationale="Flat taut net disc: thin cylinder reads as the tensioned inner net surface.", topo="assembled-solid", conf=0.75)
root['attachment'] = None
R = 0.455
HB=0.06   # rim band half-height
comp("rim-band", "Yellow rim band", "macro", "ring", "lathe", (1.0, 1.0, 1.0), (0,0.02,0), "rim-yellow",
     desc={"latheProfile": {"points": [[0.445,-HB],[0.465,-HB],[0.465,HB],[0.445,HB],[0.445,-HB]], "segments": 96}},
     rationale="Solid of revolution about the vertical axis (lathe) - radial symmetry, constant section.", topo="assembled-solid", conf=0.8)
comp("rim-bead-top", "Rim top bead", "meso", "ring", "torus", (1.0,1.0,1.0), (0,0.08,0), "rim-yellow",
     desc={"torusTubeRatio": 0.045}, rationale="Rolled lip following the rim circle: torus.", topo="assembled-solid")
comp("rim-bead-bottom", "Rim bottom bead", "meso", "ring", "torus", (1.0,1.0,1.0), (0,-0.04,0), "rim-yellow",
     desc={"torusTubeRatio": 0.045}, rationale="Rolled lip following the rim circle: torus.", topo="assembled-solid")
for i, f in enumerate((0.16, 0.30, 0.44, 0.58, 0.72, 0.86)):
    comp(f"net-ring-{i}", f"Net concentric cord {i}", "meso", "net", "torus", (f,f,f), (0,0,0), "net-black",
         desc={"torusTubeRatio": 0.012}, rationale="Concentric net cord as a thin torus.", topo="assembled-solid")
comp("net-edge-binding", "Net edge binding", "meso", "net", "torus", (0.97,0.97,0.97), (0,0.004,0), "net-black",
     desc={"torusTubeRatio": 0.02}, rationale="Black binding where net meets rim top: torus.", topo="assembled-solid",
     feats=[{"id":"net-rim-wrap","type":"fiber","note":"coarse diamond mesh wrapped over the rim"}])
BM=0.012   # bracket-mount height above net plane (screw heads sit on the top plates)
comp("bracket-mount", "Bracket mount frame", "macro", "mount", "box", (0.01,0.001,0.01), (0,BM,0), "plastic-black",
     rationale="Invisible-scale pivot carrying the 4 corner brackets.", topo="assembled-solid")
comp("foot-mount", "Foot mount frame", "macro", "mount", "box", (0.01,0.001,0.01), (0,-0.11,0), "plastic-black",
     rationale="Invisible-scale pivot at ground level carrying the 4 feet.", topo="assembled-solid")
def phi(a): return round(math.pi/2-math.radians(a),4)
NAMES={0:'e',90:'s',180:'w',270:'n'}
for a in (0,90,180,270):
    n=NAMES[a]; ar=math.radians(a)
    rin=0.395
    comp(f"foot-{n}", f"Wedge foot ({n})", "macro", "foot", "extrude", (1,1,1), (round(rin*math.cos(ar),4),0,round(rin*math.sin(ar),4)), "plastic-black",
         parent="foot-mount", rot=(0,phi(a),0),
         desc={"profile2D":{"points":[[-0.085,0],[0.085,0],[0.062,0.10],[-0.062,0.10]],"depth":0.1}},
         rationale="Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", topo="assembled-solid", conf=0.65)
    rw=0.466
    comp(f"bracket-wall-{n}", f"Bracket wall plate ({n})", "macro", "bracket", "extrude", (1,1,1), (round(rw*math.cos(ar),4),0,round(rw*math.sin(ar),4)), "plastic-black",
         parent="bracket-mount", rot=(0,phi(a),0),
         desc={"profile2D":{"points":[[-0.075,-0.057],[0.075,-0.057],[0.085,0.073],[-0.085,0.073]],"depth":0.012}},
         rationale="Plate clipped over the rim wall: trapezoid extrude.", topo="assembled-solid", conf=0.65)
    ri=0.432
    comp(f"bracket-inner-{n}", f"Bracket inner wall plate ({n})", "meso", "bracket", "extrude", (1,1,1), (round(ri*math.cos(ar),4),0,round(ri*math.sin(ar),4)), "plastic-black",
         parent="bracket-mount", rot=(0,phi(a),0),
         desc={"profile2D":{"points":[[-0.085,-0.012],[0.085,-0.012],[0.06,0.073],[-0.06,0.073]],"depth":0.012}},
         rationale="Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", topo="assembled-solid", conf=0.6)
    rt=0.395
    comp(f"bracket-top-{n}", f"Bracket top plate ({n})", "meso", "bracket", "box", (0.15,0.01,0.11), (round(rt*math.cos(ar),4),-0.006,round(rt*math.sin(ar),4)), "plastic-black",
         parent="bracket-mount", rot=(0,phi(a),0),
         rationale="Flat plate lying on the net inside the rim: box.", topo="assembled-solid", conf=0.65)
# --- logos / lettering (stylised glyph blocks: placement + rhythm of the photo's lettering, not real typography) ---
for i,(x,h) in enumerate(zip((-0.04,-0.02,0.0,0.02,0.04),(0.024,0.024,0.024,0.024,0.024))):
    cid="titan-plate" if i==0 else f"titan-{i}"
    comp(cid, f"TITAN letter block {i}", "micro", "decal", "box", (0.013,h,0.003), (x,0.012,0.0135), "logo-yellow",
         parent="bracket-wall-s", rationale="Printed letter block on the near bracket wall: flat box decal.", topo="assembled-solid", conf=0.55,
         feats=[{"id":"titan-text","type":"decal","note":"yellow TITAN lettering as 5 letter blocks, stylised"}] if i==0 else [])
comp("s-logo", "S roundel ring on near foot", "micro", "decal", "torus", (0.09,0.09,0.09), (0,0.05,0.1), "logo-yellow",
     parent="foot-s", rot=(0,0,0), fixrot=True, desc={"torusTubeRatio": 0.18}, rationale="Ring of the S roundel on the foot face: torus.", topo="assembled-solid", conf=0.6,
     feats=[{"id":"s-roundel","type":"decal","note":"yellow ring + three-bar bolt standing in for the S glyph"}])
for k,(dy,rz) in enumerate(((0.017,0.0),(0.0,-0.55),(-0.017,0.0))):
    comp(f"s-bolt-{k}", f"S bolt bar {k}", "micro", "decal", "box", (0.05,0.011,0.004), (0,0.05+dy,0.1), "logo-yellow",
         parent="foot-s", rot=(0,0,rz), rationale="Bar of the stylised S bolt: box.", topo="assembled-solid", conf=0.5)
comp("foot-e-logo", "Small logo ring on right foot", "micro", "decal", "torus", (0.05,0.05,0.05), (0,0.06,0.1), "logo-yellow",
     parent="foot-e", rot=(0,0,0), fixrot=True, desc={"torusTubeRatio": 0.2}, rationale="Small ring decal on right foot face: torus.", topo="assembled-solid", conf=0.5)
def wm(a, r=0.4665):
    ar=math.radians(a); return (round(r*math.cos(ar),4),0.0,round(r*math.sin(ar),4)), round(math.pi/2-ar,4)
HS=(0.034,0.024,0.03,0.026,0.034,0.026,0.03,0.024)
def wordmark(prefix, a, feat):
    p,r=wm(a)
    for i,h in enumerate(HS):
        x=(i-3.5)*0.02
        pos=(round(p[0]+x*math.cos(r),4),0.0,round(p[2]-x*math.sin(r),4))
        comp(prefix if i==0 else f"{prefix}-{i}", f"Spikeball wordmark block {i}", "micro", "decal", "box", (0.014,h,0.003), pos, "net-black",
             parent="rim-band", rot=(0,r,0), rationale="Black print block on yellow rim.", topo="assembled-solid", conf=0.5,
             feats=[{"id":feat,"type":"decal","note":"Spikeball lettering as 8 letter blocks (stylised)"}] if i==0 else [])
wordmark("wordmark-right",50,"wordmark-near")
wordmark("wordmark-left",150,"wordmark-left")
for c in comps:
    if c['id']=='bracket-mount': c['localFeatures']=[{"id":"screw-heads","type":"fastener","note":"one screw/hole centred on each bracket"}]
REC={'rim-yellow':('rgba(233, 205, 33, 1.0)','rgba(200, 160, 10, 1.0)','plastic'),'net-black':('rgba(17, 17, 17, 1.0)','rgba(30, 30, 30, 1.0)','fabric'),
     'plastic-black':('rgba(22, 22, 22, 1.0)','rgba(38, 38, 38, 1.0)','plastic'),'logo-yellow':('rgba(233, 205, 33, 1.0)','rgba(255, 221, 60, 1.0)','plastic')}
for c in comps:
    d,sec,cls=REC[c['material']]
    c['colorMaterialRecipe']={'dominantAlbedo':d,'secondaryAlbedo':sec,'materialClass':cls,'materialClassConfidence':0.7}
    if c['primitive'] in ('torus',) and c['id'].startswith('net'): c['topologyClass']='fiber-strand'
for m in mats:
    if m['id'] in ('rim-yellow','logo-yellow'): m['specularIntensity']=0.12
    if m['id']=='plastic-black': m['specularIntensity']=0.5
    if m['id']=='net-sheet': m['opacity']={'base':0.2}; m['doubleSided']=True
    if m['id']=='rim-yellow': m['doubleSided']=True
root['material']='net-sheet'; root['materialLayers']=['net-sheet']
root['colorMaterialRecipe']=dict(root['colorMaterialRecipe'],dominantAlbedo='rgba(177, 176, 177, 1.0)',secondaryAlbedo='rgba(17, 17, 17, 1.0)',notes='composite apparent colour of the see-through net field (cords + white gaps), mean of a 250x110 px reference patch = (177,176,177); cord colour is the secondary')
SD={'rim-yellow':dict(macroRoughness=0.62,microRoughness=0.08,bumpAmplitude=0.02,normalPattern="fine moulded grain (seeded, tileable)",displacementPattern="none (rolled lip is real torus geometry)",occlusionPattern="soft AO in the bead/band crease",edgeWearPattern="none visible in photo",notes="satin polymer wrap; grain via independent normal+roughness maps"),
    'plastic-black':dict(macroRoughness=0.45,microRoughness=0.1,bumpAmplitude=0.03,normalPattern="fine moulded grain (seeded, tileable)",displacementPattern="none",occlusionPattern="AO at plate/rim contact",edgeWearPattern="none visible in photo",notes="injection-moulded satin plastic, slightly glossier faces on feet"),
    'logo-yellow':dict(macroRoughness=0.6,microRoughness=0.05,bumpAmplitude=0.01,normalPattern="very fine grain",displacementPattern="none",occlusionPattern="none (flat print)",edgeWearPattern="none",notes="printed/painted flat decal"),
    'net-black':dict(macroRoughness=0.85,microRoughness=0.1,bumpAmplitude=0.0,normalPattern="flat (cord twist below render scale)",displacementPattern="none",occlusionPattern="none",edgeWearPattern="none",notes="matte nylon cord, flat maps"),
    'net-sheet':dict(macroRoughness=0.9,microRoughness=0.05,bumpAmplitude=0.0,normalPattern="flat",displacementPattern="none",occlusionPattern="none",edgeWearPattern="none",notes="stand-in for the see-through mesh field")}
for c in comps: c['surfaceDetail']=dict(SD[c['material']])
def _ap(c, group, pivot_mode, collider, breakable, sockets=None, seams=None, ch=None):
    ap=c['actionProfile']
    ap['pivot']=dict(ap['pivot'],mode=pivot_mode,confidence=0.7)
    ap['collider']=dict(ap['collider'],**collider)
    ap['destruction']=dict(ap['destruction'],breakable=breakable,fractureGroup=group,seamRefs=seams or [],detachableFragments=[c['id']] if breakable else [],breakImpulse=4.0 if breakable else 0.0,debrisMaterial=c['material'])
    ap['sockets']=sockets or []
    if ch: ap['transformChannels']=dict(ap['transformChannels'],**ch)
for c in comps:
    i=c['id']
    if i=='root': _ap(c,'net','center',dict(type='cylinder',scale=[0.9,0.02,0.9],notes='ball-contact surface proxy'),False,sockets=[dict(id='ball-contact',localPosition=[0,0.01,0],note='centre-net hit point (effects/audio)')])
    elif i.startswith('rim') : _ap(c,'rim','center',dict(type='cylinder',scale=[0.93,0.13,0.93],notes='hollow ring: use 8 box proxies at runtime'),False,seams=['rim-bead-top','rim-bead-bottom'])
    elif i.startswith('foot-') and i!='foot-mount' and i!='foot-e-logo': _ap(c,'feet','base',dict(type='box',scale=[0.17,0.10,0.10],offset=[0,0.05,0.05]),True,sockets=[dict(id='ground-contact',localPosition=[0,0,0.05])],seams=['foot-mount'])
    elif i.startswith('bracket-') and i!='bracket-mount': _ap(c,'brackets','hinge',dict(type='box',scale=[0.15,0.13,0.05]),True,seams=['bracket-mount'])
    elif i.startswith('net-'): _ap(c,'net','center',dict(type='box',scale=[0.05,0.01,0.05]),False)
    elif i in ('bracket-mount','foot-mount'): _ap(c,'mounts','center',dict(type='box',scale=[0.01,0.01,0.01]),False)
    else: _ap(c,'decals','center',dict(type='box',scale=[0.02,0.02,0.01]),False,ch=dict(visibility=True,materialState=True))
s['performanceBudget'].update(targetTriangles=40000,maxDrawCalls=80,textureSize=512,fpsTarget=60,optimizationPolicy='Real-time portfolio prop: standard tessellation tier, flat-paint maps at small size, instanced cords/screws; no reference-critical geometry removed.')
s['componentTree'] = comps
s['materials'] = mats

s['repetitionSystems'] = [
 {"id":"net-radial-cords","level":"meso","parent":"root","count":36,"primitive":"box","material":"net-black","instanceScale":[0.43,0.004,0.004],
  "placement":{"mode":"radial","axis":[0,1,0],"radius":0.43,"startAngleDeg":0},"buildsGeometry":True,"note":"radial net cords spanning centre to rim"},
 {"id":"rim-wrap-cords","level":"micro","parent":"rim-band","count":64,"primitive":"box","material":"net-black","instanceScale":[0.006,0.125,0.003],
  "placement":{"mode":"radial","axis":[0,1,0],"radius":0.935,"startAngleDeg":0},"buildsGeometry":True,"note":"coarse diamond mesh wrapped over rim approximated as vertical cords"},
 {"id":"bracket-screws","level":"micro","parent":"bracket-mount","count":4,"primitive":"cylinder","material":"rim-yellow","instanceScale":[0.012,0.012,0.012],
  "placement":{"mode":"radial","axis":[0,1,0],"radius":0.80,"startAngleDeg":0},"buildsGeometry":True,"note":"fastener centred on each bracket (visible screw hole)"},
]
for bp in s['buildPasses']:
    lv={'blockout':'macro','structural-pass':'meso','form-refinement':'micro'}.get(bp['id'])
    if lv: bp['componentRefs']=[c['id'] for c in comps if c['level']==lv]
s['featureReviewTargets'] = [
 {"id":"overall-silhouette","name":"Flat ring silhouette with 4 feet","tier":"critical","passIds":["blockout"],"minimumScore":0.75,"mustPass":True,"componentRefs":["root","rim-band"],"evidenceRefs":["full-object"]},
 {"id":"rim-net-structure","name":"Yellow rim with black net across and wrapped over it","tier":"critical","passIds":["structural-pass","form-refinement"],"minimumScore":0.75,"mustPass":True,"componentRefs":["rim-band","net-ring-0","net-ring-2","net-ring-5"],"evidenceRefs":["full-object"]},
 {"id":"brackets-and-feet","name":"4 corner brackets and 4 wedge feet at 90 degrees","tier":"critical","passIds":["structural-pass","form-refinement"],"minimumScore":0.75,"mustPass":True,"componentRefs":["bracket-mount","foot-mount","foot-s","bracket-wall-s"],"evidenceRefs":["full-object"]},
 {"id":"yellow-black-palette","name":"Yellow/black material split","tier":"critical","passIds":["material-pass","surface-pass"],"minimumScore":0.75,"mustPass":True,"componentRefs":["rim-band","root"],"evidenceRefs":["full-object"]},
 {"id":"logos","name":"Wordmark, TITAN plate and S roundel","tier":"important","passIds":["form-refinement","material-pass"],"minimumScore":0.6,"mustPass":False,"componentRefs":["titan-plate","s-logo","wordmark-right","wordmark-left"],"evidenceRefs":["full-object"]},
]
s['lightingFromPhoto']=[
 {"id":"key","type":"directional","note":"soft key from upper front-left, intensity 2.2, warm white; studio product shot"},
 {"id":"fill","type":"hemisphere","note":"neutral sky fill 0.8 so black plastic keeps readable sheen"},
 {"id":"rim","type":"directional","note":"weak back rim light from upper right, intensity 0.9"},
 {"id":"tone","type":"renderer","note":"ACESFilmic tone mapping, exposure 1.0; white background"},
 {"id":"shadow","type":"ground","note":"soft contact shadow / ground shadow under the feet (ambient occlusion)"}]
s['referenceCamera'].update(solved=False, fovDegrees=28.0, orientation={"yaw":0.0,"pitch":-0.5,"roll":0.0}, positionHint=[0.0,1.15,1.75], poseFit={'az':10,'el':24,'roll':-18,'dist':3.065,'ox':-14,'oy':-34.6,'method':'silhouette IoU search vs hole-filled reference'})
s['preSpecAssessment'] = json.load(open('assessment.json'))['preSpecAssessment']
pa=s['preSpecAssessment']
pa['complexity']['scores']=dict(silhouetteComplexity=2,componentCount=3,hierarchyDepth=2,repetitionDensity=3,materialLayerCount=2,localDetailDensity=3,occlusionRisk=2,actionReadinessNeed=2)
s['assumptions']=list(pa['unknownsToResolveBeforeImplementation'])+['hidden sides inferred from radial symmetry']
pa['unknownsToResolveBeforeImplementation']=[]
s.setdefault('qualityTargets',{})['reviewViewpoints']=["front-3q-elevated","top","side","low-angle","underside"]
DK={'rim-band':('bevel','rim-bead-top'),'rim-wordmark-near':('decal','wordmark-near'),'rim-wordmark-left':('decal','wordmark-left'),'net-inner-grid':('linework','knot-darkening'),
    'net-rim-diamond':('linework','net-rim-wrap'),'bracket-n':('ridge','bracket-mount'),'bracket-e':('ridge','bracket-mount'),'bracket-w':('ridge','bracket-mount'),
    'bracket-s-titan':('decal','titan-text'),'bracket-screw':('fastener','screw-heads'),'foot-s-logo':('decal','s-roundel'),'foot-e-logo':('decal','foot-e-logo')}
for d in pa['detailInventory']['details']:
    k,r=DK[d['id']]; d['kind']=k; d['mapsTo']={'type':'component','ref':r}; d['affects']='geometry' if k in('ridge','bevel','fastener') else 'material'
    d['region']=[0.3,0.3,0.4,0.4]; d['scale']='small'
json.dump(s, open('object-sculpt-spec.json','w'), indent=1)
print(len(comps),"components")
