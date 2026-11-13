// Baut den SunCafe-Bildschirm: ein großes, hängendes Display (65 Zoll) an einer Deckenschiene, ohne Tisch.
//
//   node models/tools/build-suncafe-screen.mjs
//
// Schreibt models/suncafe-monitor/suncafe_screen.glb. Maße in Metern, y nach oben, Vorderseite nach +z,
// Ursprung am Boden unter der Bildschirmmitte. Das Bild ist models/suncafe-monitor/screen_suncafe.jpg.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../suncafe-monitor/', import.meta.url));

const W = 1.43, H = 0.804;       // sichtbare Fläche, 16:9 bei 65 Zoll
const BEZEL = 0.02, DEPTH = 0.045;
const BOTTOM = 1.2;              // Unterkante über dem Boden
const TOP = BOTTOM + H + 2 * BEZEL;
const RAIL_Y = 2.4;              // Unterkante der Schiene, an der der Bildschirm hängt

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('SunCafe');

// Quader mit eigenen Normalen je Seite: Mitte (x, y, z), Größe (w, h, d)
function box(name, material, [x, y, z], [w, h, d]) {
    const pos = [], nor = [], idx = [];
    const faces = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const half = [w / 2, h / 2, d / 2];
    for (const [n, u, v] of faces) {
        const base = pos.length / 3;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            pos.push(...[0, 1, 2].map((k) => [x, y, z][k] + (n[k] + u[k] * a + v[k] * b) * half[k]));
            nor.push(...n);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return mesh(name, material, pos, nor, idx);
}

function mesh(name, material, pos, nor, idx, uv) {
    const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
        .setMaterial(material);
    if (uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}

const housing = doc.createMaterial('Gehaeuse').setBaseColorFactor([0.012, 0.012, 0.014, 1]).setRoughnessFactor(0.45).setMetallicFactor(0.2);
const steel = doc.createMaterial('Stahl').setBaseColorFactor([0.03, 0.03, 0.035, 1]).setRoughnessFactor(0.4).setMetallicFactor(0.6);

// Bild: leuchtet selbst, damit es ohne Studiolicht lesbar bleibt. Der Name `Screen_SunCafe` steht als `decals`
// in content/objects.json (die Fläche liegt 0,5 mm vor dem Gehäuse).
doc.createExtension(EXTTextureWebP).setRequired(true);
const image = await sharp(dir + 'screen_suncafe.jpg').webp({ quality: 85 }).toBuffer();
const texture = doc.createTexture('screen_suncafe').setMimeType('image/webp').setImage(image);
const screen = doc.createMaterial('Screen_SunCafe').setBaseColorFactor([0, 0, 0, 1]).setRoughnessFactor(0.25)
    .setEmissiveFactor([1, 1, 1]).setEmissiveTexture(texture);

const mid = BOTTOM + BEZEL + H / 2;
box('Display', housing, [0, mid, 0], [W + 2 * BEZEL, H + 2 * BEZEL, DEPTH]);
const zs = DEPTH / 2 + 0.0005;
mesh('Screen', screen,
    [-W / 2, mid - H / 2, zs, W / 2, mid - H / 2, zs, W / 2, mid + H / 2, zs, -W / 2, mid + H / 2, zs],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2, 0, 2, 3],
    [0, 1, 1, 1, 1, 0, 0, 0]); // glTF: v = 0 ist oben

// Aufhängung: zwei Stangen an einer kurzen Schiene, wie das Lichtband frei im Raum
for (const x of [-0.45, 0.45]) box('Stange', steel, [x, (TOP + RAIL_Y) / 2, -0.005], [0.014, RAIL_Y - TOP, 0.014]);
box('Schiene', steel, [0, RAIL_Y + 0.025, -0.005], [1.1, 0.05, 0.07]);

await new NodeIO().registerExtensions([EXTTextureWebP]).write(dir + 'suncafe_screen.glb', doc);
console.log(`suncafe_screen.glb: ${W + 2 * BEZEL} x ${(H + 2 * BEZEL).toFixed(3)} m, bottom ${BOTTOM} m, top of rail ${RAIL_Y + 0.05} m`);
