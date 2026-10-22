# assets

Dateien für die Fenster (PRD Abschnitt 8). Eine neue Version einfach mit **gleichem Namen** ablegen, dann muss
`content/objects.json` nicht angepasst werden.

| Datei | Für | Hinweis |
|---|---|---|
| `cv/cv-en.pdf` | CV-Fenster (Nico) | CV auf Englisch, aus `CV_Fuchs_Praktikum.docx` **ohne Telefonnummer**. Bei jeder neuen Version die Nummer vorher entfernen. Für eine deutsche Version `cv/cv-de.pdf` ablegen und bei `nico` unter `pdf` als `"de"` eintragen |
| `cv/cv-en-preview.jpg` | CV-Vorschau am Handy | Erste Seite als Bild: `pdftoppm -jpeg -r 90 -singlefile cv/cv-en.pdf cv/cv-en-preview` |
| `spikeball/paper.pdf` | Spikeball-Fenster | Projektbericht (nur Englisch). Die Matrikelnummern auf dem Deckblatt sind geschwärzt |

## Website allgemein

| Datei | Wofür | Hinweis |
|---|---|---|
| `og-image.jpg` | Vorschaubild, wenn der Link geteilt wird (1200 × 630, F-72) | Screenshot des Studios. Nach größeren Änderungen am Look neu aufnehmen |
| `icons/favicon-32.png`, `icons/apple-touch-icon.png` | Favicon für ältere Browser bzw. Homescreen-Icon (F-75) | Gleiches Motiv wie `favicon.svg` im Hauptordner |
| `qr-code.svg` | QR-Code auf `https://nicofuchsgit.github.io` zum Ausdrucken (F-74) | Erscheint nicht auf der Seite. Neu erzeugen: `python3 -c "import segno; segno.make('https://nicofuchsgit.github.io', error='q').save('assets/qr-code.svg', scale=10, border=4, dark='#111111')"` |
