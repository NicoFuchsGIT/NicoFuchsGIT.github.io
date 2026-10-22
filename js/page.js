// Impressum und Datenschutz: zeigt die gewählte Sprache und trägt die Kontaktdaten aus content/site.json ein.
// Ohne JavaScript stehen beide Sprachen untereinander.
import { initialLang, saveLang, applyUI, contactLinks } from './i18n.js';

function setLang(lang) {
    document.documentElement.lang = lang;
    for (const s of document.querySelectorAll('section[lang]')) s.hidden = s.lang !== lang;
    for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    applyUI(document, lang);
    const title = document.querySelector(`section[lang="${lang}"] h1`);
    if (title) document.title = title.textContent + ' – Nico Fuchs';
}

for (const b of document.querySelectorAll('.lang button')) {
    b.addEventListener('click', () => { saveLang(b.dataset.lang); setLang(b.dataset.lang); });
}
document.querySelector('.lang').hidden = false;
setLang(initialLang());

try {
    const site = await (await fetch('content/site.json')).json();
    const links = contactLinks(site.contact);
    const shown = { email: site.contact?.email, linkedin: site.contact?.linkedin?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') };
    for (const a of document.querySelectorAll('a[data-contact]')) {
        const key = a.dataset.contact;
        if (!links[key]) continue; // bleibt „folgt“
        a.href = links[key];
        a.textContent = shown[key] ?? links[key];
    }
} catch { /* dann bleibt „folgt“ stehen */ }
