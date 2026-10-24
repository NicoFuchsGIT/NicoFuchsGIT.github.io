// HTML-Labels über den Objekten (PRD F-20 bis F-22, F-25).
// Jedes Label ist ein <button>: Klick- bzw. Tap-Fläche von mindestens 44 × 44 px, mit Tab erreichbar, Enter öffnet.
// Desktop: Label erscheint beim Hover über Objekt oder Label und bei Tastaturfokus. Handy: immer sichtbar.
import * as THREE from 'three';

export class Labels {
    constructor(container, items, lang, { alwaysVisible = false, onOpen, avoid = [] } = {}) {
        this.container = container;
        this.avoid = avoid; // Bedienelemente (Kopfzeile, Leiste), die kein Label überdecken soll
        this.alwaysVisible = alwaysVisible;
        this.sceneHover = null; // vom Raycast im Studio
        this.labelHover = null; // Maus über einem Label
        this.focused = null;    // Tastaturfokus
        this.entries = [];

        container.classList.toggle('always', alwaysVisible);
        // Tab-Reihenfolge wie im Bild: von links nach rechts
        const sorted = [...items].sort((a, b) => a.group.position.x - b.group.position.x);
        for (const item of sorted) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'obj-label';
            // Button = Tap-Fläche (44 px), die Pille darin ist kleiner
            const pill = document.createElement('span');
            el.appendChild(pill);
            el.dataset.id = item.id;
            el.addEventListener('click', () => onOpen?.(item.id));
            el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.labelHover = item.id; });
            el.addEventListener('pointerleave', () => { if (this.labelHover === item.id) this.labelHover = null; });
            // nur sichtbarer Tastaturfokus hebt hervor, nicht der Fokus nach einem Mausklick
            el.addEventListener('focus', () => { this.focused = el.matches(':focus-visible') ? item.id : null; });
            el.addEventListener('blur', () => { if (this.focused === item.id) this.focused = null; });
            container.appendChild(el);
            this.entries.push({ item, el, pill, w: 0, h: 0 });
        }
        this.setLang(lang);
    }

    // Sprachwechsel (F-60): Texte tauschen, Breite beim nächsten update neu messen
    setLang(lang) {
        for (const e of this.entries) {
            const def = e.item.def;
            e.pill.textContent = def.label?.[lang] ?? def.title?.[lang] ?? e.item.id;
            e.w = 0;
        }
    }

    // Objekt, das gerade hervorgehoben ist (Schein unter dem Objekt)
    get active() { return this.labelHover ?? this.sceneHover ?? this.focused; }

    element(id) { return this.entries.find((e) => e.item.id === id)?.el; }

    // Labels über die Oberkante des Objekts setzen. Sichtbare Labels, die sich überdecken würden,
    // rücken nach oben (am Handy sind alle gleichzeitig sichtbar); landen sie dabei auf Kopfzeile oder Leiste
    // bzw. über dem Bildrand, rücken sie stattdessen nach unten.
    update(camera, width, height) {
        const p = new THREE.Vector3();
        const active = this.active;
        for (const e of this.entries) {
            const b = e.item.box;
            p.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(camera);
            e.onScreen = p.z < 1 && Math.abs(p.x) <= 1.1 && Math.abs(p.y) <= 1.1;
            if (!e.w) { e.w = e.pill.offsetWidth; e.h = e.pill.offsetHeight; } // erst messbar, wenn gelayoutet
            // nicht über den Bildrand hinaus
            e.x = THREE.MathUtils.clamp((p.x + 1) / 2 * width, e.w / 2 + 8, Math.max(e.w / 2 + 8, width - e.w / 2 - 8));
            e.y = (1 - p.y) / 2 * height - 4; // Unterkante der Pille
        }
        // Rechtecke wie die Labels: x = Mitte, y = Unterkante
        const ui = this.avoid.filter((el) => el?.getClientRects().length).map((el) => {
            const r = el.getBoundingClientRect();
            return { x: (r.left + r.right) / 2, y: r.bottom, w: r.width, h: r.height };
        });
        // von unten nach oben: die unteren Labels bleiben, die darüber weichen aus
        const placed = [...ui];
        for (const e of [...this.entries].sort((a, b) => b.y - a.y)) {
            const shown = e.onScreen && (this.alwaysVisible || e.item.id === active);
            let y = e.y;
            if (shown && e.w) {
                // Abstand 4 px; am Handy (alle Labels sichtbar) so viel, dass sich die 44 px hohen Tippflächen nicht
                // überlappen. Ausweichen um 1 px mehr, damit Rundungsfehler keine Endlosschleife ergeben.
                const gap = this.alwaysVisible ? Math.max(4, 44 - e.h) : 4;
                const hit = (y) => placed.find((r) => Math.abs(r.x - e.x) < (r.w + e.w) / 2 + 4 && y > r.y - r.h - gap && y - e.h - gap < r.y);
                let up = y;
                for (let r = hit(up); r; r = hit(up)) up = r.y - r.h - gap - 1;
                if (up - e.h >= 0) y = up;
                else for (let r = hit(y); r; r = hit(y)) y = r.y + e.h + gap + 1;
                placed.push({ x: e.x, y, w: e.w, h: e.h });
            }
            e.el.style.transform = `translate(${e.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-50% - ${(e.h / 2).toFixed(1)}px))`;
            e.el.classList.toggle('shown', shown);
            e.el.classList.toggle('active', e.item.id === active);
        }
    }
}
