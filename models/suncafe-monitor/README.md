# SunCafe monitor (GLB for the 3D CV)

27" monitor (597 x 336 mm active area), feet on y=0, front towards +Z, ~0.62 m x 0.54 m. Parts: `Monitor_body`, `Monitor_back`, `Stand_*`, `Power_LED`, `Screen`.

`Screen` is a flat plane with UV 0..1 (upright) and an emissive material, so it stays readable without scene lights. Texture: `screen_suncafe.jpg` (screenshot of https://suncafe-nu.vercel.app/, Vienna, "Morgen früh").

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const gltf = await new GLTFLoader().loadAsync('models/suncafe-monitor/suncafe_monitor.glb');
const screen = gltf.scene.getObjectByName('Screen');
// optional: replace the texture with a sharper screenshot
const tex = new THREE.TextureLoader().load('screen_hires.png');
tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;   // glTF UVs
screen.material.emissiveMap = tex;
```

Click target: `Screen` (open the live site on click). For a live page use a `CSS3DRenderer` iframe at the screen's world transform.

Rebuild:

```
blender -b -P models/suncafe-monitor/build_monitor.py
node models/tools/web-optimize.mjs models/suncafe-monitor/suncafe_monitor.glb models/suncafe-monitor/suncafe_monitor.glb --keep Screen_SunCafe
```

The web step (`models/tools`) merges body, back and stand into one palette material (`Monitor_back`, 3 draw
calls) and compresses with Draco; `Screen` keeps its name and material.
