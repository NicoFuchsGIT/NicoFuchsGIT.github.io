// Listenansicht (PRD F-50 bis F-52): alle sichtbaren Objekte aus content/objects.json als Karten, ohne WebGL und
// ohne three.js. `?fallback=…` kommt vom Studio, wenn es nicht starten konnte (F-51), `#id` springt zum Projekt.
import { initialLang, saveLang, applyUI, contactLinks } from './i18n.js';

const T = {
    en: {
        studio: '3D studio', cv: 'CV', cvOpen: 'Open CV (PDF)', cvDownload: 'Download full CV (PDF)', view3d: 'View in 3D',
        skills: 'Skills', enOnly: 'English only', email: 'Email',
        fallback: {
            webgl: 'Your browser cannot show 3D graphics (WebGL), so here is the list view with the same content.',
            browser: 'Your browser is too old for the 3D studio, so here is the list view with the same content.',
            error: 'The 3D studio could not be loaded, so here is the list view with the same content.',
            timeout: 'The 3D studio is taking too long to load, so here is the list view with the same content.',
        },
        retry: 'Try the 3D studio again',
    },
    de: {
        studio: '3D-Studio', cv: 'Lebenslauf', cvOpen: 'CV öffnen (PDF)', cvDownload: 'Ganzes CV herunterladen (PDF)', view3d: 'In 3D ansehen',
        skills: 'Skills', enOnly: 'English only', email: 'E-Mail',
        fallback: {
            webgl: 'Dein Browser kann keine 3D-Grafik (WebGL) anzeigen, deshalb siehst du die Listenansicht mit denselben Inhalten.',
            browser: 'Dein Browser ist für das 3D-Studio zu alt, deshalb siehst du die Listenansicht mit denselben Inhalten.',
            error: 'Das 3D-Studio konnte nicht geladen werden, deshalb siehst du die Listenansicht mit denselben Inhalten.',
            timeout: 'Das 3D-Studio lädt zu lange, deshalb siehst du die Listenansicht mit denselben Inhalten.',
        },
        retry: '3D-Studio erneut versuchen',
    },
};

const fallback = new URLSearchParams(location.search).get('fallback');
// Ohne WebGL bzw. mit zu altem Browser würde das Studio sofort wieder hierher leiten
const noStudio = fallback === 'webgl' || fallback === 'browser';

const load = async (url) => (await fetch(url)).json();
// Lässt sich objects.json nicht laden, bleibt der statische Grundinhalt aus list.html stehen
const [content, site] = await Promise.all([load('content/objects.json').catch(() => null), load('content/site.json').catch(() => ({}))]);

// CV (Fenstertyp `pdf`) zuerst, danach wie im Studio von links nach rechts
const items = (content?.objects ?? [])
    .filter((o) => o.visible !== false)
    .sort((a, b) => (b.window === 'pdf') - (a.window === 'pdf') || (a.position?.[0] ?? 0) - (b.position?.[0] ?? 0));

function el(tag, parent, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
}

const label = (value, lang) => (typeof value === 'string' ? value : value?.[lang] ?? value?.en ?? '');
const pick = (field, lang) => (typeof field === 'string' ? field : field?.[lang] || field?.en);

function button(parent, { text, url, primary, download, fileLang }, lang, t) {
    const a = el('a', parent, text, 'btn' + (primary ? ' primary' : ''));
    a.href = url;
    if (download) a.setAttribute('download', '');
    else if (/^https?:/.test(url)) { a.target = '_blank'; a.rel = 'noopener'; }
    if (fileLang && fileLang !== lang) {
        a.hreflang = fileLang;
        el('span', a, t.enOnly, 'only');
    }
}

function render(lang) {
    const t = T[lang];
    const note = document.getElementById('fallback-note');
    note.replaceChildren();
    note.hidden = !t.fallback[fallback];
    if (!note.hidden) {
        el('span', note, t.fallback[fallback] + ' ');
        if (!noStudio) el('a', note, t.retry).href = './';
    }

    if (!items.length) return;
    const list = document.getElementById('list');
    list.replaceChildren();
    for (const def of items) {
        const card = el('article', list, undefined, 'item');
        card.id = def.id;
        if (def.tags?.length) {
            const tags = el('div', card, undefined, 'tags');
            for (const tag of def.tags) el('span', tags, tag, 'tag');
        }
        el('h2', card, label(def.title, lang));
        for (const text of def.text?.[lang] ?? def.text?.en ?? []) el('p', card, text);
        if (def.skills?.length) {
            const skills = el('ul', card, undefined, 'skills');
            skills.setAttribute('aria-label', t.skills);
            for (const s of def.skills) el('li', skills, s);
        }

        const actions = el('div', card, undefined, 'actions');
        if (def.window === 'pdf' && def.pdf) {
            const fileLang = def.pdf[lang] ? lang : 'en';
            button(actions, { text: t.cvOpen, url: pick(def.pdf, lang), primary: true, fileLang }, lang, t);
            const full = pick(def.download?.url, lang);
            if (full) button(actions, { text: t.cvDownload, url: full, download: true }, lang, t);
        } else if (def.download?.url) {
            button(actions, { text: label(def.download.label, lang), url: pick(def.download.url, lang), download: true, fileLang: def.download.lang }, lang, t);
        }
        for (const link of def.links ?? []) {
            button(actions, { text: label(link.label, lang), url: link.url, primary: link.primary, download: link.download }, lang, t);
        }
        if (!noStudio) button(actions, { text: t.view3d, url: './#' + encodeURIComponent(def.id) }, lang, t);
        if (!actions.children.length) actions.remove();
    }
}

function setLang(lang) {
    document.documentElement.lang = lang;
    for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    applyUI(document, lang);
    for (const node of document.querySelectorAll('[data-list="studio"]')) node.textContent = T[lang].studio;
    if (site.title?.[lang]) document.getElementById('site-title').textContent = site.title[lang];
    document.title = `${site.name ?? 'Nico Fuchs'} – ${lang === 'de' ? 'CV & Projekte' : 'CV & Projects'}`;
    render(lang);
}

// Kopf: Name, „im Aufbau“, Kontakt aus site.json (das statische HTML ist nur der Rückfall ohne JavaScript)
if (site.name) document.getElementById('site-name').textContent = site.name;
document.getElementById('wip').hidden = site.wip === false;
const contact = contactLinks(site.contact);
const email = document.getElementById('contact-email');
const linkedin = document.getElementById('contact-linkedin');
if (contact.email) { email.href = contact.email; email.textContent = site.contact.email; } else email.remove();
if (contact.linkedin) linkedin.href = contact.linkedin; else linkedin.remove();
document.getElementById('studio-link').hidden = noStudio;

for (const b of document.querySelectorAll('.lang button')) {
    b.addEventListener('click', () => { saveLang(b.dataset.lang); setLang(b.dataset.lang); });
}
document.querySelector('.lang').hidden = false;
setLang(initialLang());

// Direktlink `list.html#spikeball`: nach dem Aufbau der Liste dorthin springen
if (location.hash) {
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* kaputter Hash */ }
    const card = document.getElementById(id);
    card?.classList.add('current'); // :target greift bei nachträglich gebauten Karten nicht zuverlässig
    card?.scrollIntoView();
}
