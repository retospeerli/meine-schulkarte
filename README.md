# Schweizer Kartengenerator – Version 2.0

Statische Webanwendung für **GitHub Pages**, ohne Backend, von Reto Speerli. Drei Betriebsarten: Landeskarte, SWISSIMAGE-Luftbild, Höhenlinien für Graukarton-Schichtreliefs. Zusätzliche Farbmaske für **politische Gemeinden oder Kantone**.

## Schnellstart

Alle Dateien aus diesem Ordner in ein GitHub-Repository hochladen. Unter **Settings → Pages → Deploy from a branch → main → /(root)** aktivieren. Anschliessend GitHub-Pages-Adresse öffnen. Die Datei `.nojekyll` muss im Root bleiben.

Lokal testen: `python3 -m http.server 8000` im Ordner starten, dann `http://localhost:8000` öffnen. `file://` ist für ES-Module nicht vorgesehen.

## Echte Druckdaten statt WMTS-Kacheln

Der **Standardexport** nutzt originalgetreue **Swiss Map Raster**-GeoTIFFs über den swisstopo-STAC-Dienst, nicht die kleine WMTS-Kachelpyramide. Quelle ist die **KREL**-Farbkombination mit Relief.

Automatische Zuordnung (Nennmassstab der Quelle <= gewählter Druckmassstab):

- bis 1:24'999: Swiss Map Raster 10 (1:10'000)
- ab 1:25'000: Swiss Map Raster 25
- ab 1:50'000: Swiss Map Raster 50
- ab 1:100'000: Swiss Map Raster 100
- ab 1:200'000: Swiss Map Raster 200
- ab 1:500'000: Swiss Map Raster 500

Beim Luftbildmodus: **SWISSIMAGE-Original-COGs** (10 cm Bodenauflösung, regional ältere/geringere Originaldetailauflösung; der tatsächliche Pixelabstand wird gelesen).

508 dpi ist **Voreinstellung für das Ausgaberaster**. Die Original-Swiss-Map-Raster-GeoTIFFs besitzen 508 dpi **bei ihrem jeweiligen Nennmassstab**. Bei beliebig eingegebenen Druckmassstäben ist die *effektive Quellen-DPI* anders. Beispiel: Swiss Map Raster 25 im Druckmassstab 1:25'000 = 508 Original-dpi; im Massstab 1:20'000 wäre SMR25 nur 406 dpi und wird daher automatisch SMR10 gewählt (falls verfügbar). Die App zeigt nach dem Lesen der TIFF-Metadaten die tatsächliche Quellenauflösung an. **Ausgabe-DPI bedeutet nicht zusätzliche Quelldetails.**

DIN A5, A4, A3, A2, A1, A0, hoch/quer, freier Massstab und Rand. Die App berechnet exakt georeferenzierte PDF-Bildkacheln von maximal 512 × 512 Pixel. Die PDF-Seite selbst ist auf die Originalmasse in Millimetern eingestellt. **Beim Drucken 100 % / tatsächliche Grösse** ohne Skalierung wählen.

### Speicher- und Druckhinweise

A0 bei 508 dpi bedeutet ungefähr **400 Millionen Ausgabepixel** (je nach Rand). Die Ausgabe wird zwar blockweise verarbeitet, aber das PDF wird von jsPDF im Speicher aufgebaut. A0 kann **sehr lange dauern**, mehrere Hundert MB bis GB beanspruchen oder auf Geräten mit wenig RAM fehlschlagen. Die App bricht bei zu vielen Kacheln oder fehlenden Original-TIFFs ab. Ein Desktop-PC mit genügend Speicher ist sinnvoll; ein kleiner A4-Testdruck empfiehlt sich vor dem Grossformatdruck. Das PDF enthält RGB, nicht zwingend das CMYK-Profil einer Druckerei; im Zweifel ICC-Profil/Druckerei abstimmen.

**Fallback:** WMTS-Schnellexport ist weiterhin enthalten, aber **nicht** als echter 508-dpi-Originaldruck gekennzeichnet. Die Vorschau selbst verwendet aus Geschwindigkeitsgründen WMTS.

Für lokale Nutzung kann man die Original-GeoTIFFs selbst herunterladen und im Exportbereich per Mehrfachauswahl hinzufügen. Diese Dateien müssen in **EPSG:2056** georeferenziert sein. Die App verwirft nicht passende oder unvollständige Quellen, statt leere Flächen als fertige Karten auszugeben.

## Politische Gemeinde / Kanton in Farbe

Unter «Gebiet farbig hervorheben» auswählen:

- **Gemeinde**: Name eingeben, Treffer aus der GeoAdmin-Ortssuche auswählen.
- **Kanton**: einen von 26 Kantonen aus dem Dropdown übernehmen.

Die App lädt danach die **Originalpolygon-Geometrie** von **swissBOUNDARIES3D** über `api3.geo.admin.ch` als GeoJSON in **EPSG:2056**, mit Löchern und mehrfach getrennten Flächenteilen. Optional wird das gewählte Gebiet automatisch auf der Druckseite eingepasst.

**Darstellung:** innen unverändert in Farbe, ausserhalb echtes Graustufenbild. Die Geometrie wird in der Vorschau und im Original- sowie WMTS-PDF-Export als Maske verwendet. Für die Hervorhebung im Landeskarte- bzw. Luftbildmodus bleiben. «Karte grau» zeigt bewusst die gesamte Karte grau.

## Höhenlinien / Graukarton

Vorhandener Modus aus Version 1.0: swissALTI³D mit 2-m-COG-Höhenraster oder lokalen LV95-GeoTIFFs, Äquidistanz und Abtastung wählbar, Export als Vektor-PDF, SVG und ein SVG pro Höhenstufe im ZIP. **Die SVGs sind Linienvorlagen, noch keine automatisch geschlossenen Ausschnittflächen**. Die farbige Gemeinde-/Kantonsmaske gilt nicht für den Höhenlinienmodus.

## Verwendete Daten und APIs

- Swiss Map Raster 10/25/50/100/200/500: `https://data.geo.admin.ch/api/stac/v1/collections/<collection>/items?bbox=...`
- SWISSIMAGE: STAC Collection `ch.swisstopo.swissimage-dop10`
- Höhenmodell: STAC Collection `ch.swisstopo.swissalti3d`
- Amtliche Gemeinde-/Kantonsgrenzen: `SearchServer` (`origins=gg25` oder `origins=kantone`) und `MapServer/<layer>/<featureId>?sr=2056&geometryFormat=geojson`
- Vorschau und optionaler Schnellexport: `wmts.geo.admin.ch`

**Bibliotheken** (per CDN, für Offlinebetrieb nicht gebündelt): `GeoTIFF.js 2.1.3`, `jsPDF 2.5.2`, `JSZip 3.10.1`.

### Prüfstand

Unit-Tests: `node --test tests/*.mjs`. Die Berechnungen für Druckformat, Geometrie, Quellwahl, STAC-Assetfilterung, Quellabdeckung und Höhenlinien wurden lokal ausgeführt. **Der Live-Abruf von originalen swisstopo-COGs und echten politischen Gemeinde-/Kantonsgeometrien konnte mangels Internetzugriff im Ausführungscontainer nicht end-to-end bestätigt werden.** Auch die Speichergrenzen für A0 wurden nicht praktisch verifiziert. Bei einem ersten Online-Test sind API-Erreichbarkeit, Decodierung und PDF-Druck wichtig.

Daten: **© swisstopo**, Nutzungsbedingungen: <https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste>
