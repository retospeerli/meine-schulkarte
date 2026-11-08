# Schweizer Kartengenerator – Version 2.6

Statische Webanwendung für **GitHub Pages**, ohne Backend, von Reto Speerli. Drei Betriebsarten: Landeskarte, SWISSIMAGE-Luftbild, Höhenlinien für Graukarton-Schichtreliefs. Zusätzliche Farbmaske für **politische Gemeinden oder Kantone**.

## Schnellstart

Alle Dateien aus diesem Ordner in ein GitHub-Repository hochladen. Unter **Settings → Pages → Deploy from a branch → main → /(root)** aktivieren. Anschliessend GitHub-Pages-Adresse öffnen. Die Datei `.nojekyll` muss im Root bleiben.

Lokal testen: `python3 -m http.server 8000` im Ordner starten, dann `http://localhost:8000` öffnen. `file://` ist für ES-Module nicht vorgesehen.

## Echte Druckdaten statt WMTS-Kacheln

Der **Standardexport** nutzt originalgetreue **Swiss Map Raster**-GeoTIFFs über den swisstopo-STAC-Dienst, nicht die kleine WMTS-Kachelpyramide. Quelle ist die **KREL**-Farbkombination mit Relief.

**Kartografisch massstabsgebundene Datenquellen, identisch in Vorschau und Druck:**

| Gewählter Massstab | Kartenserie | WMS-Vorschau und Schnelldruck | 508-dpi-Originaldruck |
|---|---|---|---|
| 1:10'000 | SMR10 | `ch.swisstopo.landeskarte-farbe-10` | `ch.swisstopo.landeskarte-farbe-10` |
| 1:25'000 | SMR25 | `ch.swisstopo.pixelkarte-farbe-pk25.noscale` | dieselbe STAC-Collection |
| 1:50'000 | SMR50 | `ch.swisstopo.pixelkarte-farbe-pk50.noscale` | dieselbe STAC-Collection |
| 1:100'000 | SMR100 | `ch.swisstopo.pixelkarte-farbe-pk100.noscale` | dieselbe STAC-Collection |
| 1:200'000 | SMR200 | `ch.swisstopo.pixelkarte-farbe-pk200.noscale` | dieselbe STAC-Collection |
| 1:500'000 | SMR500 | `ch.swisstopo.pixelkarte-farbe-pk500.noscale` | dieselbe STAC-Collection |
| 1:1'000'000 | SMR1000 | `ch.swisstopo.pixelkarte-farbe-pk1000.noscale` | dieselbe STAC-Collection |

Die App nutzt nun **nie** den automatisch umschaltenden Sammellayer `ch.swisstopo.pixelkarte-farbe` für Landeskarte oder Karte grau. Die **Original-Kartengrafik** (Schrift, Signaturen, Selektions- und Generalisierungsregeln) stammt bei den offiziellen Massstäben aus derselben nationalen Kartenserie. Die Graukarte wird aus derselben Kartengrafik in Graustufen ausgegeben.

Bei einem frei gewählten **Zwischenmassstab** (z. B. 1:40'000) wird die nächstgeeignete amtliche Karte (hier SMR50) für die exakte Druckgeometrie im gewünschten Massstab skaliert. Das ist **keine neue amtliche Kartengrafik** – die App zeigt Produkt und Vergrösserung in Prozent offen an. Eine amtliche Ausgabe mit exakt passenden Beschriftungen/Signaturen ist deshalb nur bei den sieben offiziell unterstützten Massstäben möglich. Für Landeskarten ausserhalb 1:10'000 bis 1:1'000'000 gibt die App eine Fehlermeldung statt eine falsche Normqualität aus; Luftbilder/Höhenlinien bleiben auch ausserhalb dieses Bereichs frei skalierbar.

Die Landeskarten-Vorschau wird aus dem expliziten WMS-Layer gerendert. Die normgetreuen Druckdaten stammen als `KREL`-TIFF aus dem jeweils gleichen Kartenprodukt. Lokal zugefügte TIFFs müssen die zur Karte passende native Bodenpixelweite (508 dpi im Nennmassstab) aufweisen; andernfalls wird die Ausgabe abgebrochen. Der WMS-Schnell-PDF-Export bleibt ein qualitativ niedrigeres Verfahren und **kein** Ersatz für das GeoTIFF-Druck-PDF.

Beim Luftbildmodus: **SWISSIMAGE-Original-COGs** (10 cm Bodenauflösung, regional ältere/geringere Originaldetailauflösung; der tatsächliche Pixelabstand wird gelesen).

508 dpi ist **Voreinstellung für das Ausgaberaster**. Die Original-Swiss-Map-Raster-GeoTIFFs besitzen 508 dpi **bei ihrem jeweiligen Nennmassstab**. Bei beliebig eingegebenen Druckmassstäben ist die *effektive Quellen-DPI* anders. Beispiel: Swiss Map Raster 25 im Druckmassstab 1:25'000 = 508 Original-dpi; im nicht-amtlichen Zwischenmassstab 1:20'000 wäre SMR25 vergrössert und hätte ca. 406 effektive Quelldpi. Die App zeigt nach dem Lesen der TIFF-Metadaten die tatsächliche Quellenauflösung an. **Ausgabe-DPI bedeutet nicht zusätzliche Quelldetails.**

DIN A5, A4, A3, A2, A1, A0, hoch/quer, freier Massstab und Rand. Die App berechnet exakt georeferenzierte PDF-Bildkacheln von maximal 512 × 512 Pixel. Die PDF-Seite selbst ist auf die Originalmasse in Millimetern eingestellt. **Beim Drucken 100 % / tatsächliche Grösse** ohne Skalierung wählen.

### Speicher- und Druckhinweise

A0 bei 508 dpi bedeutet ungefähr **400 Millionen Ausgabepixel** (je nach Rand). Die Ausgabe wird zwar blockweise verarbeitet, aber das PDF wird von jsPDF im Speicher aufgebaut. A0 kann **sehr lange dauern**, mehrere Hundert MB bis GB beanspruchen oder auf Geräten mit wenig RAM fehlschlagen. Die App bricht bei zu vielen Kacheln oder fehlenden Original-TIFFs ab. Ein Desktop-PC mit genügend Speicher ist sinnvoll; ein kleiner A4-Testdruck empfiehlt sich vor dem Grossformatdruck. Das PDF enthält RGB, nicht zwingend das CMYK-Profil einer Druckerei; im Zweifel ICC-Profil/Druckerei abstimmen.

**Fallback:** WMS-Schnellexport für Landeskarten und WMTS-Schnellexport für Luftbilder bleiben enthalten, sind aber **nicht** als echter 508-dpi-Originaldruck gekennzeichnet.

Für lokale Nutzung kann man die Original-GeoTIFFs selbst herunterladen und im Exportbereich per Mehrfachauswahl hinzufügen. Diese Dateien müssen in **EPSG:2056** georeferenziert sein. Die App verwirft nicht passende oder unvollständige Quellen, statt leere Flächen als fertige Karten auszugeben.

## Korrektur Version 2.2 – Gemeindesuche

Die Gemeindesuche prüft `SearchServer?origins=gg25` und verwirft gültige Treffer nicht mehr, wenn das optionale Feld `layerBodId` fehlt. Liefert die Ortssuche keine verwertbare Feature-ID, verwendet sie zusätzlich den offiziellen `MapServer/find`-Dienst mit `searchField=gemname`. Historische Gemeinden werden nach Möglichkeit anhand `is_current_jahr` ausgeschlossen. Der Testfall **Wädenswil (ZH)** ist als automatisierter Regressionstest hinterlegt (simulierte API-Antworten). Live-Anfragen konnten in dieser Umgebung nicht geprüft werden.

Bei GitHub Pages nach Austausch der Dateien einmal mit **Strg+F5** aktualisieren. Die Modul-URLs enthalten einen Versionsparameter zur Cache-Aktualisierung.

## Politische Gemeinde / Kanton in Farbe

Unter «Gebiet farbig hervorheben» auswählen:

- **Gemeinde**: Name eingeben, Treffer aus der GeoAdmin-Ortssuche auswählen.
- **Kanton**: einen von 26 Kantonen aus dem Dropdown übernehmen.

Die App lädt danach die **Originalpolygon-Geometrie** von **swissBOUNDARIES3D** über `api3.geo.admin.ch` als GeoJSON in **EPSG:2056**, mit Löchern und mehrfach getrennten Flächenteilen. Optional wird das gewählte Gebiet automatisch auf der Druckseite eingepasst.

**Darstellung:** innen unverändert in Farbe, ausserhalb echtes Graustufenbild. Die Geometrie wird in der Vorschau und im Original- sowie WMS-/WMTS-PDF-Export als Maske verwendet. Für die Hervorhebung im Landeskarte- bzw. Luftbildmodus bleiben. «Karte grau» zeigt bewusst die gesamte Karte grau.

## Höhenlinien / Graukarton

Vorhandener Modus aus Version 1.0: swissALTI³D mit 2-m-COG-Höhenraster oder lokalen LV95-GeoTIFFs, Äquidistanz und Abtastung wählbar, Export als Vektor-PDF, SVG und ein SVG pro Höhenstufe im ZIP. **Die SVGs sind Linienvorlagen, noch keine automatisch geschlossenen Ausschnittflächen**. Die farbige Gemeinde-/Kantonsmaske gilt nicht für den Höhenlinienmodus.

## Korrektur Version 2.2 – 165 Höhenkacheln bei A2 hoch / 1:25’000

Der Abbruch bei 160 Kacheln war eine **willkürliche Anwendungsschranke**, keine Grenze des Browsers oder von swisstopo. Sie ist entfernt. Ein A2-Blatt (5 mm Rand) bei 1:25’000 umfasst 10,25 × 14,60 km, im Beispiel um 2’692’322 / 1’228’496 sind es 165 Stück swissALTI³D-COGs mit 2 m Quelldaten. Die Höhenlinien können weiterhin aus den originalen 2-m-Quellen und dem gewählten Ausgangsraster (z. B. 10 m) abgeleitet werden.

- Quellen nacheinander laden und unmittelbar in das Zielraster integrieren; keine 165 kompletten Rasterkacheln gleichzeitig im Speicher halten.
- Bis zu zwei zusätzliche Versuche pro fehlgeschlagene Quelle; klare Fortschrittsanzeige und jederzeit Abbruch über **Vorgang abbrechen**.
- Kleine geometrische Korrektur: Die Rasterprobe liegt nun exakt innerhalb der Druckfläche, einschliesslich des rechten und unteren Blattrands. Keine künstliche Lücke durch Aufrundung auf den nächsten vollen Rasterabstand.
- Bei echter unvollständiger Abdeckung wird **kein** Höhenlinienexport erzeugt. Die Meldung nennt fehlende Rasterwerte und die zuerst ausgefallenen Quellen.
- Die erwartete Kachelzahl und die grobe Datenmenge werden angezeigt. Gemäss swisstopo liegt eine 2-m-COG-Datei typischerweise bei etwa 1 MB; der reale HTTP-Transfer hängt vom COG-Zugriff ab.

Die App ist statisch für GitHub Pages. Der Vollabruf echter swisstopo-Quellen wurde in dieser Entwicklungsumgebung nicht end-to-end überprüft. Der 165-Kachel-Test verwendet simulierte STAC- und GeoTIFF-Antworten, prüft aber die komplette Datenpipeline bis zur vollständigen Rasterabdeckung.

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


## Neu in 2.3

- Bei Auswahl einer politischen Gemeinde werden angrenzende Seen zusätzlich farbig hervorgehoben, sofern die Gemeinde an eine See-Fläche grenzt.
- Der ausgegraute Bereich ausserhalb der ausgewählten Gemeinde bzw. des ausgewählten Kantons wird heller dargestellt, damit das Zielgebiet stärker hervorsticht.


## Version 2.4 – Seen an Gemeindegrenzen

- Zusätzlicher amtlicher **Seeflächenlayer** `ch.bafu.vec25-seen` (Polygone) neben `swissTLM3D` (Gewässernetz, teils Seeufer-Linien). Das BAFU-Layer basiert auf älteren VECTOR25-Daten.
- Abfragegebiete werden aufgeteilt; pro Gebiet `limit=200` mit `offset`-Paginierung. Fehlende Seegeometrien werden nicht stillschweigend erfunden.
- **Union statt XOR:** See- und Gemeindegeometrien werden separat farbig eingeblendet. Gemeinsame Überlappungsbereiche bleiben farbig. Mehrere Seen werden ebenfalls separat gezeichnet.
- Erkennung der Seebezeichnungen mit Endung `-see` sowie `-weiher` korrigiert; Fliessgewässer ausgeschlossen.
- 35 m Abstandstoleranz zwischen unabhängigen Gemeinde- und Uferpolygonen für leicht unterschiedliche Datenstände.
- Das Auswahlfeld meldet die Zahl der erkannten angrenzenden Seen und API-Warnungen.
- Prüffall Wädenswil: Zürichsee und Hüttnersee als zwei separate farbige Seeflächen. Tests mit simulierten API-Antworten, kein Live-Test der swisstopo-API.

**Hinweis zur Genauigkeit:** Der BAFU-Seeflächenlayer verwendet VECTOR25-Geometrien mit Datenstand 2007. Für allerhöchste Seeuferpräzision wird eine Aktualisierung auf aktuelle swissTLM3D-Bodenbedeckungs-Polygone benötigt; die aktuelle Browser-API liefert nicht in allen Fällen diese Flächen als einzelne Geometrien. Diese Version versucht keinen künstlichen Farbflächenersatz.


## Version 2.5 – Kartografische Generalisierung passend zum Ausgabemassstab

Die Landeskarten erhalten statt der automatisch skalierten GeoAdmin-Sammelkarte je eine feste Kartenserie für Vorschau, Schnelldruck-PDF und Originaldruck. Sieben offizielle Massstäbe werden berücksichtigt, freie Zwischenmassstäbe mit transparenter Kennzeichnung ihrer Ausgangskarte und Bildskalierung. Bei massstabsfremden lokalen GeoTIFFs bricht der Originaldruck ab. Graukarten verwenden dieselbe kartografische Serie in Graustufen. Gemeinde-/Kantonshervorhebung, See-Erkennung, Luftbild- und Höhenlinienmodus bleiben erhalten.


## Version 2.6 – Reparatur der Landeskarten-Vorschau bei A0 / 1:10'000

**Ursache:** Die frühere Vorschau hat die WMTS-Zoomstufe allein aus der Bildschirmbreite bestimmt. Bei A0 / 1:10'000 waren das neun Kacheln auf Zoom 19, obwohl die massstabsgebundenen swisstopo-Layer nicht an jeder WMTS-Zoomstufe verfügbar sind. Das führte zu 0/9 Kacheln und einer leeren Vorschau.

**Korrektur:** Landeskarte und Karte grau werden nun per offiziellem WMS `GetMap` (`wms.geo.admin.ch`, `EPSG:2056`) mit der ausdrücklich gewählten Kartenserie und der exakten LV95-Kartenbegrenzung gerendert – ohne WMTS-Zoomstufen. Das funktioniert für A0 bei 1:10'000 genauso wie für die übrigen Formate und Massstäbe, sofern der WMS-Dienst im Browser erreichbar ist. Der schnelle PDF-Kartendienst-Export verwendet für Landeskarten ebenfalls WMS, mit blockweiser Abfrage und derselben Geo-Referenz. Die Vorschau meldet `lädt`, `geladen` oder einen konkreten Fehler, nicht mehr ein irreführendes 0/9.

**Unverändert:** Der Standard-Originaldruck bezieht 508-dpi-Swiss-Map-Raster-COGs; Luftbilder bleiben über WMTS/SWISSIMAGE, Höhenlinien über swissALTI³D. Alle Gemeinde-/Kantonshervorhebungen einschliesslich der Seen bleiben erhalten.

**Einschränkung:** Die WMS-Erreichbarkeit für jede konkrete Kombination von Layer und Ausschnitt lässt sich in der Entwicklungsumgebung nicht live bestätigen; ein Online-Test über GitHub Pages bleibt nötig.


## Version 2.7 – A0-SWISSIMAGE ist Pflichtfall

**Neu: A0-Luftbilddruck als echtes einseitiges Streaming-PDF in Originalgrösse.**
Die bisherige jsPDF-Ausgabe hat selbst bei 512-Pixel-Bildblöcken alle JPEGs im
JavaScript-Heap gesammelt. Neu wird die PDF-1.4-Datei während der Erzeugung
inkrementell geschrieben. Ein JPG-Bildblock wird decodiert und unmittelbar als
DCT-kodiertes RGB-XObject eingefügt. Die endgültige Cross-Reference-Tabelle
wird beim Abschluss geschrieben. Keine komplette A0-Rasterfläche wird angelegt.

- **Chrome und Edge:** Das Systemdialogfenster zum Speichern erscheint **vor**
  dem ersten Download. Anschliessend wird die Datei über die File System Access
  API direkt auf die gewählte Festplatte geschrieben. Ein Abbruch bricht die
  unvollständige Datei ab.
- **Andere moderne Browser:** Wenn `navigator.storage.getDirectory()`
  verfügbar ist, schreibt der Generator zunächst in den Origin Private File
  System Storage (OPFS) und bietet danach den Download der fertigen Datei an.
  OPFS benötigt freien temporären Speicherplatz.
- **Ohne beide APIs:** Die App erklärt, warum dieser browserseitige A0-Export
  nicht unterstützt wird; keine unvollständige Datei wird als Druckdatei angeboten.
- **Automatische SWISSIMAGE-Quellauflösung:** Bei 508 dpi und 1:50'000 reicht
  die 2-m-Quelle aus (635 effektive Quellen-dpi). Bei 1:25'000 (1.25 m/Pixel)
  verwendet die App dagegen 10-/25-cm-Quellen. Keine pauschale Hochrechnung.
- Der GeoTIFF.js-CDN-Pfad wurde auf **2.1.4-beta.1** gesetzt. Diese Version
  enthält die Korrektur für den dokumentierten Fehler `reading 'offset'`.
- Maximal 14 geöffnete SWISSIMAGE-Kacheln (LRU) und begrenzter Blockcache.
- Die Farbhervorhebung für Gemeinden / Kantone samt Seen bleibt im A0-PDF erhalten.
- Das PDF enthält JPEG-kodierte RGB-Luftbildblöcke; es ist **kein PDF/X-4**.
  Gegebenenfalls konvertiert die Druckerei es mit ihrem ICC-Profil.

**Nicht als vollständig live-verifiziert ausgeben:** Echte swisstopo-STAC- und
COG-Downloads sowie ein A0-Drucker-Workflow können in der Entwicklungsumgebung
nicht end-to-end ausgeführt werden. Die internen Tests prüfen PDF-Struktur,
Seitengeometrie, Quellwahl und Simulation von Blöcken.


## Version 3.1 – Optionales Höhenlinien-Büchlein

Im Modus **Höhenlinien** kann die Checkbox **«PDF als Höhenlinien-Büchlein»** aktiviert werden. Der normale PDF-Export erstellt dann ein **mehrseitiges Vektor-PDF**, dessen Seiten aufsteigend nach Höhe sortiert sind. Alle einzelnen Kurven einer Höhenstufe (auch getrennte Hügel/Insellinien) liegen **zusammen auf derselben Seite**; die nächste Höhenstufe erhält die nächste Seite.

Alle Seiten behalten dasselbe DIN-Format, dieselbe Orientierung, dieselbe LV95-Kartenausdehnung und denselben Druckmassstab. Die Linienstärke wird aus den vorhandenen Einstellungen übernommen; Höhenangabe und Seitenzahl stehen bei mindestens 5 mm Rand ausserhalb der Kartenfläche. Die Ausgabe wird direkt als PDF-1.4-Dateistrom geschrieben, auch für A0 und viele Höhenstufen; das gesamte Büchlein liegt nicht auf einmal im Arbeitsspeicher. Chrome/Edge bietet einen direkten Speicherdialog, andere kompatible Browser nutzen den temporären OPFS-Speicher.

**Ohne Häkchen** wird weiterhin wie bisher das Gesamt-PDF erzeugt. Der vorhandene SVG-Gesamtexport und die ZIP-Datei mit einzelnen SVG-Stufen bleiben bestehen. Das Büchlein enthält exakte *Höhenlinien* als Vektoren, aber noch keine automatisch geschlossenen Karton-Ausschnittflächen. Alle Seiten bei **100 % / tatsächliche Grösse** drucken.


## Neu in 2.9

- Das optionale Höhenlinien-Büchlein beginnt nun mit einer Titelseite/Gesamtübersicht.
- Jede Folgeseite zeigt genau eine Höhenstufe.
- Auf jeder Folgeseite ist die wegzuschneidende Fläche schraffiert dargestellt.
- Offene Konturen am Blattrand werden weiterhin als Linien gezeigt; die Schraffur basiert auf geschlossenen Konturen dieser Höhe.


## Neu in 3.0

- Das Höhenlinien-Büchlein enthält keinerlei Text mehr.
- Blatt 1 zeigt alle Höhenlinien zusammen.
- Alle folgenden Blätter zeigen jeweils nur eine Höhenstufe.
- Schraffuren, Titel, Seitenzahlen und Fusszeilen wurden vollständig entfernt.
- Ein Fehler im PDF-Clip wurde korrigiert; die Höhenlinien werden nun tatsächlich gezeichnet.


## Neu in 3.1

- Der Rand des Reliefs wird jetzt auf jeder Seite des Höhenlinien-Büchleins mitgezeichnet.
- Auf jeder Höhenstufen-Seite wird zusätzlich die nackte Höhenzahl ausgegeben.
- Das erste Blatt bleibt die Gesamtübersicht aller Höhenlinien.
- Weitere Beschriftungen, Titel oder Seitenzahlen bleiben weiterhin unterdrückt.
