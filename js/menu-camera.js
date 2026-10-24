// Menü-Kamera (PRD F-03 bis F-05): steht fest, schwenkt am Desktop nur minimal mit der Maus mit,
// rückt so weit zurück, dass alle Objekte im Bild sind, und fährt einmal ins Studio hinein.
// Weitwinkel: im Querformat 80° horizontal (etwa 24 mm Kleinbild), im Hochformat höchstens 75° vertikal.
// Kein Zoom, kein Drehen, keine OrbitControls.
import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;
const UP = new THREE.Vector3(0, 1, 0);

export class MenuCamera {
    constructor(camera, {
        eyeHeight = 1.9,       // Kamerahöhe in Metern: knapp über Augenhöhe der 1,80 m großen Figur
        hFov = 80,             // horizontaler Bildwinkel in Grad
        maxFov = 75,           // vertikaler Bildwinkel höchstens (Hochformat), in Grad
        swayYaw = deg(2.5),    // Mitschwenken links/rechts (Kamera kreist um das Ziel)
        swayPan = deg(3),      // dazu Mitdrehen zur Mausseite; beides zusammen holt die Softboxen halb ins Bild
        swayPitch = deg(1.2),  // Mitschwenken oben/unten
        margin = 0.9,          // Anteil des Bildes (NDC), den der Rahmen höchstens füllt
        introDuration = 1.5,
        sway = true,
        intro = true,
    } = {}) {
        this.camera = camera;
        this.eyeHeight = eyeHeight;
        this.hFov = hFov;
        this.maxFov = maxFov;
        this.swayYaw = swayYaw;
        this.swayPan = swayPan;
        this.swayPitch = swayPitch;
        this.margin = margin;
        this.sway = sway;
        this.introDuration = introDuration;
        this.introT = intro ? 0 : 1;

        this.points = boxCorners(new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1)));
        this.goal = { target: new THREE.Vector3(), distance: 10 };
        this.cur = { target: new THREE.Vector3(), distance: 10, mouse: new THREE.Vector2() };
        this.mouse = new THREE.Vector2();
        this.fitted = false;

        if (sway) {
            window.addEventListener('pointermove', (e) => {
                if (e.pointerType !== 'mouse') return;
                this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
            });
            document.addEventListener('pointerleave', () => this.mouse.set(0, 0));
        }
    }

    get inIntro() { return this.introT < 1; }
    get introProgress() { return easeInOut(this.introT); }
    skipIntro() { this.introT = 1; }

    // Punkte setzen, die immer im Bild sein sollen (die Ecken der Objekt-Boxen). Einzeln statt als eine große Box,
    // weil die Objekte im Halbkreis in der Tiefe gestaffelt sind: Deren Ecken lägen weit vor bzw. hinter ihnen.
    frame(points) {
        if (!points.length) return;
        this.points = points;
        this.fit();
    }

    // Abstand per Bisektion: kleinster Abstand, bei dem alle Punkte im Bild liegen.
    // Funktioniert für jedes Seitenverhältnis, Hoch- wie Querformat (F-04).
    fit() {
        const cam = this.camera;
        const aspect = cam.aspect;
        const fromH = 2 * Math.atan(Math.tan(deg(this.hFov / 2)) / aspect);
        cam.fov = THREE.MathUtils.radToDeg(Math.min(fromH, deg(this.maxFov)));
        cam.updateProjectionMatrix();

        const target = new THREE.Box3().setFromPoints(this.points).getCenter(new THREE.Vector3());
        const corners = this.points;
        const p = new THREE.Vector3();
        const fits = (d) => {
            this.place(cam, target, d, this.pitchFor(target, d), 0);
            cam.updateMatrixWorld();
            return corners.every((c) => {
                p.copy(c).applyMatrix4(cam.matrixWorldInverse);
                if (p.z > -0.1) return false;
                p.applyMatrix4(cam.projectionMatrix);
                return Math.abs(p.x) <= this.margin && Math.abs(p.y) <= this.margin;
            });
        };
        let lo = 0.5, hi = 200;
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (fits(mid)) hi = mid; else lo = mid;
        }
        this.goal.target.copy(target);
        this.goal.distance = hi;
        if (!this.fitted) {
            this.cur.target.copy(target);
            this.cur.distance = hi;
            this.fitted = true;
        }
        this.place(cam, this.cur.target, this.cur.distance, this.pitchFor(this.cur.target, this.cur.distance), 0);
    }

    // Neigung, bei der die Kamera im Abstand `distance` genau auf `eyeHeight` steht
    pitchFor(target, distance) {
        return Math.asin(THREE.MathUtils.clamp((this.eyeHeight - target.y) / distance, -1, 1));
    }

    // Kameraposition in Ruhe (ohne Einstiegsfahrt und Mitschwenken)
    restPosition() {
        const pitch = this.pitchFor(this.goal.target, this.goal.distance);
        return new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(this.goal.distance).add(this.goal.target);
    }

    // Kamera auf einer Kugel um das Ziel platzieren
    place(cam, target, distance, pitch, yaw) {
        cam.position.set(
            target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
            target.y + Math.sin(pitch) * distance,
            target.z + Math.cos(yaw) * Math.cos(pitch) * distance
        );
        cam.lookAt(target);
    }

    update(dt) {
        if (this.introT < 1) this.introT = Math.min(1, this.introT + dt / this.introDuration);
        const k = easeInOut(this.introT);

        // Gedämpft nachziehen: Rahmenänderungen (Modelle laden nach) und Mausposition
        const damp = (rate) => 1 - Math.exp(-rate * dt);
        this.cur.target.lerp(this.goal.target, damp(5));
        this.cur.distance += (this.goal.distance - this.cur.distance) * damp(5);
        if (this.sway) this.cur.mouse.lerp(this.mouse, damp(2.5));
        const m = this.cur.mouse.clone().multiplyScalar(k);

        // Einstieg: von weiter hinten und etwas höher hereinfahren
        const distance = this.cur.distance * THREE.MathUtils.lerp(1.55, 1, k);
        const pitch = this.pitchFor(this.cur.target, this.cur.distance) + THREE.MathUtils.lerp(deg(7), 0, k) - m.y * this.swayPitch;
        this.place(this.camera, this.cur.target, distance, pitch, m.x * this.swayYaw);
        this.camera.rotateOnWorldAxis(UP, -m.x * this.swayPan);

        // Tiefenbereich an den Abstand koppeln: mit fester Near-Plane von 0,1 m reicht die Tiefenauflösung
        // auf 15 bis 25 m nicht mehr, nahe beieinander liegende Flächen (Monitorbild, Rückwand am Rack)
        // flackern, auf Handys mit 16-Bit-Tiefenpuffer besonders stark.
        // Höchstens 70 % der Tiefe, in der der untere Bildrand den Boden trifft, sonst fehlt dort der Boden
        // (mit Weitwinkel im Hochformat schon gut 3 m vor der Kamera).
        const half = deg(this.camera.fov / 2), down = Math.max(pitch + half, deg(5));
        const floorDepth = this.camera.position.y * Math.cos(half) / Math.sin(down);
        const near = THREE.MathUtils.clamp(distance * 0.2, 0.1, Math.max(0.1, floorDepth * 0.7)), far = distance * 3 + 30;
        if (this.camera.near !== near || this.camera.far !== far) {
            this.camera.near = near;
            this.camera.far = far;
            this.camera.updateProjectionMatrix();
        }
    }
}

function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function boxCorners(b) {
    const out = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        out.push(new THREE.Vector3(x, y, z));
    }
    return out;
}
