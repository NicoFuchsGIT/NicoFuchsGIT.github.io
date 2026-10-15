cd "$(dirname "$0")"
python3 - <<'PY'
import re
t=open('src/createObjectModel.ts').read()
t=t.replace('  texture.needsUpdate = true;\n  return texture;\n}\n\nfunction makeReferenceTextureSet','  return texture;\n}\n\nfunction makeReferenceTextureSet',1)
open('src/_factory.ts','w').write(t)
PY
npx esbuild src/entry.ts --bundle --format=esm --minify --tree-shaking=true --external:three \
 --alias:three/examples/jsm/environments/RoomEnvironment.js=./stubs/addon-stub.js \
 --alias:three/examples/jsm/postprocessing/EffectComposer.js=./stubs/addon-stub.js \
 --alias:three/examples/jsm/postprocessing/RenderPass.js=./stubs/addon-stub.js \
 --alias:three/examples/jsm/postprocessing/BokehPass.js=./stubs/addon-stub.js \
 --alias:three/examples/jsm/postprocessing/UnrealBloomPass.js=./stubs/addon-stub.js \
 --alias:three/examples/jsm/controls/OrbitControls.js=./stubs/addon-stub.js \
 --outfile=out/spikeball-model.js --log-level=warning
