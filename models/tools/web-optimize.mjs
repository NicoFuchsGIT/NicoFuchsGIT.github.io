// Bereitet einen Blender-Export (*-raw.glb) für die Website vor. Ersetzt den früheren Schritt
// `npx @gltf-transform/cli draco raw.glb web.glb`.
//
//   node models/tools/web-optimize.mjs <in.glb> <out.glb> [--keep A,B] [--simplify Material=Fehler] [--max-texture 1024]
//
// 1. --simplify: Dreiecke der Teile mit diesem Material reduzieren (meshoptimizer). Der Fehler ist ein
//    Bruchteil der Teilgröße, z. B. 0.0005 bei 1,2 m ≈ 0,6 mm Abweichung.
// 2. Texturen über --max-texture (Standard 1024 px) verkleinern, Format bleibt.
// 3. Einfarbige Materialien über kleine Paletten-Texturen zusammenlegen, dann Teile mit gleichem Material
//    verbinden: weniger Draw Calls. Ausgenommen sind Materialien mit Textur, transparente Materialien
//    (ihre Zeichenreihenfolge bleibt so wie vorher) und die Namen aus --keep, also die `decals` aus
//    content/objects.json, die die Seite über den Materialnamen findet.
// 4. Knoten-Transformationen einbacken (die Boxen, die die Seite misst, bleiben eng am Modell), dann
//    Draco-Kompression mit 16-Bit-Positionen.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
    clearNodeTransform, compressTexture, dedup, draco, flatten, join, palette, prune, simplifyPrimitive, weldPrimitive,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { parseArgs } from 'node:util';

const { values: opts, positionals: [input, output] } = parseArgs({
    allowPositionals: true,
    options: {
        keep: { type: 'string', default: '' },
        simplify: { type: 'string', multiple: true, default: [] },
        'max-texture': { type: 'string', default: '1024' },
    },
});
if (!input || !output) {
    console.error('usage: node web-optimize.mjs <in.glb> <out.glb> [--keep A,B] [--simplify Material=0.0005] [--max-texture 1024]');
    process.exit(1);
}
const keep = opts.keep.split(',').filter(Boolean);
const simplifyError = Object.fromEntries(opts.simplify.map((s) => {
    const [name, error] = s.split('=');
    return [name, Number(error)];
}));
const maxTexture = Number(opts['max-texture']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(input);
const root = doc.getRoot();
const stats = () => {
    let tris = 0, prims = 0;
    for (const node of root.listNodes()) {
        for (const prim of node.getMesh()?.listPrimitives() ?? []) {
            prims++;
            tris += (prim.getIndices() ?? prim.getAttribute('POSITION')).getCount() / 3;
        }
    }
    return `${Math.round(tris)} triangles, ${prims} draw calls, ${root.listMaterials().length} materials`;
};
const before = stats();

// 1. Dreiecke reduzieren
await MeshoptSimplifier.ready;
for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const error = simplifyError[prim.getMaterial()?.getName()];
        if (error === undefined) continue;
        weldPrimitive(prim);
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error });
    }
}

// 2. Große Texturen verkleinern
for (const texture of root.listTextures()) {
    const size = texture.getSize();
    if (!size || Math.max(...size) <= maxTexture) continue;
    await compressTexture(texture, { encoder: sharp, resize: [maxTexture, maxTexture], quality: 85 });
    console.log(`  texture ${texture.getName()}: ${size.join('x')} -> ${texture.getSize().join('x')}`);
}

// 3. Materialien zusammenlegen. `prune` entfernt vorher ungenutzte UVs, damit die Palette TEXCOORD_0 nimmt.
await doc.transform(dedup(), prune());
const guard = doc.createTexture('keep');
const guarded = root.listMaterials().filter((m) => !m.getEmissiveTexture()
    && (keep.includes(m.getName()) || m.getAlphaMode() === 'BLEND'));
for (const m of guarded) m.setEmissiveTexture(guard); // palette() lässt Materialien mit Textur aus
await doc.transform(palette({ min: 2 }));
for (const m of guarded) m.setEmissiveTexture(null);
guard.dispose();
for (const name of keep) {
    if (!root.listMaterials().some((m) => m.getName() === name)) console.warn(`  --keep: no material named ${name}`);
}
// Knoten-Transformationen in die Vertices einbacken: join() hängt sonst alles an den ersten Knoten, und ist
// der gedreht, wird die Box, die die Seite per Box3.setFromObject misst (Klickfläche, Schatten, Wand, Tisch), zu groß.
await doc.transform(flatten());
for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) node.setMesh(mesh.clone());
    clearNodeTransform(node);
}
await doc.transform(join(), prune(), draco({ quantizePosition: 16 }));

await io.write(output, doc);
console.log(`${input}\n  before: ${before}\n  after:  ${stats()}`);
