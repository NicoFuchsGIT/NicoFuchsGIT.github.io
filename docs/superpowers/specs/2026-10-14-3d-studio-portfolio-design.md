# 3D-Studio-Portfolio – Design

Stand: 2026-10-14 · Repo: `NicoFuchsGIT.github.io` (GitHub Pages)

## Absicht und Warum

Nico Fuchs (R&D Engineer, Schwerpunkte Sports Engineering, Rennsport, Data Science) will eine persönliche Website, die **CV und Portfolio in einem** ist. Zielgruppe sind **Recruiter und Kunden**. Der eigentliche Bewerbungsweg läuft über LinkedIn und Plattformen. Diese Seite ist der Link, den man von dort aus anklickt. Sie soll in den ersten Sekunden Eindruck machen und zeigen, dass Nico Technik, Daten und Gestaltung zusammenbringt.

Die Form dafür: ein **weißes Fotostudio in 3D**, in dem Objekte stehen, die je ein Projekt oder einen Teil des CVs repräsentieren. Klickt man ein Objekt an, öffnet sich der Inhalt dazu.

## Ziele

- Ein stimmiger, echter 3D-Raum im Look eines weißen Foto- bzw. Autostudios.
- Alle Objekte sind auf einen Blick sichtbar und anklickbar, jedes öffnet seinen eigenen Inhalt.
- Schnelles Laden und volle Funktion am Handy.
- Englisch als Standard, Umschalter auf Deutsch.
- Leicht erweiterbar: neue Objekte bzw. Projekte (z. B. TU Edge) ohne Umbau hinzufügbar.

## Nicht-Ziele

- Kein freies Herumlaufen, Drehen oder Zoomen der Studiokamera.
- Kein Ersatz für LinkedIn oder Bewerbungsplattformen.
- Kein Backend, kein CMS, kein Login.
- Fotorealistische Modelle sind für die erste Version nicht nötig.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- **Langsames Laden.** Wenn das Studio nicht in wenigen Sekunden steht, auch über mobiles Netz, ist die Seite gescheitert.
- **Am Handy kaputt oder unbedienbar.** Das Handy ist ein vollwertiges Zielgerät, kein Nachgedanke.
- Der Raum wirkt flach oder wie Pappkulisse: Licht, Schatten und Bodenspiegelung müssen zusammenpassen.

## Was Nico entschieden hat

### Look (Referenz: drei Bilder aus dem Brainstorming)

- Weißes Fotostudio, sehr hell und aufgeräumt, viel Weißraum. Die Richtung ist ein Autostudio wie auf Nicos Referenzbildern: ein Auto vor weißer Wand mit Softboxen, minimalistisches weißes Studio mit Auto im Zentrum.
- Die Frontal-Mockup-Komposition aus dem Brainstorming „präsentiert es schon relativ gut“ (Datei: [`2026-10-14-3d-studio-portfolio/studio-frontal.html`](2026-10-14-3d-studio-portfolio/studio-frontal.html), im Browser öffnen). Das fertige Produkt muss aber **stimmig im 3D-Raum stehen**.

### Anordnung

- Eine Mischung aus „Runde Galerie“ (Nico in der Mitte, Objekte drumherum) und dem bestehenden Prototyp, **„aufgeklappt“**: Die Objekte stehen in einem flachen Bogen vor der Kamera, sodass alles ohne Drehen sichtbar ist.
- Komposition laut Mockup, von links nach rechts: Woodworking-Möbel, Powerlifting-Rack, **Nico (Mitte)**, Spikeball-Netz, SunCafe. Hinten mittig ist Platz für TU Edge reserviert.

### Kamera („Steady Cam“)

- Wie eine **Menü-Kamera in Videospielen**: fest auf einer Position, schwenkt nur **minimal (fast vernachlässigbar)** mit der Mausposition mit.
- Kein OrbitControls, kein Zoom, kein freies Drehen.

### Objekte und ihre Inhalte

Jedes Objekt bekommt ein Fenster, das zu seinem Inhalt passt, statt einer Einheitsvorlage.

| Objekt | Inhalt beim Klick |
|---|---|
| **Nico (Figur)** | CV als **PDF-Popup** |
| **Spikeball-Netz** | Projekt „Spikeball Impact Localization“: Mischung aus **visueller Darstellung**, **Paper-Download** und **kurzer Erklärung** |
| **Holzmöbel** | **3D-Modell** des Möbels plus **Textbeschreibung** |
| **Powerlifting-Aufbau** | Powerlifting-Projekt (Inhalt noch offen, siehe unten) |
| **SunCafe** | SunCafe-Projekt (lebt in einem anderen Repo, Inhalt noch offen) |
| **TU Edge** (Auto) | Erst wenn Nico bei TU Wien Racing genommen wird. Bis dahin nicht sichtbar, aber der Platz ist eingeplant. |

### Sprache

- Standard: **Englisch**, mit Umschalter auf **Deutsch**.
- Oberfläche und Beschreibungen werden übersetzt. **Das Paper gibt es nur auf Englisch.**

## Rahmenbedingungen

- Hosting: **GitHub Pages**, statisch. Es gibt bereits ein `index.html` mit einem Three.js-Prototyp (three@0.160.0 per Import-Map von unpkg, helles Studio, Nebel, gelber Ring als Spikeball-Platzhalter, Raycasting-Klick, Modal mit Projekttext).
- Leistung: Das Studio muss in **wenigen Sekunden** stehen, auch über mobiles Netz. Ziel-Richtwert (meine Festlegung): Erstanzeige des Studios unter ca. 3 s auf einem Mittelklasse-Handy über 4G, initialer Download unter ca. 3 MB.
- Mobil: Hoch- und Querformat, Touch-Bedienung.

## Meine Festlegungen (vom Builder anpassbar, Nico hat ihnen nicht ausdrücklich zugestimmt)

- **Technik:** Weiter mit Three.js, ohne Build-Schritt und ohne Framework, auf dem bestehenden Prototyp aufbauend. Modelle als `.glb` (mit Draco- oder Meshopt-Kompression), PDFs, Bilder und Modelle als Dateien im Repo.
- **Lazy Loading:** Schwere Inhalte (Woodworking-Modell, PDFs, Paper, Medien) werden erst beim Öffnen des jeweiligen Fensters geladen.
- **Ladeanzeige:** Schlichter Ladebildschirm mit Nicos Namen statt weißer Fläche.
- **Hover:** Das Objekt bekommt einen Lichtschein bzw. eine Hervorhebung, und sein Label erscheint. Der Cursor wird zur Hand.
- **Klick:** Die Kamera bleibt stehen, nur das Fenster öffnet sich. Schließen per ×, Klick daneben oder Esc.
- **Hochformat:** Die Reihenfolge und das Studio bleiben gleich, aber die Anordnung darf sich anpassen: ein engerer Bogen bzw. zwei Reihen mit Nico vorne mittig, damit jedes Objekt ein ordentliches Tap-Ziel ist (mindestens ca. 44 px, zusätzlich HTML-Labels als Tap-Fläche). Kein seitliches Wischen.
- **Bibliotheken selbst hosten:** three.js und die nötigen Addons (GLTFLoader, Draco- bzw. Meshopt-Decoder) liegen im Repo statt auf unpkg. Das ist schneller und schickt keine Besucher-IPs an Dritte.
- **Kein Tracking bzw. keine Analytics**, also auch kein Cookie-Banner.
- **Kontakt:** LinkedIn-Link plus mailto-Link. Kein Formular.
- **Handy:** Antippen statt Hover, Fenster im Vollbild. Die Kamera passt Abstand bzw. Blickwinkel so an, dass alle Objekte auch im Hochformat ins Bild passen. Das Mitschwenken entfällt am Handy (keine Neigungssteuerung, das erspart die iOS-Berechtigungsabfrage).
- **Fallback:** Ohne WebGL (oder bei Fehler beim Laden) gibt es eine einfache HTML-Liste mit denselben Inhalten.
- **Immer sichtbar:** Name und Titel oben links (wie im Prototyp), dazu LinkedIn-Link, Kontakt und Sprachumschalter in einer Ecke.
- **Platzhalter-Optik:** Zuerst schlichte, stilisierte Formen in Studio-Optik. Nico als neutrale graue Figur (wie eine Schaufensterpuppe). Später ersetzbar durch echte Modelle.
- **Studio-Elemente:** Hohlkehle (gerundeter Übergang Boden zu Wand), leicht glänzender, spiegelnder Boden, weiches Deckenlicht (Lichtband oder Ring), zwei Softboxen auf Stativen als Rahmen links und rechts.
- **Licht nur im Code, nichts gebacken:** Environment-Map, günstige Fake-Kontaktschatten unter jedem Objekt und ein spiegelnder Boden. Keine Lightmaps aus Blender. So kommt ein neues Objekt wirklich nur über einen neuen Eintrag in der Daten-Datei dazu, ohne neu zu backen, und Nico kann die Seite selbst pflegen.
- **Inhalte als Daten:** Objekte und Fenster-Inhalte werden in einer zentralen Daten-Datei bzw. einem Objekt beschrieben (ID, Position, Modell, Fenstertyp, Texte EN/DE, Links), damit TU Edge oder andere Projekte durch einen neuen Eintrag hinzukommen.
- **Fenstertypen:** `pdf` (CV), `model+text` (Woodworking), `media+text+download` (Spikeball), `text+links` (Standard für Powerlifting und SunCafe, bis mehr feststeht).
- **Spikeball-Visualisierung:** Ein kleines animiertes Netz von oben, auf dem ein Einschlag erscheint und das System den Punkt markiert. Das genaue Format (Animation, Bild oder Video) entscheidet der Builder.
- **CV-PDF:** Je eine Version auf Englisch und Deutsch, falls vorhanden, sonst nur Englisch.

## Was offen bzw. dem Builder überlassen ist

- Genaue 3D-Platzierung, Maßstäbe und Kameraposition, solange die Komposition des Frontal-Mockups erhalten bleibt.
- Feintuning von Licht und Materialien.
- Inhalte für Powerlifting und SunCafe: Bis Nico sie liefert, Platzhaltertext. Für SunCafe einen Link aufs andere Repo vorsehen.
- Echte Assets (CV-PDF, Paper, Woodworking-Modell, Fotos) liefert Nico. Bis dahin Platzhalter-Dateien.
- Aufteilung in Dateien (z. B. `index.html`, `js/`, `assets/`, `content/`).

## Referenz: Mockups und Bilder

- [`studio-frontal.html`](2026-10-14-3d-studio-portfolio/studio-frontal.html): die gewählte Komposition (verbindlich für Anordnung und Stimmung).
- [`studio-layouts.html`](2026-10-14-3d-studio-portfolio/studio-layouts.html): die drei Draufsicht-Varianten aus dem Brainstorming. Gewählt: A, aufgeklappt.
- Nicos drei Referenzbilder sind Fremdbilder (teils mit Wasserzeichen) und liegen deshalb nicht im öffentlichen Repo. Inhalt:
  1. Ein Rennwagen (GT3) seitlich vor einer weißen Hohlkehle, zwei große Parabol-Softboxen im Vordergrund, Lichtwanne an der Decke, spiegelnder Boden.
  2. Ein weißes Auto frontal von hinten in einem fast leeren weißen Raum, links ein Roboterarm, rechts ein Pult mit Monitor und eine Pflanze. Sehr minimalistisch. Das kommt der gewünschten Stimmung am nächsten.
  3. Eine dunklere Halle mit großem Lichtring an der Decke, Autos auf Studioflächen und Kamerastativen. Daraus stammt nur die Idee mit dem Lichtring bzw. Lichtband, nicht die dunkle Stimmung.

### Beschreibung des Frontal-Mockups

Grundidee: ein Raum, eine ruhige Kamera, alle Objekte im Blick. Frontalansicht auf Augenhöhe, weiße Hohlkehle, spiegelnder Boden, zwei dunkle Softboxen links und rechts, Lichtband an der Decke. Im flachen Bogen: Holzmöbel, Powerlifting-Rack, graue Figur „Nico · CV“ (Mitte, leicht vorne), gelber Spikeball-Ring, SunCafe-Würfel mit gelber Sonne. Hinten mittig der gestrichelte Platzhalter für TU Edge. Beim Hover leuchtet ein gelber Lichtschein unter dem Objekt auf.
