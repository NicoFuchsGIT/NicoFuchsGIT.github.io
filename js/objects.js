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
// `items`: pro Objekt { id, def, group, hit, box, glow } – `box` ist die Weltbox, `glow` der gelbe Schein (F-20).
export function createObjects(scene, renderer, defs, gltfLoader, onChange) {
    const groups = [];
    const hitTargets = [];
    const items = [];

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

        const item = { id: def.id, def, group, hit, box: new THREE.Box3(), glow: null };
        items.push(item);

        let content = null;
        let shadow = null;
        const show = (next) => {
            if (content) group.remove(content);
            if (shadow) scene.remove(shadow);
            if (item.glow) { scene.remove(item.glow); item.glow.geometry.dispose(); }
            content = next;
            // Box im lokalen Raum der Gruppe: Inhalt hat hier noch keinen Parent, Welt = lokal
            content.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(content);
            box.getSize(hit.scale);
            box.getCenter(hit.position);
            group.add(content);
            group.updateMatrixWorld(true); // Weltlage für Schatten, Schein und Label
            shadow = addContactShadow(renderer, scene, content);
            item.box.setFromObject(content);
            item.glow = glow(item.box);
            scene.add(item.glow);
            onChange();
        };

        show(placeholder(def));
        if (def.model) {
            gltfLoader.load(def.model, (gltf) => show(onTable(gltf.scene, def.table)), undefined,
                (err) => console.warn(`${def.id}: Modell nicht geladen, Platzhalter bleibt`, err));
        }
    }
    return { groups, hitTargets, items };
}

// Gelber Lichtschein auf dem Boden unter dem Objekt (F-20, N-09). Liegt direkt in der Szene, nicht in der
// Objektgruppe, damit er den Bildausschnitt nicht verändert. Sichtbarkeit über `material.opacity`.
let glowTexture = null;
function glow(box) {
    if (!glowTexture) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(245,196,0,1)');
        grad.addColorStop(0.45, 'rgba(245,196,0,0.55)');
        grad.addColorStop(1, 'rgba(245,196,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        glowTexture = new THREE.CanvasTexture(c);
        glowTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const w = (box.max.x - box.min.x) * 1.2 + 0.9;
    const d = (box.max.z - box.min.z) * 1.2 + 0.9;
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    m.position.set((box.min.x + box.max.x) / 2, 0.004, (box.min.z + box.max.z) / 2);
    m.renderOrder = 2; // über dem Kontaktschatten
    m.visible = false;
    return m;
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
        case 'car': return car();
        default: return box();
    }
}

// Modell auf einen Schreibtisch stellen (`table`: Höhe der Tischplatte in Metern vor `scale`), z. B. den
// SunCafe-Monitor. Platte aus hellem Holz auf vier dunklen Stahlbeinen, Modell hinten, Tastatur und Maus davor.
function onTable(model, height) {
    if (!height) return model;
    const g = new THREE.Group();
    model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const w = Math.max(size.x + 0.5, 1.2), d = Math.max(size.z + 0.35, 0.65), t = 0.03;
    const steel = mat(DARK, 0.5, 0.4);
    g.add(mesh(new THREE.BoxGeometry(w, t, d), mat(0xd8c3a0, 0.6), 0, height - t / 2, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.03, height - t, 0.03), steel, x * (w / 2 - 0.05), (height - t) / 2, z * (d / 2 - 0.05)));
    }
    model.position.set(0, height, -d / 2 + size.z / 2 + 0.05);
    g.add(model);
    g.add(mesh(new THREE.BoxGeometry(0.36, 0.015, 0.12), mat(0xf4f4f6, 0.5), -0.04, height + 0.0075, d / 2 - 0.12));
    const mouse = mesh(new THREE.SphereGeometry(0.03, 16, 8), mat(0xf4f4f6, 0.4), 0.24, height, d / 2 - 0.12);
    mouse.scale.set(0.7, 0.45, 1);
    g.add(mouse);
    return g;
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
