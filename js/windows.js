// Fenster-Inhalte (PRD F-30 bis F-36). `renderWindow` füllt das Fenster passend zum Fenstertyp aus der JSON.
// Schweres (PDF, Modell, Bilder) wird erst hier geladen, mit Ladeanzeige im Fenster (F-35).
// Rückgabe: Aufräumfunktion, die beim Schließen Animationen stoppt und WebGL freigibt.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const T = {
    de: {
        loading: 'Lädt …', error: 'Konnte nicht geladen werden.', download: 'Download', open: 'Öffnen',
        cvDownload: 'CV herunterladen (PDF)', skills: 'Skills', modelHint: 'Ziehen zum Drehen, Scrollen bzw. zwei Finger zum Zoomen',
        demoCaption: 'Schema: Der Ball trifft das Netz, die Sensoren am Rahmen hören den Einschlag, das System markiert den Punkt.',
    },
    en: {
        loading: 'Loading …', error: 'Could not be loaded.', download: 'Download', open: 'Open',
        cvDownload: 'Download CV (PDF)', skills: 'Skills', modelHint: 'Drag to rotate, scroll or pinch to zoom',
        demoCaption: 'Schematic: the ball hits the net, the sensors on the frame pick up the impact, the system marks the spot.',
    },
};

// `ctx`: { lang, mobile, reducedMotion, gltfLoader }
export function renderWindow(def, root, ctx) {
    const t = T[ctx.lang] ?? T.en;
    const cleanups = [];
    root.replaceChildren();
    root.dataset.window = def.window ?? 'text+links';

    for (const tag of def.tags ?? []) el('div', root, tag).className = 'tag';
    el('h2', root, def.title[ctx.lang]).id = 'project-title';

    const texts = () => { for (const text of def.text?.[ctx.lang] ?? []) el('p', root, text); };
    switch (def.window) {
        case 'pdf':
            texts();
            pdfView(def, root, ctx, t);
            break;
        case 'media+text+download':
            texts();
            cleanups.push(impactDemo(el('figure', root), ctx, t));
            if (def.download) buttons(root, [{ ...def.download, download: true }], ctx.lang);
            break;
        case 'model+text':
            cleanups.push(modelView(def.windowModel || def.model, el('div', root), ctx, t));
            texts();
            break;
        default: // text+links
            texts();
            if (def.skills?.length) {
                el('h3', root, t.skills);
                const list = el('ul', root);
                list.className = 'skills';
                for (const s of def.skills) el('li', list, s);
            }
    }
    if (def.links?.length) buttons(root, def.links, ctx.lang);
    return () => cleanups.forEach((fn) => fn?.());
}

function el(tag, parent, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
}

function buttons(root, links, lang) {
    const row = el('div', root);
    row.className = 'actions';
    for (const link of links) {
        const a = el('a', row, typeof link.label === 'string' ? link.label : link.label[lang]);
        a.href = link.url;
        a.className = 'btn' + (link.primary ? ' primary' : '');
        if (link.download) a.setAttribute('download', '');
        else if (!link.sameTab) { a.target = '_blank'; a.rel = 'noopener'; }
    }
    return row;
}

function loader(parent, t) {
    const box = el('div', parent);
    box.className = 'loading';
    box.setAttribute('role', 'status');
    el('span', box).className = 'spinner';
    el('span', box, t.loading);
    return {
        done: () => box.remove(),
        fail: () => { box.replaceChildren(); el('span', box, t.error); box.classList.add('failed'); },
    };
}

// F-30: CV als PDF. Desktop: eingebettet. Handy (Einbettung unzuverlässig): Vorschaubild plus Öffnen und Download.
// Gibt es keine Version in der Sprache, gilt EN.
function pdfView(def, root, ctx, t) {
    const pick = (field) => field?.[ctx.lang] || field?.en;
    const url = pick(def.pdf);
    if (!url) return;
    const frame = el('div', root);
    frame.className = 'pdf' + (ctx.mobile ? ' preview' : '');
    const load = loader(frame, t);
    if (ctx.mobile) {
        const img = el('img', frame);
        img.alt = def.title[ctx.lang];
        img.onload = load.done;
        img.onerror = load.fail;
        img.src = pick(def.preview) ?? '';
        buttons(root, [{ label: t.open, url, primary: true }, { label: t.download, url, download: true }], ctx.lang);
    } else {
        const iframe = el('iframe', frame);
        iframe.title = def.title[ctx.lang];
        iframe.onload = load.done;
        iframe.src = url;
        setTimeout(load.done, 4000); // manche Browser melden bei PDFs kein `load`
        buttons(root, [{ label: t.cvDownload, url, download: true, primary: true }], ctx.lang);
    }
}

// F-31: Spikeball-Netz von oben. Ein Ball schlägt ein, die Druckwelle läuft zu den Sensoren am Rahmen,
// danach markiert das System den Punkt. Schematisch, bis echte Messdaten da sind.
function impactDemo(figure, ctx, t) {
    figure.className = 'impact-demo';
    const canvas = el('canvas', figure);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t.demoCaption);
    el('figcaption', figure, t.demoCaption);
    const g = canvas.getContext('2d');
    const sensors = [0, 1, 2, 3, 4].map((i) => (i / 5) * Math.PI * 2 - Math.PI / 2);
    let hit = null, start = 0, raf = 0;

    const next = (now) => {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.78;
        hit = { x: Math.cos(a) * r, y: Math.sin(a) * r, ex: (Math.random() - 0.5) * 0.05, ey: (Math.random() - 0.5) * 0.05 };
        start = now;
    };

    const draw = (now) => {
        const size = canvas.clientWidth;
        const dpr = Math.min(window.devicePixelRatio, 2);
        if (canvas.width !== Math.round(size * dpr)) { canvas.width = canvas.height = Math.round(size * dpr); }
        const s = canvas.width / 2, R = s * 0.8;
        g.setTransform(1, 0, 0, 1, s, s);
        g.clearRect(-s, -s, s * 2, s * 2);
        const P = (x, y) => [x * R, y * R];
        const time = ctx.reducedMotion ? 2.2 : (now - start) / 1000;
        if (!hit || time > 3.6) { next(now); return draw(now); } // neuer Einschlag, gleich zeichnen

        // Netz: Raster im Kreis, Rahmen gelb
        g.save();
        g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
        g.fillStyle = '#f4f4f6'; g.fillRect(-R, -R, R * 2, R * 2);
        g.strokeStyle = 'rgba(30,30,34,0.18)'; g.lineWidth = Math.max(1, s / 200);
        for (let v = -R; v <= R; v += R / 9) {
            g.beginPath(); g.moveTo(v, -R); g.lineTo(v, R); g.stroke();
            g.beginPath(); g.moveTo(-R, v); g.lineTo(R, v); g.stroke();
        }
        g.restore();
        g.strokeStyle = '#f5c400'; g.lineWidth = s * 0.07;
        g.beginPath(); g.arc(0, 0, R + s * 0.035, 0, Math.PI * 2); g.stroke();

        const [hx, hy] = P(hit.x, hit.y);
        // Anflug: Schatten wird kleiner und dunkler
        if (time < 0.7) {
            const k = time / 0.7;
            g.fillStyle = `rgba(20,20,24,${0.08 + 0.25 * k})`;
            g.beginPath(); g.arc(hx, hy, s * (0.16 - 0.1 * k), 0, Math.PI * 2); g.fill();
        }
        // Einschlag: Wellen laufen nach außen
        if (time >= 0.7) {
            const k = time - 0.7;
            for (let i = 0; i < 3; i++) {
                const rr = (k - i * 0.15) * R * 1.6;
                if (rr <= 0 || rr > R * 2) continue;
                g.strokeStyle = `rgba(245,196,0,${Math.max(0, 0.8 - rr / (R * 2))})`;
                g.lineWidth = s * 0.012;
                g.beginPath(); g.arc(hx, hy, rr, 0, Math.PI * 2); g.stroke();
            }
            if (time < 1.6) { g.fillStyle = '#111'; g.beginPath(); g.arc(hx, hy, s * 0.05, 0, Math.PI * 2); g.fill(); }
        }
        // Sensoren am Rahmen; leuchten auf, sobald die Welle sie erreicht
        for (const a of sensors) {
            const sx = Math.cos(a) * (R + s * 0.035), sy = Math.sin(a) * (R + s * 0.035);
            const reached = time >= 0.7 && (time - 0.7) * R * 1.6 >= Math.hypot(sx - hx, sy - hy);
            g.fillStyle = reached ? '#111' : '#8a8a90';
            g.fillRect(sx - s * 0.03, sy - s * 0.03, s * 0.06, s * 0.06);
            if (reached && time > 1.6) {
                g.strokeStyle = 'rgba(17,17,17,0.25)'; g.lineWidth = Math.max(1, s / 250);
                g.setLineDash([s * 0.02, s * 0.02]);
                g.beginPath(); g.moveTo(sx, sy); g.lineTo(...P(hit.x + hit.ex, hit.y + hit.ey)); g.stroke();
                g.setLineDash([]);
            }
        }
        // Ergebnis: Fadenkreuz am geschätzten Punkt plus Koordinaten (Netz-Radius ca. 45 cm)
        if (time > 1.6) {
            const [mx, my] = P(hit.x + hit.ex, hit.y + hit.ey);
            const c = s * 0.07;
            g.strokeStyle = '#111'; g.lineWidth = s * 0.012;
            g.beginPath(); g.arc(mx, my, c, 0, Math.PI * 2); g.stroke();
            g.beginPath(); g.moveTo(mx - c * 1.6, my); g.lineTo(mx + c * 1.6, my); g.moveTo(mx, my - c * 1.6); g.lineTo(mx, my + c * 1.6); g.stroke();
            g.font = `600 ${Math.round(s * 0.06)}px ui-monospace, monospace`;
            g.fillStyle = '#111';
            g.textAlign = mx > 0 ? 'right' : 'left';
            const label = `x ${Math.round((hit.x + hit.ex) * 45)} cm · y ${Math.round(-(hit.y + hit.ey) * 45)} cm`;
            g.fillText(label, mx + (mx > 0 ? -c * 1.9 : c * 1.9), my - c * 1.1);
        }
    };

    const loop = (now) => { draw(now); raf = requestAnimationFrame(loop); };
    if (ctx.reducedMotion) {
        const ro = new ResizeObserver(() => draw(performance.now()));
        ro.observe(canvas);
        return () => ro.disconnect();
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
}

// F-32: Drehbares Modell im Fenster, hier sind Drehen und Zoomen erlaubt
function modelView(url, box, ctx, t) {
    box.className = 'model-view';
    const load = loader(box, t);
    el('p', box, t.modelHint).className = 'hint';
    if (!url) { load.fail(); return null; }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    box.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = !ctx.reducedMotion;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    let model = null, raf = 0, disposed = false;
    const resize = () => {
        const w = box.clientWidth, h = box.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    ctx.gltfLoader.load(url, (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        scene.add(model);
        const b = new THREE.Box3().setFromObject(model);
        const center = b.getCenter(new THREE.Vector3());
        const radius = b.getBoundingSphere(new THREE.Sphere()).radius;
        const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(dist));
        camera.near = dist / 100;
        camera.far = dist * 10;
        camera.updateProjectionMatrix();
        controls.minDistance = radius * 0.4;
        controls.maxDistance = dist * 2;
        controls.maxPolarAngle = Math.PI * 0.55; // nicht unter den Boden
        load.done();
    }, undefined, () => { if (!disposed) load.fail(); });

    const loop = () => {
        raf = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
    };
    loop();

    return () => {
        disposed = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        model?.traverse((o) => {
            if (!o.isMesh) return;
            o.geometry.dispose();
            for (const m of [o.material].flat()) {
                for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
                m.dispose();
            }
        });
        env.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
    };
}
