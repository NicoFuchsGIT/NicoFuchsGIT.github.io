// Objekte im Studio (PRD F-10 bis F-15): alles kommt aus content/objects.json.
// Jedes Objekt steht sofort als schlichter Platzhalter da; ist ein `model` (.glb) angegeben, ersetzt es den
// Platzhalter, sobald es geladen ist. Schlägt das Laden fehl, bleibt der Platzhalter stehen (Rückfall, F-14).
import * as THREE from 'three';
import { addContactShadow } from './studio.js';

export async function loadContent(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
}

// Baut alle sichtbaren Objekte. `onChange` wird aufgerufen, wenn sich die Größe eines Objekts ändert
// (Modell nachgeladen), damit die Kamera ihren Bildausschnitt anpassen kann.
export function createObjects(scene, renderer, defs, gltfLoader, onChange) {
    const groups = [];
    const hitTargets = [];

    for (const def of defs) {
        if (def.visible === false) continue; // F-15

        const group = new THREE.Group();
        const [x, z] = def.position ?? [0, 0];
        group.position.set(x, 0, z);
        group.rotation.y = THREE.MathUtils.degToRad(def.rotation ?? 0);
        group.scale.setScalar(def.scale ?? 1);
        group.userData.id = def.id;
        scene.add(group);
        groups.push(group);

        // Unsichtbare Klickfläche um das ganze Objekt, damit auch Klicks durch Netze und Gestelle treffen
        const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
        hit.userData.id = def.id;
        group.add(hit);
        hitTargets.push(hit);

        let content = null;
        let shadow = null;
        const show = (next) => {
            if (content) group.remove(content);
            if (shadow) scene.remove(shadow);
            content = next;
            // Box im lokalen Raum der Gruppe: Inhalt hat hier noch keinen Parent, Welt = lokal
            content.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(content);
            box.getSize(hit.scale);
            box.getCenter(hit.position);
            group.add(content);
            shadow = addContactShadow(renderer, scene, content);
            onChange();
        };

        show(placeholder(def));
        if (def.model) {
            gltfLoader.load(def.model, (gltf) => show(gltf.scene), undefined,
                (err) => console.warn(`${def.id}: Modell nicht geladen, Platzhalter bleibt`, err));
        }
    }
    return { groups, hitTargets };
}

// ---------------------------------------------------------------------------------------------
// Platzhalter (F-12): schlichte Formen in Studio-Optik, Maße in Metern (vor `scale`)

const mat = (color, roughness = 0.75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const LIGHT = 0xf2f2f4;
const GREY = 0xb9b9be;
const DARK = 0x2a2a2d;
const YELLOW = 0xf5c400;

function placeholder(def) {
    switch (def.placeholder) {
        case 'avatar': return avatar(def.avatar);
        case 'suncafe': return sunCafe();
        case 'desk': return desk();
        case 'car': return car();
        default: return box();
    }
}

function mesh(geometry, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    return m;
}

function box() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat(GREY), 0, 0.4, 0));
    return g;
}

// Stilisierter Avatar (F-13): Farben und Größe aus `avatar` in der JSON
function avatar(opts = {}) {
    const o = { height: 1.1, skin: '#e0b89a', hair: '#3b2a20', top: '#2b2b2e', bottom: '#4a5160', shoes: '#f2f2f2', ...opts };
    const g = new THREE.Group();
    const s = o.height / 1.8; // gebaut für 1,80 m, dann auf `height` skaliert
    const body = new THREE.Group();
    body.scale.setScalar(s);
    g.add(body);

    const skin = mat(o.skin, 0.6), hair = mat(o.hair, 0.9), top = mat(o.top, 0.85), bottom = mat(o.bottom, 0.85), shoes = mat(o.shoes, 0.6);
    for (const side of [-1, 1]) {
        body.add(mesh(new THREE.BoxGeometry(0.12, 0.08, 0.27), shoes, side * 0.1, 0.04, 0.04));
        body.add(mesh(new THREE.CapsuleGeometry(0.075, 0.68, 6, 12), bottom, side * 0.1, 0.49, 0));
        const arm = mesh(new THREE.CapsuleGeometry(0.055, 0.5, 6, 12), top, side * 0.26, 1.18, 0);
        arm.rotation.z = side * 0.12;
        body.add(arm);
        body.add(mesh(new THREE.SphereGeometry(0.055, 12, 8), skin, side * 0.295, 0.86, 0));
    }
    const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.42, 8, 16), top, 0, 1.17, 0);
    torso.scale.z = 0.7;
    body.add(torso);
    body.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), skin, 0, 1.5, 0));
    body.add(mesh(new THREE.SphereGeometry(0.11, 24, 16), skin, 0, 1.64, 0));
    const cap = mesh(new THREE.SphereGeometry(0.117, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 1.65, -0.01);
    cap.rotation.x = -0.25;
    body.add(cap);
    return g;
}

// SunCafe: weißer Würfel mit gelber Sonne, Tasse obendrauf
function sunCafe() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(LIGHT, 0.6), 0, 0.35, 0));
    g.add(mesh(new THREE.CircleGeometry(0.16, 32), new THREE.MeshStandardMaterial({ color: YELLOW, emissive: YELLOW, emissiveIntensity: 0.25 }), 0, 0.42, 0.351));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 24), mat(0xffffff, 0.3), 0.1, 0.76, 0.05));
    const handle = mesh(new THREE.TorusGeometry(0.035, 0.01, 8, 16), mat(0xffffff, 0.3), 0.18, 0.77, 0.05);
    g.add(handle);
    return g;
}

// Pult mit Monitor: Tischplatte auf zwei Wangen, Monitor auf Fuß
function desk() {
    const g = new THREE.Group();
    const frame = mat(DARK, 0.5, 0.3);
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), mat(LIGHT, 0.5), 0, 0.74, 0));
    for (const side of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.04, 0.72, 0.55), frame, side * 0.56, 0.36, 0));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.015, 0.15), frame, 0, 0.77, -0.12));
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.24, 0.03), frame, 0, 0.89, -0.15));
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.42, 0.03), frame, 0, 1.15, -0.13));
    g.add(mesh(new THREE.PlaneGeometry(0.68, 0.38), new THREE.MeshBasicMaterial({ color: 0x3a4250 }), 0, 1.15, -0.114));
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.015, 0.14), mat(GREY), 0, 0.77, 0.12));
    return g;
}

// ---------------------------------------------------------------------------------------------
// TU Wien Racing edge17: Formula-Student-Elektroauto mit Aeropaket und Driverless-Sensorik.
// Lackierung Schwarz/Orange/Weiß. Nase zeigt nach +Z, Maße in Metern (Radstand 1,53 m, Spur 1,22/1,18 m).

const EDGE_BLACK = 0x141416;
const EDGE_ORANGE = 0xf26b1d;
const EDGE_WHITE = 0xf4f4f2;
const CSS_BLACK = '#141416', CSS_ORANGE = '#f26b1d', CSS_WHITE = '#f4f4f2';
const TIRE_R = 0.207;

function car() {
    const g = new THREE.Group();
    const carbon = mat(EDGE_BLACK, 0.35, 0.15);
    const matte = mat(0x0b0b0c, 0.9);
    const orange = mat(EDGE_ORANGE, 0.45);
    const white = mat(EDGE_WHITE, 0.5);
    const metal = mat(0x3a3a3e, 0.45, 0.6);

    // Monocoque mit Nase: Querschnitte von der Nasenspitze bis zum Heck, Lackierung als Textur
    const body = loft([
        { z: 1.32, w: 0.04, yb: 0.17, yt: 0.21 },
        { z: 1.25, w: 0.09, yb: 0.13, yt: 0.27 },
        { z: 1.10, w: 0.14, yb: 0.11, yt: 0.34 },
        { z: 0.85, w: 0.18, yb: 0.09, yt: 0.42 },
        { z: 0.55, w: 0.23, yb: 0.08, yt: 0.48 },
        { z: 0.30, w: 0.28, yb: 0.07, yt: 0.51 },
        { z: 0.00, w: 0.31, yb: 0.07, yt: 0.50 },
        { z: -0.35, w: 0.31, yb: 0.07, yt: 0.52 },
        { z: -0.55, w: 0.27, yb: 0.08, yt: 0.49 },
        { z: -0.80, w: 0.20, yb: 0.10, yt: 0.42 },
        { z: -0.98, w: 0.12, yb: 0.14, yt: 0.34 },
        { z: -1.04, w: 0.07, yb: 0.17, yt: 0.28 },
    ], { n: 3 });
    g.add(new THREE.Mesh(body, [new THREE.MeshStandardMaterial({ map: bodyLivery(1.32, -1.04), roughness: 0.35, metalness: 0.1 }), orange, carbon]));

    // Cockpit: Öffnung mit weißem Rand, Lenkrad, Sitzlehne
    const opening = stadium(0.19, 0.35);
    const holeShape = new THREE.Shape(opening.getPoints(24));
    const rimShape = stadium(0.215, 0.375);
    rimShape.holes.push(new THREE.Path(opening.getPoints(24)));
    const rim = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(rimShape, { depth: 0.05, bevelEnabled: false })), white);
    rim.position.set(0, 0.475, -0.02);
    g.add(rim);
    const hole = new THREE.Mesh(flat(new THREE.ShapeGeometry(holeShape)), matte);
    hole.position.set(0, 0.505, -0.02);
    g.add(hole);
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.2, 0.05), orange, 0, 0.6, -0.36)); // Kopfstütze
    const wheelHub = mesh(new THREE.BoxGeometry(0.24, 0.1, 0.03), carbon, 0, 0.6, 0.2);
    wheelHub.rotation.x = -0.5;
    g.add(wheelHub);

    // Überrollbügel: Hauptbügel hinter dem Sitz mit Streben nach hinten, Frontbügel vor dem Lenkrad
    g.add(tube([[-0.26, 0.46, -0.37], [-0.23, 0.9, -0.39], [-0.12, 0.98, -0.39], [0.12, 0.98, -0.39], [0.23, 0.9, -0.39], [0.26, 0.46, -0.37]], 0.016, carbon));
    g.add(tube([[-0.24, 0.47, 0.3], [-0.16, 0.6, 0.3], [0.16, 0.6, 0.3], [0.24, 0.47, 0.3]], 0.014, carbon));
    for (const s of [-1, 1]) g.add(rod([s * 0.2, 0.95, -0.4], [s * 0.18, 0.45, -0.78], 0.011, carbon));

    // Seitenkästen mit Kühler-Einlass vorne
    for (const s of [-1, 1]) {
        const pod = loft([
            { z: 0.42, w: 0.07, yb: 0.10, yt: 0.26 },
            { z: 0.34, w: 0.12, yb: 0.07, yt: 0.35 },
            { z: 0.00, w: 0.12, yb: 0.07, yt: 0.35 },
            { z: -0.30, w: 0.11, yb: 0.07, yt: 0.32 },
            { z: -0.52, w: 0.05, yb: 0.09, yt: 0.20 },
        ], { x: s * 0.44, n: 4 });
        g.add(new THREE.Mesh(pod, [carbon, matte, carbon]));
        g.add(mesh(new THREE.BoxGeometry(0.2, 0.22, 0.01), matte, s * 0.44, 0.21, 0.36)); // Kühlergitter
        const decal = mesh(new THREE.PlaneGeometry(0.62, 0.19), decalMat(sidepodDecal()), s * 0.565, 0.215, -0.04);
        decal.rotation.y = s * Math.PI / 2;
        g.add(decal);
    }

    // Unterboden mit Diffusor
    g.add(mesh(new THREE.BoxGeometry(1.0, 0.02, 1.2), carbon, 0, 0.045, -0.05));
    const diffuser = mesh(new THREE.BoxGeometry(0.9, 0.015, 0.4), carbon, 0, 0.09, -0.83);
    diffuser.rotation.x = 0.24;
    g.add(diffuser);
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.01, 0.12, 0.4), carbon, s * 0.45, 0.1, -0.83));

    // Frontflügel: drei Elemente, orange Endplatten mit weißem Streifen
    g.add(wing(0.30, 1.36, 0.05, carbon, 0, 0.06, 1.48));
    g.add(wing(0.17, 1.36, 0.45, carbon, 0, 0.105, 1.22));
    g.add(wing(0.12, 1.36, 0.80, orange, 0, 0.17, 1.10));
    for (const s of [-1, 1]) {
        g.add(plate([[1.53, 0.03], [1.0, 0.03], [1.0, 0.31], [1.2, 0.31], [1.53, 0.15]], 0.01, orange, s * 0.685));
        g.add(mesh(new THREE.BoxGeometry(0.016, 0.02, 0.53), white, s * 0.685, 0.035, 1.265)); // Gleitkufe
    }

    // Heckflügel: drei Elemente auf zwei Pylonen, orange Endplatten mit Teamschriftzug
    g.add(wing(0.28, 0.98, 0.18, carbon, 0, 0.91, -0.80));
    g.add(wing(0.18, 0.98, 0.60, carbon, 0, 1.01, -1.04));
    g.add(wing(0.12, 0.98, 1.00, orange, 0, 1.12, -1.16));
    for (const s of [-1, 1]) {
        g.add(plate([[-0.74, 1.25], [-1.27, 1.27], [-1.27, 0.62], [-1.08, 0.6], [-0.88, 0.8], [-0.74, 0.84]], 0.012, orange, s * 0.495));
        const decal = mesh(new THREE.PlaneGeometry(0.46, 0.33), decalMat(endplateDecal()), s * 0.503, 1.04, -1.02);
        decal.rotation.y = s * Math.PI / 2;
        g.add(decal);
        g.add(mesh(new THREE.BoxGeometry(0.025, 0.6, 0.08), carbon, s * 0.12, 0.62, -0.92)); // Pylon
        g.add(rod([s * 0.15, 0.95, -0.42], [s * 0.15, 0.95, -0.82], 0.009, carbon)); // Strebe vom Hauptbügel
    }

    // Driverless: LiDAR unter der Nase am Frontflügel, Stereokamera auf dem Hauptbügel
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 24), metal, 0, 0.12, 1.42));
    g.add(mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.015, 24), orange, 0, 0.165, 1.42));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), matte, 0, 1.02, -0.39));
    for (const s of [-1, 1]) g.add(mesh(new THREE.CircleGeometry(0.014, 16), mat(0x1c2a3a, 0.1, 0.5), s * 0.06, 1.02, -0.359));

    // Räder mit Doppelquerlenkern und Pushrods
    for (const [z, track] of [[0.765, 1.22], [-0.765, 1.18]]) {
        for (const s of [-1, 1]) {
            const x = s * track / 2;
            g.add(wheel(x, z, s, orange, metal));
            const inner = s * (z > 0 ? 0.17 : 0.24);
            const up = s * (track / 2 - 0.07);
            for (const [y0, y1] of [[0.12, 0.12], [0.3, 0.28]]) {
                g.add(rod([inner, y0, z + 0.13], [up, y1, z], 0.008, carbon));
                g.add(rod([inner, y0, z - 0.13], [up, y1, z], 0.008, carbon));
            }
            g.add(rod([up, 0.13, z], [inner, 0.42, z], 0.008, metal)); // Pushrod
            g.add(mesh(new THREE.BoxGeometry(0.03, 0.2, 0.06), metal, up, 0.2, z)); // Radträger
        }
    }
    return g;
}

// Röhre aus Querschnitten (abgerundete Rechtecke) entlang z; UV: x = Länge, y = Umfang (0 unten, 0,25 rechts,
// 0,5 oben, 0,75 links). Gruppen: 0 = Mantel, 1 = Deckel vorne, 2 = Deckel hinten.
function loft(sections, { x = 0, n = 4, seg = 48 } = {}) {
    const pos = [], uv = [], idx = [];
    const z0 = sections[0].z, len = z0 - sections.at(-1).z;
    const point = (s, j) => {
        const t = -Math.PI / 2 + (j / seg) * Math.PI * 2;
        const c = Math.cos(t), sn = Math.sin(t);
        return [x + Math.sign(c) * Math.abs(c) ** (2 / n) * s.w,
            (s.yt + s.yb) / 2 + Math.sign(sn) * Math.abs(sn) ** (2 / n) * (s.yt - s.yb) / 2, s.z];
    };
    sections.forEach((s) => {
        for (let j = 0; j <= seg; j++) { pos.push(...point(s, j)); uv.push((z0 - s.z) / len, j / seg); }
    });
    const ring = seg + 1;
    for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < seg; j++) {
        const a = i * ring + j, b = a + ring;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const groups = [idx.length];
    for (const [s, front] of [[sections[0], true], [sections.at(-1), false]]) {
        const c = pos.length / 3;
        pos.push(x, (s.yt + s.yb) / 2, s.z);
        uv.push(0, 0);
        for (let j = 0; j <= seg; j++) { pos.push(...point(s, j)); uv.push(0, 0); }
        for (let j = 0; j < seg; j++) front ? idx.push(c, c + 1 + j, c + 2 + j) : idx.push(c, c + 2 + j, c + 1 + j);
        groups.push(idx.length);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    groups.forEach((end, k) => geo.addGroup(k ? groups[k - 1] : 0, end - (k ? groups[k - 1] : 0), k));
    geo.computeVertexNormals();
    return geo;
}

// Flügelelement: gewölbtes Profil (Saugseite unten), Vorderkante bei (x, y, z), Anstellwinkel `aoa` hebt die Hinterkante
function wing(chord, span, aoa, material, x, y, z) {
    const c = chord, s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0, 0.05 * c, 0.35 * c, 0.06 * c, c, 0.008 * c);
    s.bezierCurveTo(0.6 * c, -0.03 * c, 0.12 * c, -0.13 * c, 0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 12 });
    geo.translate(0, 0, -span / 2);
    geo.rotateY(Math.PI / 2);
    geo.rotateX(aoa);
    return mesh(geo, material, x, y, z);
}

// 10-Zoll-Rad: Reifen mit runder Flanke, schwarze Felge mit fünf Speichen, orange Zentralmutter und Felgenhorn
function wheel(x, z, side, orange, metal) {
    const w = new THREE.Group();
    w.position.set(x, TIRE_R, z);
    const profile = [[0.128, -0.095], [0.175, -0.098], [0.195, -0.088], [0.205, -0.06], [TIRE_R, 0],
        [0.205, 0.06], [0.195, 0.088], [0.175, 0.098], [0.128, 0.095]].map(([r, y]) => new THREE.Vector2(r, y));
    const tire = new THREE.LatheGeometry(profile, 48);
    tire.rotateZ(Math.PI / 2);
    w.add(new THREE.Mesh(tire, new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92, side: THREE.DoubleSide })));
    const barrel = new THREE.CylinderGeometry(0.128, 0.128, 0.18, 32, 1, true);
    barrel.rotateZ(Math.PI / 2);
    w.add(new THREE.Mesh(barrel, new THREE.MeshStandardMaterial({ color: 0x1e1e21, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide })));
    const face = side * 0.05;
    const disc = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24), metal, face - side * 0.04, 0, 0);
    disc.rotation.z = Math.PI / 2;
    w.add(disc);
    for (let k = 0; k < 5; k++) {
        const spoke = mesh(new THREE.BoxGeometry(0.014, 0.115, 0.028), mat(0x1e1e21, 0.5, 0.4), face, 0, 0);
        spoke.rotation.x = (k / 5) * Math.PI * 2;
        spoke.geometry.translate(0, 0.06, 0);
        w.add(spoke);
    }
    const nut = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6), orange, face + side * 0.01, 0, 0);
    nut.rotation.z = Math.PI / 2;
    w.add(nut);
    const lip = mesh(new THREE.TorusGeometry(0.128, 0.006, 8, 48), orange, side * 0.09, 0, 0);
    lip.rotation.y = Math.PI / 2;
    w.add(lip);
    return w;
}

// Flache Platte (Endplatte) aus einem Seitenprofil in (z, y), Dicke quer zur Fahrtrichtung, mittig bei x
function plate(profile, thickness, material, x) {
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y))), { depth: thickness, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);
    return mesh(geo, material, x + thickness / 2, 0, 0);
}

// Stab zwischen zwei Punkten
function rod(a, b, r, material) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8), material);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
}

function tube(points, r, material) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r, 8), material);
}

// Stadionform in der Draufsicht (halbe Breite, halbe Länge); `flat` legt sie waagrecht (Normale nach oben)
function stadium(hw, hl) {
    const s = new THREE.Shape();
    s.absarc(0, hl - hw, hw, 0, Math.PI, false);
    s.absarc(0, -hl + hw, hw, Math.PI, Math.PI * 2, false);
    return s;
}
function flat(geo) { geo.rotateX(-Math.PI / 2); return geo; }

// ---- Lackierung (Canvas-Texturen) ----

function canvasTexture(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

function decalMat(map) {
    return new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 });
}

// Monocoque: orange Nase, die als schmaler Streifen oben an den Flanken nach hinten ausläuft, weiße Begleitlinie,
// weiße Startnummer 41 auf der Nase. Gezeichnet in (z, Umfang) und für die linke Seite gespiegelt (u -> 1 - u).
function bodyLivery(zFront, zRear) {
    return canvasTexture(2048, 1024, (ctx, W, H) => {
        const P = (z, u) => [(zFront - z) / (zFront - zRear) * W, (1 - u) * H];
        const poly = (pts, color) => {
            for (const mirror of [false, true]) {
                ctx.beginPath();
                pts.forEach(([z, u], k) => ctx[k ? 'lineTo' : 'moveTo'](...P(z, mirror ? 1 - u : u)));
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
            }
        };
        ctx.fillStyle = CSS_BLACK;
        ctx.fillRect(0, 0, W, H);
        poly([[1.33, 0.5], [0.62, 0.5], [0.78, 0.42], [1.0, 0.3], [1.06, 0.2], [1.12, 0], [1.33, 0]], CSS_WHITE);
        poly([[1.33, 0.5], [0.66, 0.5], [0.82, 0.42], [1.04, 0.3], [1.1, 0.2], [1.16, 0], [1.33, 0]], CSS_ORANGE);
        poly([[0.98, 0.268], [-0.72, 0.33], [-0.72, 0.338], [0.98, 0.28]], CSS_WHITE);
        poly([[1.02, 0.285], [-0.78, 0.345], [-0.78, 0.358], [0.78, 0.42]], CSS_ORANGE);
        // Startnummer auf der Nase, von vorne lesbar
        const [nx, ny] = P(0.98, 0.5);
        ctx.save();
        ctx.translate(nx, ny);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = CSS_WHITE;
        ctx.font = 'italic 900 130px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('41', 0, 0);
        ctx.restore();
    });
}

function sidepodDecal() {
    return canvasTexture(1024, 314, (ctx, W, H) => {
        ctx.fillStyle = CSS_ORANGE;
        ctx.beginPath();
        ctx.moveTo(0, H * 0.62); ctx.lineTo(W * 0.62, H * 0.62); ctx.lineTo(W * 0.52, H); ctx.lineTo(0, H);
        ctx.fill();
        ctx.fillStyle = CSS_WHITE;
        ctx.fillRect(0, H * 0.56, W * 0.64, H * 0.03);
        ctx.font = 'italic 900 150px Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('41', W * 0.06, H * 0.5);
        ctx.font = 'italic 800 54px Helvetica, Arial, sans-serif';
        ctx.fillText('EDGE17', W * 0.32, H * 0.5);
        ctx.fillStyle = CSS_BLACK;
        ctx.font = 'italic 800 44px Helvetica, Arial, sans-serif';
        ctx.fillText('TU WIEN RACING', W * 0.04, H * 0.88);
    });
}

function endplateDecal() {
    return canvasTexture(1024, 736, (ctx, W, H) => {
        ctx.fillStyle = CSS_WHITE;
        ctx.textAlign = 'center';
        ctx.font = 'italic 900 190px Helvetica, Arial, sans-serif';
        ctx.fillText('TU WIEN', W / 2, H * 0.36);
        ctx.font = 'italic 900 160px Helvetica, Arial, sans-serif';
        ctx.fillText('RACING', W / 2, H * 0.62);
        ctx.fillStyle = CSS_BLACK;
        ctx.fillRect(W * 0.08, H * 0.74, W * 0.84, H * 0.16);
        ctx.fillStyle = CSS_WHITE;
        ctx.font = 'italic 800 90px Helvetica, Arial, sans-serif';
        ctx.fillText('EDGE17', W / 2, H * 0.86);
    });
}
