// Sprache (PRD F-60 bis F-62) und die festen Oberflächentexte, gemeinsam für Studio, Impressum und Datenschutz.
// Standard ist Englisch. Die Wahl liegt in localStorage; ohne localStorage (privater Modus) gilt sie bis zum Neuladen.

const KEY = 'lang';

export function initialLang() {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved === 'en' || saved === 'de') return saved;
    } catch { /* localStorage gesperrt */ }
    // erste Wahl: Browsersprache (F-62)
    const browser = navigator.languages?.[0] ?? navigator.language ?? '';
    return browser.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function saveLang(lang) {
    try { localStorage.setItem(KEY, lang); } catch { /* dann eben nur für diese Sitzung */ }
}

export const UI = {
    en: {
        cv: 'CV', contact: 'Contact', email: 'Email', linkedin: 'LinkedIn', github: 'GitHub',
        comingSoon: 'coming soon', language: 'Language', close: 'Close', projects: 'Projects',
        imprint: 'Imprint', privacy: 'Privacy', back: 'Back to the studio', listView: 'Skip 3D / list view',
        wip: 'Website work in progress', wipNote: 'Some content is still a placeholder.',
        rotate: 'Turn your phone sideways', rotateNote: 'The 3D studio only opens in landscape.',
    },
    de: {
        cv: 'CV', contact: 'Kontakt', email: 'E-Mail', linkedin: 'LinkedIn', github: 'GitHub',
        comingSoon: 'folgt', language: 'Sprache', close: 'Schließen', projects: 'Projekte',
        imprint: 'Impressum', privacy: 'Datenschutz', back: 'Zurück ins Studio', listView: '3D überspringen / Liste',
        wip: 'Website im Aufbau', wipNote: 'Manche Inhalte sind noch Platzhalter.',
        rotate: 'Handy bitte quer halten', rotateNote: 'Das 3D-Studio öffnet sich nur im Querformat.',
    },
};

// Texte mit `data-i18n="key"` und Beschriftungen mit `data-i18n-aria="key"` setzen
export function applyUI(root, lang) {
    const t = UI[lang];
    for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t[node.dataset.i18n];
    for (const node of root.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t[node.dataset.i18nAria]);
}

// Kontakt-Links aus content/site.json. Leere Felder bleiben als „folgt“ sichtbar, aber ohne Ziel.
export function contactLinks(contact = {}) {
    return {
        email: contact.email ? 'mailto:' + contact.email : '',
        linkedin: contact.linkedin ?? '',
        github: contact.github ?? '',
    };
}
