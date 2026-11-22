# vendor

Fremde Bibliotheken, die die Seite braucht, liegen hier im Repo statt auf einem CDN. So gehen beim Besuch keine Requests
an Dritte (PRD N-05, Datenschutz F-71).

- `three@0.160.0/`: three.js (MIT, siehe `LICENSE`). `build/three.module.min.js` plus nur die Addons, die `js/` importiert,
  und der Draco-Decoder (WASM) für die Modelle. Kommt ein neues Addon dazu, die Datei aus dem gleichen Versionsordner
  von three.js an die gleiche Stelle kopieren.
