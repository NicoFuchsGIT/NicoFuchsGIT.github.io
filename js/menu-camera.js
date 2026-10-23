// Menü-Kamera (PRD F-03 bis F-05): steht fest, schwenkt am Desktop nur minimal mit der Maus mit,
// rückt so weit zurück, dass alle Objekte im Bild sind, und fährt einmal ins Studio hinein.
// Kein Zoom, kein Drehen, keine OrbitControls.
import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

export class MenuCamera {
    constructor(camera, {
        eyeHeight = 1.9,       // Kamerahöhe in Metern: knapp über Augenhöhe der 1,80 m großen Figur
        swayYaw = deg(2.5),    // Mitschwenken links/rechts
        swayPitch = deg(1.2),  // Mitschwenken oben/unten
        margin = 0.9,          // Anteil des Bildes (NDC), den der Rahmen höchstens füllt
        introDuration = 1.5,
        sway = true,
        intro = true,
    } = {}) {
        this.camera = camera;
        this.eyeHeight = eyeHeight;
        this.swayYaw = swayYaw;
        this.swayPitch = swayPitch;
        this.margin = margin;
        this.sway = sway;
        this.introDuration = introDuration;
        this.introT = intro ? 0 : 1;

        this.box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
        this.goal = { target: new THREE.Vector3(), distance: 10 };
        this.cur = { target: new THREE.Vector3(), distance: 10, yaw: 0, pitch: 0 };
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

    // Rahmen setzen, der immer ganz im Bild sein soll (Union der Objekt-Boxen)
    frame(box) {
        this.box.copy(box);
        this.fit();
    }

    // Abstand per Bisektion: kleinster Abstand, bei dem alle 8 Ecken der Box im Bild liegen.
    // Funktioniert für jedes Seitenverhältnis, Hoch- wie Querformat (F-04).
    fit() {
        const cam = this.camera;
        const target = this.box.getCenter(new THREE.Vector3());
        const corners = boxCorners(this.box);
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
        const yawGoal = this.sway ? this.mouse.x * this.swayYaw : 0;
        const pitchGoal = this.sway ? -this.mouse.y * this.swayPitch : 0;
        this.cur.yaw += (yawGoal - this.cur.yaw) * damp(2.5);
        this.cur.pitch += (pitchGoal - this.cur.pitch) * damp(2.5);

        // Einstieg: von weiter hinten und etwas höher hereinfahren
        const distance = this.cur.distance * THREE.MathUtils.lerp(1.55, 1, k);
        const pitch = this.pitchFor(this.cur.target, this.cur.distance) + THREE.MathUtils.lerp(deg(7), 0, k) + this.cur.pitch * k;
        const yaw = this.cur.yaw * k;
        this.place(this.camera, this.cur.target, distance, pitch, yaw);

        // Tiefenbereich an den Abstand koppeln: mit fester Near-Plane von 0,1 m reicht die Tiefenauflösung
        // auf 15 bis 25 m nicht mehr, nahe beieinander liegende Flächen (Monitorbild, Rückwand am Rack)
        // flackern, auf Handys mit 16-Bit-Tiefenpuffer besonders stark.
        // Höchstens 3 m: der Boden am unteren Bildrand liegt bei 1,9 m Kamerahöhe gut 4 m vor der Kamera.
        const near = THREE.MathUtils.clamp(distance * 0.2, 0.1, 3), far = distance * 3 + 30;
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
