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

// TU Edge (Platzhalter für später): flacher Rennwagen-Körper mit vier Rädern
function car() {
    const g = new THREE.Group();
    const bodyShape = mesh(new THREE.CapsuleGeometry(0.28, 2.6, 8, 16), mat(LIGHT, 0.4), 0, 0.32, 0);
    bodyShape.rotation.x = Math.PI / 2;
    bodyShape.scale.set(1.4, 1, 0.55);
    g.add(bodyShape);
    for (const x of [-0.65, 0.65]) for (const z of [-1.0, 1.05]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.24, 24), mat(DARK, 0.8), x, 0.24, z);
        wheel.rotation.z = Math.PI / 2;
        g.add(wheel);
    }
    return g;
}
