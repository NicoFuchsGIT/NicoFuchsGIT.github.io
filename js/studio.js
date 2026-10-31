// Weißes Studio (PRD F-01, F-02): Hohlkehle, leicht spiegelnder Boden, Lichtband, zwei Softboxen.
// Alles Licht entsteht hier im Code (Environment-Map, Lichter, Fake-Kontaktschatten), nichts ist gebacken.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

// Die Wand ist ein Stück: links gerade (x = −WALL_R), hinten links ein Viertelkreis um die Mitte, hinten
// gerade weiter nach rechts (z = −WALL_R). Wandobjekte stehen mit der Rückseite auf dem Viertelkreis (wallPose).
export const WALL_R = 6.4;
const COVE_R = 0.3;      // Radius der Hohlkehle; klein, weil Werkbank & Co. direkt an der Wand stehen
const WALL_H = 40;       // hoch genug, dass auch die weit entfernte Hochformat-Kamera nicht drüber schaut
const WIDTH = 80;        // breit genug, dass man die Seiten auch mit Weitwinkel nicht sieht
const FLOOR_FRONT = 45;  // Boden reicht bis hinter die Kamera, auch beim Einstieg im Hochformat

// Hintergrund oberhalb der Wand (nur bei sehr hoher Kamera zu sehen), passend zur oberen Wand.
// Kein Nebel: Im Hochformat steht die Kamera weit weg, Nebel würde die Objekte ausbleichen.
const AIR = new THREE.Color(0xdedee0);
const DARK = new THREE.Color(0x141416); // Licht aus (Einstiegsfahrt)

// Wo ein Wandobjekt steht: `angle` in Grad auf dem Viertelkreis (0 = hinten mittig, 90 = links), `width` = Breite
// seiner Rückseite. Die Rückseite ist eine Sehne des Kreises, die Wand verläuft dort gerade (wallPath).
// Rückgabe: Mitte der Rückseite am Boden und Drehung zur Mitte, in Radiant.
export function wallPose(angle, width) {
    const a = THREE.MathUtils.degToRad(angle);
    const d = Math.sqrt(Math.max(0, WALL_R * WALL_R - (width / 2) ** 2));
    return { x: -Math.sin(a) * d, z: -Math.cos(a) * d, rotation: a };
}

// `wallSpans`: [{ angle, width }] der Wandobjekte, dort wird die Wand gerade (siehe wallPose)
export function createStudio(renderer, scene, { mobile = false, wallSpans = [] } = {}) {
    scene.background = AIR.clone();

    // Environment-Map: kleiner Studioraum mit Lichtband und zwei Softboxen als Leuchtflächen
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(environmentScene(), 0.04).texture;
    pmrem.dispose();

    // Wenige echte Lichter für Form, ohne Shadow-Maps (die Kontaktschatten sind Fake)
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d8dc, 0.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.3);
    key.position.set(1.5, 7, 6);
    scene.add(key);

    const band = lightBand();
    scene.add(wall(wallSpans), band);
    scene.add(floor(mobile, [band]));
    // Die Softboxen stehen links und rechts knapp außerhalb des Bildes (placeSoftboxes)
    const softboxes = [softbox(), softbox()];
    scene.add(...softboxes);

    // Softboxen zwischen Kamera und Objekten, gerade so weit außen, dass sie in Ruhe nicht im Bild sind.
    // Schwenkt die Kamera mit der Maus mit (MenuCamera), kommt die Softbox auf dieser Seite halb ins Bild.
    // `eye`: Kamera in Ruhe, `target`: Mitte der Objekte.
    function placeSoftboxes(camera, eye, target) {
        const view = target.clone().sub(eye).setY(0);
        const depth = view.length() * 0.55;
        view.normalize();
        const side = new THREE.Vector3(-view.z, 0, view.x);
        const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
        softboxes.forEach((box, i) => {
            const s = i ? 1 : -1;
            box.position.copy(eye).addScaledVector(view, depth).addScaledVector(side, s * (depth * tanH + 0.68)).setY(0);
            box.userData.head.lookAt(target.x, 0.9, target.z);
        });
    }

    // Licht an/aus für die Einstiegsfahrt (F-05): 0 = dunkel, 1 = Studio hell
    function setLight(k) {
        renderer.toneMappingExposure = 0.04 + 0.96 * k;
        scene.background.lerpColors(DARK, AIR, k);
    }
    renderer.toneMapping = THREE.LinearToneMapping;
    setLight(1);

    return { setLight, placeSoftboxes };
}

// Grundriss der Wand als Linienzug (x, z) von vorne links bis hinten rechts: links gerade, dann Viertelkreis um die
// Mitte, auf dem jedes Wandobjekt ein gerades Stück (seine Rückseite) bekommt, hinten gerade weiter.
function wallPath(spans) {
    const pts = [];
    const add = (x, z) => {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(last[0] - x, last[1] - z) > 0.01) pts.push([x, z]);
    };
    const onCircle = (deg) => {
        const a = THREE.MathUtils.degToRad(deg);
        add(-Math.sin(a) * WALL_R, -Math.cos(a) * WALL_R);
    };
    add(-WALL_R, FLOOR_FRONT);
    // Sehnen von links nach hinten; überlappen sich zwei, schließt die zweite direkt an
    const chords = spans.map(({ angle, width }) => {
        const h = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, width / 2 / WALL_R)));
        return [angle + h, angle - h];
    }).sort((a, b) => b[0] - a[0]);
    let at = 90;
    const arcTo = (to) => {
        const n = Math.max(1, Math.ceil((at - to) / 3));
        for (let i = 0; i <= n; i++) onCircle(at + (to - at) * i / n);
        at = to;
    };
    for (const [from, to] of chords) {
        if (from < at) arcTo(from);
        onCircle(to);
        at = Math.min(at, to);
    }
    if (at > 0) arcTo(0);
    add(WIDTH / 2, -WALL_R);
    return pts;
}

// Wand mit Hohlkehle: Profil (Abstand zur Wand, Höhe) entlang des Grundrisses gezogen. Im Viertelkreis zeigen die
// Normalen zur Mitte, auch auf den geraden Stücken hinter den Wandobjekten: So schattiert die Wand wie aus einem Guss,
// ohne Knick zwischen den Stücken. Vertex-Farben machen sie nach oben leicht grauer.
function wall(spans) {
    // In der Ecke den Linienzug in Stücke von höchstens 25 cm teilen, damit die Normalen fein genug verlaufen
    const corner = ([x, z]) => x <= 0 && z <= 0;
    const path = [];
    wallPath(spans).forEach((q, i, all) => {
        const p = all[i - 1];
        const n = p && corner(p) && corner(q) ? Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.25) : 1;
        for (let k = 1; k <= n; k++) path.push(p ? [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n] : q);
    });
    // Normale zum Raum hin: links +x, hinten +z, in der Ecke zur Mitte
    const normals = path.map(([x, z]) => {
        if (x < 0 && z < 0) { const len = Math.hypot(x, z); return [-x / len, -z / len]; }
        return x < 0 ? [1, 0] : [0, 1];
    });

    // Profil: Viertelkreis vom Boden in die senkrechte Wand, dann die Wand hinauf. `a`: Winkel für die Normale
    const profile = [];
    for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI / 2;
        profile.push({ d: COVE_R * (1 - Math.sin(a)), y: COVE_R * (1 - Math.cos(a)), a });
    }
    for (let y = COVE_R + 0.5; y <= WALL_H; y += y < 8 ? 0.5 : 4) profile.push({ d: 0, y, a: Math.PI / 2 });

    const pos = [], nor = [], col = [], idx = [];
    const rows = profile.length;
    path.forEach(([x, z], i) => {
        const [nx, nz] = normals[i];
        for (const { d, y, a } of profile) {
            pos.push(x + nx * d, y, z + nz * d);
            nor.push(nx * Math.sin(a), Math.cos(a), nz * Math.sin(a));
            const shade = THREE.MathUtils.lerp(1, 0.96, THREE.MathUtils.smoothstep(y, 1.5, 6));
            col.push(shade, shade, shade);
        }
        if (i > 0) {
            for (let j = 0; j < rows - 1; j++) {
                const a = (i - 1) * rows + j, b = i * rows + j, c = a + 1, e = b + 1;
                idx.push(a, b, c, b, e, c);
            }
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true }));
}

// Spiegelnder Boden: Reflector darunter, darüber ein fast deckender weißer Boden.
// Am Handy halb so große Spiegeltextur (günstiger, N-03).
// `hidden`: Objekte, die nicht gespiegelt werden (das Lichtband würde sonst als Streifen am unteren Bildrand auftauchen).
function floor(mobile, hidden) {
    const group = new THREE.Group();
    // reicht unter die Wand; was dahinter liegt, verdeckt sie
    const depth = FLOOR_FRONT + WALL_R;
    const zMid = (FLOOR_FRONT - WALL_R) / 2;
    const geo = new THREE.PlaneGeometry(WIDTH, depth);
    const size = mobile ? 512 : 1024;

    const mirror = new Reflector(geo, { textureWidth: size, textureHeight: size, color: 0xffffff, clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.set(0, 0, zMid);
    const renderMirror = mirror.onBeforeRender;
    mirror.onBeforeRender = function (...args) {
        hidden.forEach((o) => { o.visible = false; });
        renderMirror.apply(this, args);
        hidden.forEach((o) => { o.visible = true; });
    };
    group.add(mirror);

    const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.95, transparent: true, opacity: 0.86,
    }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, 0.001, zMid);
    group.add(top);
    return group;
}

// Lichtband an der Decke: dunkles Gehäuse mit leuchtendem Streifen
function lightBand() {
    const group = new THREE.Group();
    group.position.set(0.3, 3.5, -4.4); // über der Lücke hinten im Halbkreis, frei von der runden Wand links
    const housing = new THREE.Mesh(
        new THREE.BoxGeometry(7, 0.14, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6 })
    );
    group.add(housing);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.02, 0.44), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    strip.position.y = -0.075;
    group.add(strip);
    return group;
}

// Softbox auf Dreibein-Stativ; der Kopf (`userData.head`) wird auf die Objekte ausgerichtet
function softbox() {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.4, metalness: 0.6 });
    const headH = 2.05;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, headH, 8), metal);
    pole.position.y = headH / 2;
    group.add(pole);
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const foot = new THREE.Vector3(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
        const hip = new THREE.Vector3(0, 0.55, 0);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, foot.distanceTo(hip), 6), metal);
        leg.position.copy(foot).add(hip).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hip.clone().sub(foot).normalize());
        group.add(leg);
    }

    const head = new THREE.Group();
    head.position.y = headH;
    group.add(head);
    group.userData.head = head;
    const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.62, 0.5, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.55, side: THREE.DoubleSide })
    );
    shell.rotation.x = -Math.PI / 2; // breite Öffnung nach +z (Blickrichtung des Kopfes)
    head.add(shell);
    const diffuser = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    diffuser.position.z = 0.25;
    head.add(diffuser);
    return group;
}

// Szene, aus der die Environment-Map entsteht: heller Raum, Lichtband oben, zwei Softboxen, etwas Licht von vorn
function environmentScene() {
    const env = new THREE.Scene();
    const glow = (k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k) });

    const room = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0xacacb0, side: THREE.BackSide }));
    room.position.y = 6;
    env.add(room);

    const band = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 1.6), glow(4));
    band.position.set(0, 11.8, -2);
    env.add(band);

    for (const x of [-9, 9]) {
        const box = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), glow(5));
        box.position.set(x, 4, 4);
        box.lookAt(0, 2, 0);
        env.add(box);
    }

    const front = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), glow(2.6));
    front.position.set(0, 4, 14.9);
    front.rotation.y = Math.PI;
    env.add(front);
    return env;
}

// Fake-Kontaktschatten (F-02) nach dem three.js-Beispiel „contact shadows“: Das Objekt wird einmal von unten
// als Tiefe gerendert, geblurt und als Textur auf eine Fläche am Boden gelegt. Läuft einmal nach dem Laden,
// kostet danach nichts mehr. Das Objekt sollte danach nicht mehr bewegt werden (sonst neu aufrufen).
const SHADOW_LAYER = 31;

export function addContactShadow(renderer, scene, object, { height = 1.4, blur = 5, opacity = 0.7, margin = 0.4 } = {}) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const group = new THREE.Group();
    group.position.set((box.min.x + box.max.x) / 2, 0.002, (box.min.z + box.max.z) / 2);
    scene.add(group);
    bakeShadow(renderer, scene, object, group, box.max.x - box.min.x + margin * 2, box.max.z - box.min.z + margin * 2, { height, blur, opacity });
    return group;
}

// Dasselbe an der Wand hinter einem Wandobjekt: Was nah an der Wand hängt (Regal, Kleidung, Lochwand), wirft einen
// weichen Schatten auf sie, wie Licht von vorne. `parent`: Gruppe des Objekts, Wand bei z = 0, Raum bei +z.
// `box`: Box des Objekts in diesem Raum.
export function addWallShadow(renderer, scene, object, parent, box, { depth = 0.8, blur = 6, opacity = 0.5, margin = 0.35 } = {}) {
    const group = new THREE.Group();
    // Die Schattenebene liegt knapp vor der Wand; gedreht, damit „oben“ (+y) in den Raum zeigt wie beim Boden
    group.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0.006);
    group.rotation.x = Math.PI / 2;
    parent.add(group);
    parent.updateMatrixWorld(true);
    bakeShadow(renderer, scene, object, group, box.max.x - box.min.x + margin * 2, box.max.y - box.min.y + margin * 2, { height: depth, blur, opacity });
    return group;
}

// Schatten in `group` backen: Ebene in deren xz-Ebene (w × d), Kamera knapp darunter blickt nach +y,
// je näher ein Teil der Ebene ist, desto dunkler (bis `height` darüber)
function bakeShadow(renderer, scene, object, group, w, d, { height, blur, opacity }) {
    const res = 512;
    const target = new THREE.WebGLRenderTarget(res, Math.max(64, Math.round(res * d / w)));
    const targetBlur = target.clone();

    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, opacity, depthWrite: false })
    );
    plane.renderOrder = 1;
    plane.scale.z = -1; // Kamera schaut von unten, also Textur in z spiegeln
    group.add(plane);

    // Knapp unter dem Boden, sonst schneidet die Near-Plane die Unterseiten ab
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0, height + 0.05);
    cam.position.y = -0.05;
    cam.rotation.x = Math.PI / 2; // von unten nach oben
    cam.layers.set(SHADOW_LAYER);
    group.add(cam);
    group.updateMatrixWorld(true);

    const depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    depthMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
            'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) );'
        );
    };

    const meshes = [];
    object.traverse((o) => { if (o.isMesh) { o.layers.enable(SHADOW_LAYER); meshes.push(o); } });

    const prev = { bg: scene.background, override: scene.overrideMaterial, target: renderer.getRenderTarget() };
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = depthMaterial;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    scene.overrideMaterial = prev.override;

    // Zweimal horizontal + vertikal bluren (zweiter Durchgang feiner)
    const blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2));
    blurPlane.position.y = height / 2;
    group.add(blurPlane);
    blurPlane.updateMatrixWorld(true);
    const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    hBlur.depthTest = vBlur.depthTest = false;
    const pass = (amount) => {
        blurPlane.material = hBlur;
        hBlur.uniforms.tDiffuse.value = target.texture;
        hBlur.uniforms.h.value = amount / 256;
        renderer.setRenderTarget(targetBlur);
        renderer.render(blurPlane, cam);
        blurPlane.material = vBlur;
        vBlur.uniforms.tDiffuse.value = targetBlur.texture;
        vBlur.uniforms.v.value = amount / 256;
        renderer.setRenderTarget(target);
        renderer.render(blurPlane, cam);
    };
    cam.layers.enableAll();
    pass(blur);
    pass(blur * 0.4);

    group.remove(blurPlane, cam);
    blurPlane.geometry.dispose();
    hBlur.dispose(); vBlur.dispose(); depthMaterial.dispose(); targetBlur.dispose();
    meshes.forEach((o) => o.layers.disable(SHADOW_LAYER));
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(clearColor, clearAlpha);
    scene.background = prev.bg;
}
