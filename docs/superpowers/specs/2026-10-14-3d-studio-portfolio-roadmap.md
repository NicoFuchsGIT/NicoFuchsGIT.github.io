# 3D-Studio-Portfolio – Roadmap

Stand: 2026-10-14 · Grundlage: [PRD](2026-10-14-3d-studio-portfolio-prd.md) · [Design-Dokument](2026-10-14-3d-studio-portfolio-design.md)

Am Ende jeder Phase steht etwas, das man **herzeigen kann**, auch mit Platzhaltern. Die Reihenfolge folgt den Anti-Zielen: Ladezeit, Handy und Look werden zuerst abgesichert, Inhalte und Feinschliff kommen danach. Entwickelt wird auf einem eigenen Branch. Auf `main` kommt erst Phase 5.

Feste Termine gibt es keine. Die Größenangabe (S/M/L) ist eine grobe Einschätzung des Aufwands.

```
Phase 0  Design & Anforderungen        ✅ erledigt
Phase 1  Fundament: Studio & Kamera    ← nächster Schritt
Phase 2  Objekte & Interaktion
Phase 3  Fenster & Inhalte
Phase 4  Sprache, Fallback, Rechtliches
Phase 5  Feinschliff & Launch          → main / live
Danach   Scan, echte Modelle, TU Edge, …
```

---

## Phase 0 – Design und Anforderungen ✅

- Design-Dokument, Mockups (Frontal, Draufsicht-Varianten), PRD, Roadmap.
- **Ergebnis:** Klarheit über Look, Objekte, Fenstertypen, Geräte und Grenzen.

## Phase 1 – Fundament: Studio und Kamera (M)

**Ziel:** Das leere Studio steht, sieht gut aus und lädt schnell, auf Handy und Desktop. Hier entscheidet sich, ob die Anti-Ziele halten.

- Dateistruktur anlegen (z. B. `index.html`, `js/`, `assets/`, `content/`, `vendor/`).
- three.js plus Addons (GLTFLoader, Draco- bzw. Meshopt-Decoder) selbst hosten, Import-Map aufs Repo umstellen (N-05, N-06).
- Studio: Hohlkehle, spiegelnder Boden, Lichtband, Softboxen, Environment-Map, Fake-Kontaktschatten (F-01, F-02, F-06).
- Menü-Kamera mit minimalem Mitschwenken am Desktop, Bildausschnitt passt sich ans Seitenverhältnis an (F-03, F-04).
- Handy-Variante der Render-Qualität (N-03, N-02).
- Schlichter Ladebildschirm mit Nicos Namen.
- **Budget-Messung einrichten** (Lighthouse Mobile, gedrosselt) und ab jetzt bei jeder Phase prüfen (N-01).

**Fertig, wenn:** Das Studio mit grauen Platzhalter-Blöcken auf echtem Handy und Desktop flüssig läuft, in < 3 s und < 3 MB lädt und Nico den Look freigibt („kein Pappkarton“).

## Phase 2 – Objekte und Interaktion (M)

**Ziel:** Alle sechs Objekte stehen im Studio und reagieren, gesteuert aus einer einzigen Daten-Datei.

- `content/objects.json` mit Schema (ID, Position, Größe, Modell, Fenstertyp, Texte EN/DE, Links, `visible`) plus README (F-10, F-15, N-08).
- Stilisierte Platzhalter: Woodworking-Möbel, Powerlifting-Rack, Spikeball-Netz, SunCafe, Pult mit Monitor. Startanordnung laut Mockup, verschiebbar über JSON (F-11, F-12).
- Nico als stilisierter Avatar (F-13). Erst neutral, dann nach Nicos Angaben angepasst.
- Hover-Schein und Label am Desktop, dauerhafte Labels am Handy, HTML-Tap-Flächen ≥ 44 px (F-20 bis F-22).
- Hochformat-Anordnung in zwei Reihen (N-03).
- Klick öffnet ein leeres Fenster-Gerüst (Karte bzw. Sheet), Schließen per ×, daneben, Esc, Zurück (F-23, F-36).
- Deep-Links `#objekt` und Tastaturbedienung (F-24, F-25).

**Fertig, wenn:** Jedes Objekt auf Handy (hoch und quer) und Desktop zuverlässig sein Fenster öffnet und Nico ein Objekt allein durch Bearbeiten der JSON verschieben kann.

**Von Nico gebraucht:** Angaben bzw. Fotos für den Avatar (Statur, Frisur, Kleidungsfarben).

## Phase 3 – Fenster und Inhalte (L)

**Ziel:** Jedes Fenster zeigt seinen eigenen, passenden Inhalt, lazy geladen.

- `pdf`: CV mit Download, Handy-Variante mit Vorschaubild und Öffnen (F-30).
- `media+text+download`: Spikeball mit Erklärung, Einschlag-Visualisierung und Paper-Download (F-31).
- `model+text`: Woodworking mit drehbarem Modell im Fenster (F-32).
- `text+links`: Pult, Powerlifting, SunCafe (F-33, F-34).
- Lazy Loading mit Ladeanzeige im Fenster (F-35).
- Platzhalter-Dateien für alles, was Nico noch nicht geliefert hat.

**Fertig, wenn:** Alle vier Fenstertypen funktionieren und das Ladebudget trotzdem eingehalten ist, weil die Inhalte erst beim Öffnen laden.

**Von Nico gebraucht (sobald verfügbar):** CV-PDF, Paper-PDF, Spikeball-Text bzw. -Grafiken, Woodworking-Modell oder -Fotos, Texte für Powerlifting, SunCafe und Pult. Fehlendes bleibt Platzhalter.

## Phase 4 – Sprache, Fallback, Rechtliches (M)

**Ziel:** Die Seite ist zweisprachig, hat immer einen Weg ohne 3D und ist rechtlich sauber.

- Sprachumschalter EN/DE, die Wahl wird gespeichert. „English only“ beim Paper (F-60, F-61).
- Dauerhafte Bedienelemente: CV, Contact, LinkedIn, Sprache, „Skip 3D / list view“, Impressum, Datenschutz (F-40 bis F-43).
- Listenansicht aus derselben JSON, automatischer Fallback bei fehlendem WebGL bzw. Ladefehler, Grundinhalt ohne JavaScript (F-50 bis F-52).
- Impressum (E-Mail und Instagram) und Datenschutz, beides EN/DE (F-70, F-71).
- Barrierefreiheit: Dialog-Semantik, Fokusfalle, Kontraste (N-07).

**Fertig, wenn:** Ein Browser ohne WebGL eine vollständige, schöne Liste zeigt, alle Texte in EN und DE da sind und Impressum und Datenschutz verlinkt sind.

**Von Nico gebraucht:** E-Mail, LinkedIn-URL, Instagram-Handle. Freigabe der DE-Texte.

## Phase 5 – Feinschliff und Launch (M)

**Ziel:** Der Wow-Moment sitzt, alles ist gemessen, die Seite geht live.

- Einstiegs-Kamerafahrt mit Licht-an, überspringbar, `prefers-reduced-motion` (F-05).
- Feintuning von Licht und Materialien, Animationen und Übergängen der Fenster.
- Link-Vorschau (Open Graph), Favicon, `robots.txt`, QR-Code-SVG (F-72 bis F-75).
- Abschluss-Messung des Ladebudgets und Gerätetest-Matrix (iOS Safari, Android Chrome, Desktop Chrome, Safari, Firefox; hoch und quer).
- Abnahme nach PRD §12, dann Merge auf `main`. Der alte Prototyp wird ersetzt.

**Fertig, wenn:** Die Abnahmekriterien aus PRD §12 erfüllt sind und die Seite unter `nicofuchsgit.github.io` live ist.

---

## Danach (ohne feste Reihenfolge)

| Thema | Auslöser | Aufwand |
|---|---|---|
| 3D-Scan von Nico statt Avatar (F-14) | Scan liegt vor und besteht den Kompressionstest (≤ ca. 2 MB) | S–M |
| Echte Modelle statt Platzhalter (Rack, Netz, SunCafe, Pult) | Modelle verfügbar bzw. Lust auf Upgrade | je S |
| Inhalte Powerlifting und SunCafe ausbauen, ggf. eigene Fenstertypen | Nico liefert Material | S–M |
| **TU Edge** als Auto hinten mittig | Aufnahme bei TU Wien Racing | M |
| Eigene Domain | Domain registriert (dann nur `CNAME`) | S |
| Browsersprache als Standard (F-62) | bei Bedarf | S |
| Positions-Editor im Browser | wenn das Verschieben per JSON nervt | M |

## Abhängigkeiten auf einen Blick

```
Phase 1 ──► Phase 2 ──► Phase 3 ──┐
                 └────► Phase 4 ──┴──► Phase 5 ──► Launch
Nicos Assets: Avatar-Angaben (P2) · PDFs, Texte, Modelle (P3) · Kontaktdaten, DE-Freigabe (P4)
```

Die Phasen 3 und 4 können parallel laufen, sobald Phase 2 steht.
