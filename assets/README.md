# assets

Dateien für die Fenster (PRD Abschnitt 8). Alles hier ist noch Platzhalter und wird durch die echte Datei mit **gleichem
Namen** ersetzt, dann muss `content/objects.json` nicht angepasst werden.

| Datei | Für | Ersetzen durch |
|---|---|---|
| `cv/cv-en.pdf` | CV-Fenster (Nico) | Echtes CV auf Englisch. Für eine deutsche Version `cv/cv-de.pdf` ablegen und bei `nico` unter `pdf` als `"de"` eintragen |
| `cv/cv-en-preview.jpg` | CV-Vorschau am Handy | Erste Seite des CVs als Bild, z. B. `pdftoppm -jpeg -r 60 -singlefile cv/cv-en.pdf cv/cv-en-preview` |
| `spikeball/paper.pdf` | Spikeball-Fenster | Das Paper (nur Englisch) |
