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
| `scale` | Größe, `1` = Originalmaße des Modells |
| `model` | Pfad zu einer `.glb`-Datei (Draco-komprimiert). Leer = Platzhalter. Lädt das Modell nicht, bleibt der Platzhalter stehen |
| `placeholder` | Form, solange kein Modell da ist: `avatar`, `suncafe`, `desk`, `car` oder `box` |
| `avatar` | Nur bei `avatar`: `height` in Metern und Farben für `skin`, `hair`, `top`, `bottom`, `shoes` |
| `window` | Fenstertyp: `pdf`, `model+text`, `media+text+download` oder `text+links` |
| `title` | `{ "en": "…", "de": "…" }` |
| `tags` | Liste kurzer Schlagworte, z. B. `["PYTHON", "ML"]` |
| `text` | `{ "en": ["Absatz 1", "Absatz 2"], "de": [...] }` |
| `links` | `[{ "label": { "en": "…", "de": "…" }, "url": "https://…" }]` |

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
  "tags": ["PYTHON"],
  "text": { "en": ["Short description."], "de": ["Kurze Beschreibung."] },
  "links": [{ "label": { "en": "Code on GitHub", "de": "Code auf GitHub" }, "url": "https://github.com/NicoFuchsGIT" }]
}
```

Einträge werden mit Komma getrennt. Nach dem Speichern die Seite neu laden. Zeigt das Studio danach nichts mehr an,
ist die JSON meist ungültig (fehlendes Komma oder Anführungszeichen); ein JSON-Validator im Browser findet den Fehler.
