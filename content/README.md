# content/objects.json

Alle Objekte im Studio stehen in `objects.json`. Um ein Objekt zu verschieben, einen Text zu ändern oder ein neues
Objekt hinzuzufügen, reicht es, diese Datei zu bearbeiten. Die Kamera passt den Bildausschnitt automatisch an.

## Felder

| Feld | Bedeutung |
|---|---|
| `id` | Eindeutiger Name, klein und ohne Leerzeichen (z. B. `spikeball`) |
| `visible` | `false` blendet das Objekt aus (z. B. TU Edge, bis es so weit ist) |
| `position` | `[x, z]` in Metern. x: links (−) / rechts (+), z: hinten (−) / vorne (+). Nico steht bei `[0, 0.4]` |
| `rotation` | Drehung um die Hochachse in Grad. Positiv dreht nach rechts, links stehende Objekte also zur Mitte |
| `scale` | Größe, `1` = Originalmaße des Modells. Alle Modelle sind in echten Metern gebaut, deshalb überall `1` lassen, damit die Größen zueinander passen |
| `model` | Pfad zu einer `.glb`-Datei (Draco-komprimiert). Leer = Platzhalter. Lädt das Modell nicht, bleibt der Platzhalter stehen |
| `table` | Optional: Höhe einer Schreibtischplatte in Metern (vor `scale`), auf die das Modell gestellt wird, mit Tastatur und Maus, z. B. der SunCafe-Monitor |
| `placeholder` | Form, solange kein Modell da ist: `avatar`, `suncafe`, `car` oder `box` |
| `avatar` | Nur bei `avatar`: `height` in Metern und Farben für `skin`, `hair`, `top`, `bottom`, `shoes` |
| `window` | Fenstertyp, siehe unten: `pdf`, `model+text`, `media+text+download` oder `text+links` |
| `title` | Überschrift im Fenster: `{ "en": "…", "de": "…" }` |
| `label` | Kurzer Name im Label über dem Objekt, `{ "en": "…", "de": "…" }`. Fehlt er, steht dort der `title` |
| `tags` | Liste kurzer Schlagworte, z. B. `["PYTHON", "ML"]` |
| `text` | `{ "en": ["Absatz 1", "Absatz 2"], "de": [...] }` |
| `links` | `[{ "label": { "en": "…", "de": "…" }, "url": "https://…" }]` |
| `pdf` | Nur bei `pdf`: `{ "en": "assets/cv/cv-en.pdf", "de": "…" }`. Fehlt `de`, wird EN gezeigt |
| `download` (bei `pdf`) | Optional: `{ "url": { "en": "assets/cv/cv-en.pdf" } }`. Datei für den Download-Button, wenn sie sich vom angezeigten `pdf` unterscheidet (angezeigt wird die Kurzfassung, heruntergeladen das ganze CV) |
| `preview` | Nur bei `pdf`: Vorschaubild fürs Handy, gleiche Form wie `pdf` |
| `download` | Nur bei `media+text+download`: `{ "label": { "en": "…", "de": "…" }, "url": "assets/…pdf", "lang": "en" }`. `lang` = Sprache der Datei, optional |
| `windowModel` | Nur bei `model+text`: eigenes Modell fürs Fenster. Fehlt es, wird `model` gezeigt |
| `skills` | Nur bei `text+links` (optional): Liste wie `["Python", "MATLAB"]`, erscheint als Skill-Liste |

## Fenstertypen

| Typ | Inhalt |
|---|---|
| `pdf` | Text und PDF. Desktop: eingebettet mit Download-Button. Handy: Vorschaubild mit „Öffnen“ und „Download“ |
| `media+text+download` | Text, Visualisierung des Einschlags (Spikeball) und Download-Button |
| `model+text` | Drehbares und zoombares 3D-Modell, darunter der Text |
| `text+links` | Text, optional Skill-Liste, Links als Buttons |

PDFs, Bilder und Modelle laden erst, wenn das Fenster aufgeht. Am Desktop erscheint das Fenster als Karte über dem
Studio, am Handy als Vollbild-Sheet.

## Beispiel: neues Objekt

```json
{
  "id": "mein-projekt",
  "visible": true,
  "position": [2.0, -1.5],
  "rotation": -20,
  "scale": 1,
  "model": "models/mein-projekt/web/mein-projekt.glb",
  "placeholder": "box",
  "window": "text+links",
  "title": { "en": "My Project", "de": "Mein Projekt" },
  "label": { "en": "Project", "de": "Projekt" },
  "tags": ["PYTHON"],
  "text": { "en": ["Short description."], "de": ["Kurze Beschreibung."] },
  "links": [{ "label": { "en": "Code on GitHub", "de": "Code auf GitHub" }, "url": "https://github.com/NicoFuchsGIT" }]
}
```

Einträge werden mit Komma getrennt. Nach dem Speichern die Seite neu laden. Zeigt das Studio danach nichts mehr an,
ist die JSON meist ungültig (fehlendes Komma oder Anführungszeichen); ein JSON-Validator im Browser findet den Fehler.

## Direktlinks

Jedes Fenster hat eine eigene Adresse aus der `id`, z. B. `https://nicofuchsgit.github.io/#spikeball`. Wer den Link
öffnet, sieht das Studio mit dem Fenster schon offen.

## site.json: Name, Titel, Kontakt

`content/site.json` füllt die Bedienelemente (Name und Titel oben links, Kontaktmenü, LinkedIn-Button) und die
Kontaktangaben in Impressum und Datenschutz.

| Feld | Bedeutung |
|---|---|
| `name` | Name oben links |
| `title` | Titel darunter, `{ "en": "…", "de": "…" }` |
| `wip` | `true` zeigt den Hinweis „Website im Aufbau“ unter dem Namen. Für den Launch auf `false` setzen |
| `contact.email` | E-Mail-Adresse, z. B. `"name@example.com"` |
| `contact.linkedin` | Volle LinkedIn-URL, z. B. `"https://www.linkedin.com/in/…/"` |
| `contact.github` | Volle GitHub-URL, z. B. `"https://github.com/…"` (Icon in der Leiste und in der Liste) |

Ein leeres Feld bleibt im Kontaktmenü als „folgt“ sichtbar, ist aber nicht anklickbar.

## Sprache

Standard ist Englisch, beim ersten Besuch mit deutscher Browsersprache Deutsch. Der Umschalter oben rechts merkt sich die
Wahl im Browser. Alle Texte in `objects.json` brauchen deshalb `en` und `de`. Ein Download nur auf Englisch bekommt
`"lang": "en"` und wird in der deutschen Ansicht als „English only“ markiert; beim CV passiert das automatisch, solange es
kein `pdf.de` gibt.

## Listenansicht und Fallback

`list.html` zeigt dieselben Inhalte als einfache Liste, ohne 3D (Link „3D überspringen / Liste“ unten links im Studio).
Die Liste baut sich aus `objects.json` und `site.json` auf, es gibt also nichts doppelt zu pflegen. Direktlinks gehen
auch hier: `list.html#spikeball`.

Das Studio leitet automatisch zur Liste um, wenn der Browser kein WebGL bzw. keine Import-Maps kann, wenn beim Start
ein Fehler auftritt oder wenn die Szene nach 20 Sekunden noch nicht läuft. Die Liste sagt dann kurz, warum.

**Ohne JavaScript** gibt es nur einen festen Grundinhalt: Name, Titel, E-Mail, LinkedIn und Links zu CV und Paper. Er
steht von Hand im `<noscript>`-Block von `index.html` und im `#list`-Block von `list.html`. Ändern sich E-Mail,
LinkedIn oder die Dateinamen von CV bzw. Paper, dort mit anpassen.
