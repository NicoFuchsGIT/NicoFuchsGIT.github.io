// Baut das Bett (Holzbearbeitungs-Projekt, im Fenster der Werkbank): Lattenrost aus Längslatten auf zwei
// Querträgern, Kopfteil mit Ablage. Ohne Blender, Geometrie und Maserung entstehen hier im Code.
//
//   node models/tools/build-bed.mjs
//
// Schreibt models/bed/web/bed.glb. Meter, y nach oben, x quer, Fußende nach +z, Kopfteil bei −z.
// Ursprung am Boden in der Mitte des Lattenrosts; Lattenrost und Kopfteil sind zueinander mittig.
//
// - 15 dunkel gebeizte Latten (7 × 4 cm) laufen über die ganze Länge von 2,02 m, mit gut 3 cm Abstand.
// - Sie liegen auf zwei Querträgern nahe Kopf- und Fußende, jeder auf zwei eigenen Füßen (wie Böcke).
// - Latte und Träger sind überblattet: beide je zur halben Lattenstärke ausgeklinkt, die Oberseiten liegen
//   bündig. Die Ausklinkungen sind echte Geometrie; zwischen den Latten sieht man das helle Holz des Trägers.
// - Kopfteil wie bisher: sechs waagrechte Bretter, Ablage oben, Rückwand, Seitenwange rechts.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../bed/web/bed.glb', import.meta.url));

// --- Maße (Meter) ---------------------------------------------------------------
const W = 1.50, L = 2.02;               // Lattenrost: Breite (quer) × Länge
const N_SLATS = 15, SLAT_W = 0.07, SLAT_T = 0.04;
const TOP = 0.30;                       // Oberkante Latten = Oberkante Träger
const LAP = SLAT_T / 2;                 // Überblattung: beide Teile halb ausgeklinkt
const BEAM_W = 0.07, BEAM_H = 0.09;     // Querträger (Breite entlang z, Höhe)
const BEAM_Z = L / 2 - 0.26;            // Abstand der Träger von der Mitte
const LEG = 0.07, LEG_X = W / 2 - 0.12; // Füße unter den Trägern
const HB_W = 1.74;                      // Kopfteil, mittig zum Lattenrost
const HB_X0 = -HB_W / 2, HB_X1 = HB_W / 2;
const HB_FRONT = -(L / 2 + 0.03);       // Vorderseite der Kopfteil-Bretter
const BOARD_H = 0.15, BOARD_GAP = 0.006, N_BOARDS = 6, BOARD_T = 0.022;
const SHELF_D = 0.20, SHELF_T = 0.028;

// --- Maserung: kachelbare Texturen, Fasern laufen entlang u ------------------------
const srgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
async function grainTexture(dark, light, bands, seed, wave, size = 512) {
    const r = rng(seed);
    const waves = Array.from({ length: 6 }, (_, i) => ({ ku: 1 + Math.floor(r() * 3), kv: i < 3 ? 0 : 1 + Math.floor(r() * 2), a: wave / (i + 1), p: r() }));
    const fiber = Array.from({ length: size }, () => r());
    const px = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            let t = v * bands;
            for (const w of waves) t += w.a * Math.sin(2 * Math.PI * (w.ku * u + w.kv * v + w.p));
            let k = 0.5 + 0.5 * Math.sin(2 * Math.PI * t);
            k = Math.min(1, Math.max(0, (k - 0.25) / 0.5));
            k = k * k * (3 - 2 * k);
            k = Math.min(1, Math.max(0, k * 0.85 + 0.15 * (fiber[y] - 0.5) + 0.06 * (fiber[(y + 7) % size] - 0.5)));
            for (let c = 0; c < 3; c++) px[(y * size + x) * 3 + c] = srgb(dark[c] + (light[c] - dark[c]) * k);
        }
    }
    return sharp(px, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 80 }).toBuffer();
}

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Bett');
doc.createExtension(EXTTextureWebP).setRequired(true);
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({});

const material = async (name, { color, grain, rough }) => {
    const m = doc.createMaterial(name).setRoughnessFactor(rough).setMetallicFactor(0);
    if (color) m.setBaseColorFactor([...color, 1]);
    if (grain) {
        const tex = doc.createTexture(`${name}_albedo`).setMimeType('image/webp').setImage(await grainTexture(...grain));
        m.setBaseColorTexture(tex);
    }
    return m;
};
// Farben linear (wie vorher in Blender); `grain`: dunkel, hell, Bänder pro Kachel, Zufallsstart, Welligkeit
const mats = {
    slat: await material('Latten_gebeizt', { grain: [[0.035, 0.016, 0.007], [0.085, 0.045, 0.02], 9, 3, 0.25], rough: 0.55 }),
    beam: await material('Traeger_hell', { color: [0.52, 0.36, 0.20], rough: 0.65 }),
    leg: await material('Fuesse_gebeizt', { color: [0.05, 0.024, 0.011], rough: 0.6 }),
    head: await material('Kopfteil_Fichte', { grain: [[0.05, 0.024, 0.009], [0.26, 0.15, 0.065], 6, 11, 0.09], rough: 0.6 }),
};

// --- Geometrie -------------------------------------------------------------------
const parts = new Map(); // Material -> { pos, nor, uv, idx }
const rand = rng(42);
// Quader von (x0, y0, z0) bis (x1, y1, z1). `along`: Achse der Fasern (0 = x, 1 = y, 2 = z), bestimmt die UVs:
// u entlang der Fasern (eine Kachel je 0,8 m), v quer dazu (eine Kachel je 0,2 m); Stirnseiten bekommen die
// Bänder quer. `off`: Startpunkt in der Textur; Stücke eines Bauteils (Latte, Träger) teilen ihn, damit die
// Maserung an der Ausklinkung durchläuft, verschiedene Bauteile nicht, damit nicht alle Latten gleich aussehen.
const piece = () => [rand() * 4, rand() * 4];
function box(m, [x0, y0, z0], [x1, y1, z1], along = 0, off = piece()) {
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    const p = parts.get(m) ?? { pos: [], nor: [], uv: [], idx: [] };
    parts.set(m, p);
    const lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (let axis = 0; axis < 3; axis++) {
        for (const side of [0, 1]) {
            const [a, b] = [(axis + 1) % 3, (axis + 2) % 3];
            const n = [0, 0, 0]; n[axis] = side ? 1 : -1;
            const uAxis = along !== axis ? along : a;
            const vAxis = [a, b].find((k) => k !== uAxis) ?? b;
            const base = p.pos.length / 3;
            // Ecken in der Fläche, gegen den Uhrzeigersinn von außen gesehen
            const corners = side ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
            for (const [ca, cb] of corners) {
                const q = [0, 0, 0];
                q[axis] = side ? hi[axis] : lo[axis];
                q[a] = ca ? hi[a] : lo[a];
                q[b] = cb ? hi[b] : lo[b];
                p.pos.push(...q);
                p.nor.push(...n);
                p.uv.push(off[0] + q[uAxis] / 0.8, off[1] + q[vAxis] / 0.2);
            }
            p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
}

const gap = (W - N_SLATS * SLAT_W) / (N_SLATS - 1);
const slatX = Array.from({ length: N_SLATS }, (_, i) => -W / 2 + SLAT_W / 2 + i * (SLAT_W + gap));
const beamZ = [-BEAM_Z, BEAM_Z];

// Latten (entlang z): volle Stärke, über den Trägern nur die obere Hälfte
for (const x of slatX) {
    const off = piece();
    const zs = [-L / 2];
    for (const bz of beamZ) zs.push(bz - BEAM_W / 2, bz + BEAM_W / 2);
    zs.push(L / 2);
    for (let i = 0; i < zs.length - 1; i++) {
        const overBeam = i % 2 === 1;
        box(mats.slat, [x - SLAT_W / 2, TOP - (overBeam ? LAP : SLAT_T), zs[i]], [x + SLAT_W / 2, TOP, zs[i + 1]], 2, off);
    }
}

// Querträger (entlang x): volle Höhe zwischen den Latten, unter den Latten um LAP abgesenkt
for (const bz of beamZ) {
    const off = piece();
    const xs = [-W / 2];
    for (const x of slatX) xs.push(x - SLAT_W / 2, x + SLAT_W / 2);
    xs.push(W / 2);
    for (let i = 0; i < xs.length - 1; i++) {
        const underSlat = i % 2 === 1;
        box(mats.beam, [xs[i], TOP - BEAM_H, bz - BEAM_W / 2], [xs[i + 1], TOP - (underSlat ? LAP : 0), bz + BEAM_W / 2], 0, off);
    }
    // zwei Füße je Träger
    for (const x of [-LEG_X, LEG_X]) box(mats.leg, [x - LEG / 2, 0, bz - LEG / 2], [x + LEG / 2, TOP - BEAM_H, bz + LEG / 2], 1);
}

// Kopfteil: waagrechte Bretter, Ablage oben, Rückwand, Seitenwange rechts
let y = 0.04;
for (let i = 0; i < N_BOARDS; i++) {
    box(mats.head, [HB_X0, y, HB_FRONT - BOARD_T], [HB_X1, y + BOARD_H, HB_FRONT], 0);
    y += BOARD_H + BOARD_GAP;
}
const hbTop = y - BOARD_GAP;
const back = HB_FRONT + 0.03 - SHELF_D; // Rückseite der Ablage
box(mats.head, [HB_X0 - 0.01, hbTop, back], [HB_X1 + 0.01, hbTop + SHELF_T, HB_FRONT + 0.03], 0);
box(mats.head, [HB_X1 - BOARD_T, 0.04, back], [HB_X1, hbTop, HB_FRONT - BOARD_T], 1);
box(mats.head, [HB_X0, 0.04, back], [HB_X1 - BOARD_T, hbTop, back + BOARD_T], 0);

let tris = 0;
for (const [m, p] of parts) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = doc.createPrimitive()
        .setAttribute('POSITION', acc('VEC3', new Float32Array(p.pos)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(p.nor)))
        .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(p.uv)))
        .setIndices(acc('SCALAR', new Uint16Array(p.idx)))
        .setMaterial(m);
    tris += p.idx.length / 3;
    scene.addChild(doc.createNode(`Bett_${m.getName()}`).setMesh(doc.createMesh(m.getName()).addPrimitive(prim)));
}

const io = new NodeIO().registerExtensions([EXTTextureWebP, KHRDracoMeshCompression]).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
});
await doc.transform(draco({ quantizePosition: 16 }));
await io.write(out, doc);
console.log(`bed.glb: ${N_SLATS} slats ${SLAT_W * 100} cm, gap ${(gap * 100).toFixed(1)} cm, beams at z = ±${BEAM_Z} m, `
    + `headboard ${HB_W} m (slatted base ${W} m, ${((HB_W - W) / 2 * 100).toFixed(0)} cm overhang each side), ${tris} triangles`);
