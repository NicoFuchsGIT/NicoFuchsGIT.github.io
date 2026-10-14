# 3D-Studio-Portfolio – Product Requirements Document (PRD)

Stand: 2026-10-14 · Version 1.0 · Owner: Nico Fuchs
Grundlage: [Design-Dokument](2026-10-14-3d-studio-portfolio-design.md) · Umsetzungsreihenfolge: [Roadmap](2026-10-14-3d-studio-portfolio-roadmap.md)

Das Design-Dokument beschreibt das **Warum und das Wie**. Dieses PRD legt fest, **was Version 1 können muss**, damit sie fertig ist, und zwar so, dass man es prüfen kann.

---

## 1. Überblick

Eine persönliche Website von Nico Fuchs (R&D Engineer: Sports Engineering, Rennsport, Data Science), die **CV und Portfolio in einem** ist. Man sieht ein **weißes 3D-Fotostudio**, in dem Objekte stehen. Jedes steht für ein Projekt oder einen Teil des CVs, und ein Klick öffnet den passenden Inhalt.

Hauptsächlich ist sie ein **Herzeige-Objekt fürs direkte Gespräch**: Nico zeigt sie am eigenen Handy oder Laptop, oder er schickt danach den Link. Sie ist kein Online-Shop und macht kein kommerzielles Angebot.

## 2. Problem

Ein PDF-Lebenslauf und ein LinkedIn-Profil sehen bei allen gleich aus. Wer in Sports Engineering, Motorsport oder Data Science punkten will, soll in wenigen Sekunden zeigen können, dass er Technik, Daten und Gestaltung zusammenbringt. Eine Seite, die selbst ein kleines Engineering-Projekt ist, beweist das nebenbei.

## 3. Zielgruppen

| Persona | Situation | Was sie braucht |
|---|---|---|
| **Gesprächspartner** (primär) | Sitzt neben Nico, der ihm am Handy oder Laptop die Seite zeigt | Sofortiger Wow-Moment, flüssige Bedienung, schnelles Antippen einzelner Projekte |
| **Recruiter** | Bekommt den Link, oft am Handy, hat wenig Zeit | CV in zwei Taps, Kontakt sofort auffindbar, Abkürzung ohne 3D |
| **Kunde/Partner** | Will wissen, was Nico technisch kann | Projekte mit Substanz: Paper, Modelle, Skills, Links zu Code |

## 4. Ziele und Erfolgskriterien

Es gibt bewusst keine Analytics. Erfolg wird deshalb **vor dem Launch geprüft** und nicht live gemessen.

| Ziel | Messbar als |
|---|---|
| Schnell | Studio sichtbar und bedienbar in **< 3 s** auf einem Mittelklasse-Handy über 4G (Lighthouse Mobile bzw. DevTools-Drosselung „Fast 4G“, CPU 4×). Initialer Download **< 3 MB**. |
| Läuft am Handy | Alle Objekte sind im Hoch- und Querformat ohne Scrollen oder Wischen antippbar. Getestet auf iOS Safari und Android Chrome. |
| Stimmiger Look | Licht, Kontaktschatten und Bodenspiegelung passen zusammen, Nico gibt die Optik frei. |
| Erreichbar | CV und Kontakt von überall in **≤ 2 Klicks/Taps**. |
| Pflegbar | Nico kann einen Text ändern oder ein Objekt verschieben, indem er nur `content/objects.json` bearbeitet. |

## 5. Umfang Version 1

**Drin:** Studio-Szene, sechs Objekte (Woodworking, Powerlifting, Nico, Spikeball, SunCafe, Data-Science-&-Motorsport-Pult), vier Fenstertypen, EN/DE, Handy- und Desktop-Variante, Listenansicht/Fallback, Impressum, Datenschutz, Link-Vorschau, QR-Code-Datei.

**Nicht drin (siehe §10):** TU Edge, 3D-Scan von Nico (kommt nach, sobald er vorliegt), eigene Domain, Editor, Analytics, Ton, Dunkelmodus.

## 6. Funktionale Anforderungen

Priorität: **M** = Must (ohne das kein Launch), **S** = Should (zum Launch angestrebt), **C** = Could (später).

### 6.1 Studio und Kamera

| ID | Anforderung | Prio |
|---|---|---|
| F-01 | Weißes Studio mit Hohlkehle (runder Übergang Boden–Wand), leicht spiegelndem Boden, Lichtband an der Decke und zwei Softboxen auf Stativen links und rechts | M |
| F-02 | Das Licht entsteht nur im Code (Environment-Map, Fake-Kontaktschatten unter jedem Objekt), nichts ist gebacken | M |
| F-03 | Feste Kamera („Menü-Kamera“). Am Desktop schwenkt sie minimal mit der Mausposition mit (wenige Grad, gedämpft). Kein Zoom, kein Drehen, kein OrbitControls | M |
| F-04 | Die Kamera passt Abstand bzw. Blickwinkel an das Seitenverhältnis an, sodass alle Objekte immer im Bild sind | M |
| F-05 | Einstieg: einmalige Kamerafahrt von ca. 1,5 s ins Studio, das Licht geht dabei an. Antippen oder Klicken überspringt sie. Bei `prefers-reduced-motion` fällt sie ganz weg | S |
| F-06 | Die Seite ist immer hell, unabhängig vom System-Dunkelmodus | M |

### 6.2 Objekte

| ID | Anforderung | Prio |
|---|---|---|
| F-10 | Alle Objekte, ihre Positionen, Größen, Modelle, Fenstertypen und Texte (EN/DE) stehen in `content/objects.json`. Ein neues Objekt erfordert nur einen neuen Eintrag (plus Asset-Datei) | M |
| F-11 | Startanordnung von links nach rechts: Woodworking, Powerlifting, **Nico (Mitte, leicht vorne)**, Spikeball, SunCafe, Pult (rechts, leicht zurückgesetzt). Hinten mittig bleibt Platz für TU Edge. **Keine Position ist fix**, alle sind über JSON verschiebbar | M |
| F-12 | Platzhalter: schlichte, stilisierte Formen in Studio-Optik, die sich später einzeln durch `.glb`-Modelle ersetzen lassen | M |
| F-13 | Nico-Figur als **stilisierter Avatar** (Statur, Frisur, Kleidungsfarben nach Foto bzw. Vorgabe von Nico) | M |
| F-14 | Nico-Figur austauschbar gegen einen **3D-Scan** (≤ ca. 2 MB nach Kompression). Avatar bleibt der Rückfall | C (sobald Scan da) |
| F-15 | Ein Objekt mit `"visible": false` wird nicht angezeigt (für TU Edge vorgesehen) | S |

### 6.3 Interaktion

| ID | Anforderung | Prio |
|---|---|---|
| F-20 | Desktop-Hover: gelber Lichtschein unter dem Objekt, Label erscheint, Cursor wird zur Hand | M |
| F-21 | Handy: Labels sind immer sichtbar, Antippen öffnet direkt | M |
| F-22 | Jedes Objekt hat zusätzlich ein HTML-Label als Klick- bzw. Tap-Fläche, mindestens 44 × 44 px | M |
| F-23 | Klick öffnet das Fenster des Objekts, die Kamera bleibt stehen. Schließen per ×, Klick daneben, Esc oder Zurück-Geste bzw. Zurück-Button am Handy | M |
| F-24 | Jedes Fenster hat eine eigene URL (z. B. `#spikeball`), damit Nico direkt auf ein Projekt verlinken kann | S |
| F-25 | Tastatur: Mit Tab lassen sich die Objekte durchgehen, Enter öffnet, der Fokus ist sichtbar | S |

### 6.4 Fenster (Inhalte)

| ID | Typ | Objekt | Anforderung | Prio |
|---|---|---|---|---|
| F-30 | `pdf` | Nico | CV-PDF anzeigen, mit Download-Button. EN- und DE-Version, falls vorhanden, sonst EN. Am Handy, wo PDF-Einbettung unzuverlässig ist: Vorschaubild plus „Open / Download“ | M |
| F-31 | `media+text+download` | Spikeball | Kurze Erklärung, Visualisierung (Netz von oben, Einschlag erscheint, das System markiert den Punkt) und Download des Papers als PDF (nur EN) | M |
| F-32 | `model+text` | Woodworking | Drehbares 3D-Modell des Möbels (in diesem Fenster sind Drehen und Zoomen erlaubt) plus Text | M |
| F-33 | `text+links` | Pult | „Data Science & Motorsport“: Text, Skill-Liste, Links zu Repos | M |
| F-34 | `text+links` | Powerlifting, SunCafe | Text und Links (SunCafe: Link aufs andere Repo). Bis Inhalte da sind: Platzhaltertext | M |
| F-35 | — | alle | Schwere Inhalte (Modelle, PDFs, Medien) werden erst beim Öffnen des Fensters geladen, mit Ladeanzeige im Fenster | M |
| F-36 | — | alle | Desktop: Fenster als Karte über dem Studio. Handy: Vollbild-Sheet von unten | M |

### 6.5 Dauerhafte Bedienelemente

| ID | Anforderung | Prio |
|---|---|---|
| F-40 | Oben links Name und Titel | M |
| F-41 | Immer sichtbar in einer Ecke: **CV** (öffnet F-30), **Contact** (mailto, LinkedIn, Instagram), LinkedIn-Link, Sprachumschalter EN/DE | M |
| F-42 | Dezenter Link „Skip 3D / list view“, der die Listenansicht öffnet (F-50) | M |
| F-43 | Kleine Links auf Impressum und Datenschutz | M |

### 6.6 Listenansicht und Fallback

| ID | Anforderung | Prio |
|---|---|---|
| F-50 | Eine einfache HTML-Seite bzw. -Ansicht mit denselben Inhalten aus `objects.json` (Titel, Text, Links, Downloads), ohne WebGL | M |
| F-51 | Sie erscheint automatisch, wenn WebGL fehlt oder die Szene nicht lädt (Timeout bzw. Fehler) | M |
| F-52 | Die Inhalte sind auch ohne JavaScript lesbar (mindestens Name, Titel, Kontakt, Links zu CV und Paper) | S |

### 6.7 Sprache

| ID | Anforderung | Prio |
|---|---|---|
| F-60 | Standardsprache Englisch, Umschalter auf Deutsch. Die Wahl bleibt beim Neuladen erhalten (`localStorage`, mit Fallback ohne) | M |
| F-61 | Alle Oberflächentexte und Beschreibungen gibt es zweisprachig. Paper nur EN, gekennzeichnet als „English only“ in der DE-Ansicht | M |
| F-62 | Bei der ersten Wahl wird die Browsersprache berücksichtigt (de → Deutsch) | C |

### 6.8 Rechtliches, Teilen, Sonstiges

| ID | Anforderung | Prio |
|---|---|---|
| F-70 | Impressum (EN/DE): nur E-Mail und Instagram | M |
| F-71 | Datenschutzseite (EN/DE): keine Cookies, kein Tracking, keine Drittanbieter-Requests, Hosting bei GitHub Pages | M |
| F-72 | Meta-Titel, Beschreibung und Open-Graph- bzw. Twitter-Card-Vorschaubild für eine schöne Link-Vorschau | M |
| F-73 | Indexierbar: `robots.txt` erlaubt, sinnvoller `<title>` | S |
| F-74 | QR-Code auf `https://nicofuchsgit.github.io` als SVG-Datei im Repo (nicht auf der Seite) | S |
| F-75 | Favicon | S |
| F-76 | Kein Ton | M |

## 7. Nicht-funktionale Anforderungen

| ID | Bereich | Anforderung |
|---|---|---|
| N-01 | Ladezeit | Studio < 3 s auf einem Mittelklasse-Handy über 4G. Initialer Download < 3 MB (HTML, JS, Szene, Avatar-Platzhalter). Der Avatar bzw. Scan darf direkt danach nachladen |
| N-02 | Laufzeit | Flüssig, Ziel 60 fps am Desktop und ≥ 30 fps auf einem Mittelklasse-Handy. Pixel-Ratio am Handy auf maximal 2 begrenzen |
| N-03 | Handy-Variante | Kein Mitschwenken, günstigere Spiegelung und Schatten, im Hochformat zwei Reihen (Nico vorne mittig), Fenster als Vollbild-Sheet. Kein seitliches Wischen |
| N-04 | Browser | Aktuelle Versionen von Chrome, Safari (inkl. iOS), Firefox und Edge. Ältere Browser bzw. solche ohne WebGL bekommen die Listenansicht |
| N-05 | Datenschutz | Keine Requests an Dritte: three.js, Addons und Decoder werden selbst gehostet, Fonts lokal oder System-Fonts. Kein Cookie, kein Tracking |
| N-06 | Technik | Statisch auf GitHub Pages, ohne Build-Schritt und ohne Framework. Three.js (Version aus dem Prototyp oder neuer) per Import-Map aus dem Repo. Modelle als `.glb` mit Draco- oder Meshopt-Kompression |
| N-07 | Barrierefreiheit | Fenster semantisch als Dialog mit Fokusfalle und `aria`-Labels. Ausreichende Kontraste. `prefers-reduced-motion` wird respektiert. Listenansicht als zugängliche Alternative |
| N-08 | Pflege | `content/objects.json` mit kurzer README (Felder, Beispiel, wie man ein Objekt hinzufügt bzw. verschiebt). Assets liegen geordnet unter `assets/` |
| N-09 | Optik | Eine Akzentfarbe: Gelb `#f5c400`, sonst Weiß, Grau, Schwarz |

## 8. Inhalte und Assets (liefert Nico)

| Asset | Für | Status | Bis dahin |
|---|---|---|---|
| CV-PDF (EN, optional DE) | F-30 | offen | Platzhalter-PDF |
| Spikeball-Paper (PDF, EN) | F-31 | offen | Platzhalter-PDF |
| Spikeball-Kurztext, ggf. Messdaten bzw. Grafiken für die Visualisierung | F-31 | offen | Text aus dem Prototyp |
| Woodworking-Modell (`.glb`, oder Fotos bzw. Maße zum Nachbauen) und Text | F-32 | offen | Platzhalter-Möbel |
| Powerlifting-Text, ggf. Fotos | F-34 | offen | Platzhaltertext |
| SunCafe-Text und Repo-Link | F-34 | offen | Platzhaltertext |
| Data-Science-&-Motorsport-Text, Skill-Liste, Repo-Links | F-33 | offen | Platzhaltertext |
| Fotos bzw. Angaben für den Avatar (Statur, Frisur, Kleidungsfarben) | F-13 | offen | neutraler Avatar |
| 3D-Scan von Nico | F-14 | später | Avatar |
| E-Mail, LinkedIn-URL, Instagram-Handle | F-41, F-70 | offen | — (Pflicht vor Launch) |
| DE-Übersetzungen bzw. Freigabe der Texte | F-61 | offen | maschinell vorübersetzt, als Entwurf markiert |

## 9. Annahmen und Abhängigkeiten

- GitHub Pages bleibt das Hosting, die Adresse ist `nicofuchsgit.github.io`.
- Die Seite ist kein kommerzielles Angebot. Darauf beruht das Impressum ohne Anschrift. Ändert sich der Zweck, muss das Impressum neu geprüft werden.
- Nicos Assets kommen schrittweise. Jede Phase muss auch mit Platzhaltern fertig und vorzeigbar sein.

## 10. Bewusst nicht in Version 1

- **TU Edge**: erst wenn Nico bei TU Wien Racing aufgenommen wird. Der Platz ist reserviert (F-15).
- Eigene Domain (später nur eine `CNAME`-Datei).
- Editor im Browser zum Verschieben von Objekten.
- Analytics, Cookies, Kontaktformular, Backend, CMS.
- Ton, Dunkelmodus, freie Kamera, Neigungssteuerung am Handy.
- Fotorealistische Modelle.

## 11. Risiken

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| 3D-Szene wird am Handy zu schwer | Anti-Ziel „langsam/kaputt“ | Budget N-01/N-02 ab Phase 1 messen. Handy-Variante N-03. Listenansicht als Notausgang |
| Look wirkt flach („Pappkulisse“) | Anti-Ziel | Früh Kontaktschatten, Environment-Map und Spiegelung zusammen abstimmen und von Nico freigeben lassen (Roadmap Phase 1) |
| Scan zu groß oder zu unsauber | Figur wirkt billig | Avatar bleibt Rückfall. Scan erst nach Kompressionstest einbauen |
| PDF-Einbettung am Handy unzuverlässig | CV nicht lesbar | Vorschaubild plus Öffnen bzw. Download (F-30) |
| Assets kommen spät | Launch verzögert sich | Platzhalter überall. Launch-Kriterium verlangt nur CV und Kontaktdaten echt (siehe Roadmap) |
| Impressum rechtlich zu knapp | Abmahnrisiko | Nur solange die Seite nicht kommerziell ist. Bei Zweckänderung neu prüfen (keine Rechtsberatung) |

## 12. Abnahme Version 1

Version 1 ist fertig und darf auf `main`, wenn:

1. Alle **M**-Anforderungen erfüllt sind.
2. N-01 und N-02 gemessen und eingehalten sind (Lighthouse Mobile und echtes Handy).
3. Die Seite auf iOS Safari, Android Chrome und Desktop Chrome, Safari und Firefox getestet ist, im Hoch- und Querformat.
4. Echtes CV, echte Kontaktdaten und echtes Impressum drin sind. Andere Inhalte dürfen noch Platzhalter sein.
5. Nico Look und Texte freigegeben hat.
