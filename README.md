# BraccioSim

3D-Simulation des Roboterarms Arduino/TinkerKit **Braccio** im Browser – Version **V1.3**.
Gestaltung angelehnt an MobileRobotSim (Prof. Dr.-Ing. Frank Bender, DHBW Stuttgart).

## Starten

- **macOS:** `start.command` doppelklicken. Das Skript startet einen lokalen Webserver und öffnet den Browser.
  Falls macOS warnt: Rechtsklick → *Öffnen*.
- **Windows:** `start.bat` doppelklicken (benötigt Python). Das Fenster muss offen bleiben, solange der Simulator läuft.
- **Alternativ:** `index.html` direkt in Chrome, Edge oder Firefox öffnen (ohne Controller-Unterstützung).

Keine Installation nötig. Three.js (3D) wird per CDN geladen, daher braucht es eine Internetverbindung.
Einstellungen, Teach-In-Punkte, Zonen und Farbschema werden im Browser gespeichert (localStorage).

## Aufbau

- **Kopfzeile:** fünf Reiter, rechts Autor und Version, **▶ Demo** und Schalter Hell/Dunkel (☀/☾).
- **Links:** Inhalt des gewählten Reiters.
- **Mitte:** Werkzeugleiste (Status, Pause, Tempo, Reset, Anzeigen *TCP-Punkt, Text (Beschriftungen), KS, Spur, Pfad, Zonen*, Spur löschen ⌫, Ansicht, Aufnahme), 3D-Ansicht mit HUD, darunter das **Scope**: wählbar *Gelenkwinkel M1–M6*, *TCP-Position x/y/z*, *TCP-Euler-Winkel* (Z-Y-X: α um z, β um y, γ um x, bezogen auf das Basis-KS) oder *TCP-Geschwindigkeit*, jeweils Soll (gestrichelt, Modell) und Ist (real), Kanäle einzeln zuschaltbar, Zeitfenster 5–60 s.
- **Rechts – Umgebung:** Szenario wählen, szenariospezifische Einstellungen, Karte **Kameras** (oben Bild im Bild, darunter die Reiter *Greiferkamera* mit Farbsensor und *Stativkamera* mit Standort und Würfelerkennung; Zahlenwerte unter „Feineinstellung“ bzw. „Bereich anpassen“), Greifer, ausgewähltes Objekt, Objektliste.

## Reiter

| Reiter | Inhalt |
|---|---|
| **Manuelle Steuerung** | Servowinkel M1–M6 per Slider, Tastatur oder PS4-Controller, Grundposen, Greifer, TCP-Pose (real/Modell), kartesisches Verfahren in x/y/z/ψ |
| **Arbeitsraumbeschränkung** | erreichbarer/unzulässiger Arbeitsraum (2D-Schnitt, 3D), Überwachung mit Reaktion *warnen / verlangsamen / Not-Halt*, Sperrzonen und Arbeitsbereiche, Tisch- und Selbstkollision, Geschwindigkeitsgrenze, Ereignisprotokoll |
| **Teach-In und Replay** | Posen speichern, anfahren, überschreiben; Replay als PTP oder LIN mit Trapez-, Polynom-3- oder Polynom-5-Profil, mit/ohne Halt; Plots q, q̇, q̈; CSV-Export der geplanten Bahn |
| **Inverse Kinematik** | Unterbereiche *Inverse Kinematik* (geometrische Lösungen, numerisch per Gradient/Pseudoinverse/DLS, Jacobi-Matrix), *Modell* (Geometrie, DH-Tabelle, T₀ⁱ, Servos, Statik) und *Kalibrierung* (Offsets simulieren, messen, per Least Squares schätzen, kompensieren) |
| **Förderband-Szenario** | Bandantrieb *Aus / Ein / Automatik*, Lichtschranke, Würfel nachlegen (zufällig oder je Farbe), Roboter-Automatik: Würfel nach Farbe in die Behälter links/rechts sortieren |
| **Co-Simulation** | Visualisierung einer Simulink-Simulation statt Unreal: Web-Blöcke (Scene Configuration, Robot, Actor) senden Roboter und Akteure live per WebSocket; Akteure einzeln ausblendbar |

## Szenarien (Panel „Umgebung“)

- **Labor-Szenario (Übung 2):** Plattform, Pick-up-Marker mit zwei Würfeln, Hochregal, Sortierbox und virtuelle Wand der Laborübung 2; TCP-Anzeige im Labor-KS0. Die Lage der virtuellen Wand ist per Schieberegler oder Eingabe einstellbar (y = −350 … 450 mm, entspricht x_lab); sie leuchtet rot, sobald der TCP auf ihrer Rückseite ist.
- **Farb-Sortierung:** Würfel (Kante 25 mm) in Rot, Gelb, Dunkelgrün und Dunkelblau, Auffangbehälter symmetrisch links und rechts. Je Farbe wählbar: *Behälter links*, *Behälter rechts* oder *liegen lassen*. Der Farbsensor am Greifer bestimmt den Farbton (HSV). „Automatisch sortieren“ fährt jeden Würfel an, misst die Farbe und legt ihn ab.
- **Förderband:** Das Band läuft radial auf den Roboter zu (Anschlag 150 mm vor der Achse) und bringt Würfel (25 mm) in Rot, Gelb, Grün und Blau. Die Lichtschranke vor dem Anschlag hält das Band in der Betriebsart *Automatik* an; der Farbsensor bestimmt die Farbe, die Zuordnung Farbe → Behälter ist einstellbar.
- **Leerer Tisch, Einzelner Würfel, Stapeln.**

Auf der in +y weisenden Außenwand jedes Behälters zeigen kleine Farbschilder, welche Farben ihm zugeordnet sind; sie ändern sich mit der Zuordnung. In jedem Behälter liegen höchstens drei Würfel. Kommt ein weiterer hinzu, wird zuvor der unterste (bei gleicher Höhe der älteste) entnommen – so läuft das Förderband im Dauerbetrieb. „Behälter leeren“ räumt die Behälter aus.

## Kameras und Demo

- **Greiferkamera (Taste 0):** seitlich am Greifer auf der vom Roboter abgewandten Seite, blickt entlang der Werkzeugachse; der obere Bildrand zeigt vom Roboter weg. Das Kameragehäuse ist im 3D-Bild sichtbar. Mit „Greiferkamera montiert“ (Panel „Umgebung“ → Kameras) lässt sie sich abnehmen – dann gibt es weder Ansicht 0 noch Farberkennung, die Sortier-Automatik startet nicht.
- **Stativkamera (Taste 7):** Standardpositionen *Überblick vorne rechts*, *Förderband seitlich*, *Bedienerplatz hinter dem Roboter*; außerdem frei platzierbar über Standort x/y/z, Schwenk, Neigung und Öffnungswinkel (Panel „Umgebung“ → Kameras). „Aus aktueller Ansicht“ stellt das Stativ an die Stelle der Mausansicht, „Auf Roboter ausrichten“ richtet es auf den Arm aus.
- **Bild im Bild:** Greifer- oder Stativkamera unten rechts in der 3D-Ansicht einblenden, mit Rahmen und Titelleiste (auch im Video enthalten).
- **Erkennung mit der Stativkamera:** Im Panel „Umgebung“ einen überwachten Bereich auf dem Tisch festlegen (Vorgaben *Würfelfeld*, *Bandende*, *ganzer Arbeitsbereich* oder Mitte/Breite/Tiefe). Erkannt werden Würfel in diesem Bereich, die im Bildfeld der Stativkamera liegen und nicht verdeckt sind (z. B. durch den Arm); sie werden im 3D-Bild umrahmt und mit Farbe und Lage aufgelistet. Bei der Farb-Sortierung und im Förderband-Reiter lässt sich die **Farberkennung** auf *Stativkamera* umstellen – dann funktioniert die Automatik auch ohne Greiferkamera, und Würfel, die liegen bleiben sollen, werden gar nicht erst angefahren.
- **Demo-Modus (▶ Demo):** Vollbild, zu Beginn ein Kamera-Rundflug um den Roboter (Mausklick überspringt ihn), dann Förderband-Szenario im Endlosbetrieb mit eingeblendeter Greiferkamera; das Scope mit den gewählten Größen bleibt unten sichtbar, die TCP-Spur läuft – sofern „Spur“ eingeschaltet ist – als rollende Spur mit (in Kamerabildern wird sie wie der TCP-Punkt nicht gezeigt). **Esc** beendet die Demo und stellt Szenario, Ansicht und Einstellungen wieder her.

## Tastatur

| Taste | Wirkung |
|---|---|
| A / D | Basis M1 links / rechts drehen |
| ↑ / ↓ | Schulter M2 heben / senken |
| W / S | Ellbogen M3 senken / heben |
| ← / → | Handgelenk M4 heben / senken |
| T / G | Greifer M5 drehen + / − |
| Strg | Greifer M6 öffnen / schließen (Umschalten) |
| Leertaste | Roboterbewegung anhalten / fortsetzen – Simulationszeit und Förderband laufen weiter |
| P | Simulation anhalten / fortsetzen |
| 1 – 6 | Ansicht isometrisch, vorne, hinten, Seite links, Seite rechts, oben |
| 7 | Stativkamera |
| 8 | Demo-Ansicht (von vorne links auf Band, Behälter und Roboter; damit startet auch der Demo-Modus) |
| 0 | Kamera auf dem Greifer |
| F1 | Vollbild an / aus: nur Hauptansicht und Scope-Verläufe, in jeder Szene; eine eingeblendete Greiferkamera bleibt sichtbar, die Stativkamera als Bild im Bild wird ausgeblendet |
| Esc | Demo bzw. Vollbild beenden |

Die Gelenktasten wirken im Reiter *Manuelle Steuerung*, solange kein Eingabefeld den Fokus hat; das Tempo ist dort einstellbar.

## Controller (PS4-Gamepad)

Per USB oder Bluetooth verbinden und eine Taste drücken – erst dann meldet der Browser den Controller (Seite über `http://localhost` öffnen, nicht als Datei). Der Controller wirkt in allen Reitern; die Sticks steuern proportional zur Auslenkung und übernehmen laufende Bewegungen. Totzone 10 % in der Stickmitte, dazu ein Totband von 5 % je Achse, damit eine kleine Nebenauslenkung keine zweite Achse verfährt. Belegung wie eine Euro-Baggersteuerung:

| Controller | Wirkung |
|---|---|
| linker Stick ← / → | Basis M1 drehen |
| linker Stick ↑ / ↓ | Ellbogen M3 (nach hinten = senken) |
| rechter Stick ↑ / ↓ | Schulter M2 (nach vorne = senken) |
| rechter Stick ← / → | Handgelenk M4 (nach links = senken) |
| Steuerkreuz ← / → | Greifer M5 drehen − / + |
| R2 | Greifer M6 stufenlos schließen (loslassen = offen) |
| ✕ | Greifer öffnen / schließen (Umschalten) |
| R1 | Vollbild an / aus (wie F1) |
| ○ | Stopp (auch Automatik) |
| △ | Aufrecht (90°) |
| □ | aktuelle Pose als Teach-In-Punkt |
| Steuerkreuz ↑ / ↓ | Tempo schneller / langsamer |
| L2 gedrückt halten | kartesisch verfahren: linker Stick x/y, rechter Stick ↑/↓ z, ←/→ ψ |
| L3 (linken Stick drücken) | KS für L2 umschalten: mit der Basis gedreht (vorne = radial in Armrichtung, rechts = quer dazu) oder Welt-KS (vorne = +y) |
| L1 gedrückt halten | Kamera bewegen: linker Stick umkreisen, rechter Stick ↑/↓ zoomen, ←/→ verschieben (Ansichten 1–6, 8) |
| Options | Demo starten / beenden |
| Touchpad-Taste | nächste Ansicht |

Der Controller vibriert kurz am Gelenkanschlag und an der Arbeitsraumgrenze beim kartesischen Verfahren, kräftiger bei Kollisionen des Arms mit Tisch, Basis oder festen Hindernissen (Regal, Behälter; solange die Kollision andauert, im Takt wiederholt), an der virtuellen Wand (Labor-Szenario) und bei Verletzung der Arbeitsraumüberwachung (z. B. Sperrzone). Die Kollisionsprüfung wirkt auch bei ausgeschalteter Überwachung. Die Karte im Reiter *Manuelle Steuerung* zeigt Verbindung, Modus und Stick-Auslenkung.

## Co-Simulation mit MATLAB/Simulink

Der Reiter **Co-Simulation** ersetzt die Unreal-Visualisierung des Simulink-Modells (`Braccio_CtrlSimMdl`) und läuft damit auch auf macOS und Linux. Im Modell tritt an die Stelle jedes Unreal-Blocks ein gleichartiger Web-Block, der seine Daten per WebSocket an BraccioSim schickt. Benötigt wird MATLAB/Simulink ab R2021a, keine Toolbox.

| Unreal-Block | Web-Block (MATLAB System, Interpreted execution) | Ein-/Ausgänge, Parameter |
|---|---|---|
| Simulation 3D Scene Configuration | **Web Scene Configuration** (`BraccioWebScene`) | öffnet den WebSocket-Server `ws://127.0.0.1:8766`, sendet alle `SampleTime` = 20 ms ein Bild |
| Simulation 3D Robot | **Web Robot** (`BraccioWebRobot`) | Eingang `Config` wie bisher (q1…q5, Greifergelenke); q6 wird aus `braccioGripper` zurückgerechnet |
| Simulation 3D Actor | **Web Actor** (`BraccioWebActor`) | gleiche Eingänge (`Translation`, `Rotation`, `Color`, `Transparency`) und Parameter (Name, Lage im Unreal-KS, Form/Größe/Farbe aus dem Init-Skript) |

`BraccioWebViz_ersetzen('Braccio_CtrlSimMdl')` tauscht alle Unreal-Blöcke eines Modells automatisch aus und übernimmt Parameter und Verbindungen; danach das Modell unter neuem Namen speichern. BraccioSim zeigt dann Roboter und alle Akteure (Würfel samt Vorrat, Regal, Wand mit Alarmfarbe, Sortierbox, Plattform, Marker, Hilfspunkte) wie zuvor Unreal; einzelne Akteure lassen sich im Reiter zusätzlich ausblenden. Solange Daten eintreffen, führt Simulink den Roboter; Servo-Modell und Bedienung des Simulators ruhen.

| Datei (Ordner `matlab-cosim/`) | Zweck |
|---|---|
| `BraccioWebScene.m`, `BraccioWebRobot.m`, `BraccioWebActor.m` | die drei Web-Blöcke |
| `BraccioWebHub.m` | gemeinsame WebSocket-Verbindung der Blöcke |
| `BraccioWebViz_ersetzen.m` | ersetzt alle Unreal-Blöcke eines Modells durch Web-Blöcke |
| `BraccioWebViz_test.m` | prüft die Verbindung ohne Simulink (60 s Testbewegung) |

Ablauf: Dateien in den Modellordner legen → Ini-Skript ausführen → `BraccioWebViz_ersetzen('Braccio_CtrlSimMdl')` → Modell speichern → Simulation starten → in BraccioSim „Verbinden“. Die Web-Blöcke bremsen die Simulation nicht; für eine flüssige Darstellung das Modell auf Echtzeit bremsen (Simulation Pacing). Chrome und Edge fragen beim ersten Verbinden nach dem Zugriff auf das lokale Netzwerk; Safari erlaubt die Verbindung nur, wenn der Simulator lokal läuft (`start.command`).

Nachrichten (JSON, Labor-KS0, die Blöcke rechnen aus dem Unreal-KS um): nach dem Verbinden `{type:'scene', actors:[{n, shape, size, color, alpha, p, r, s}]}`, danach je Bild `{type:'frame', t, q:[q1…q5], q6, actors:[{n, p, r, color, alpha}]}`.

## Aufzeichnung

- **⏺ Daten (Messdaten):** zeichnet mit 100 Hz (Simulationszeit) Soll- und Istwinkel M1–M6, TCP-Position, ψ, Euler-Winkel Z-Y-X, TCP-Geschwindigkeit, Greiferöffnung, gegriffenes Objekt und Bewegungsart auf. Erneut klicken: CSV wird gespeichert (Trennzeichen „;“).
- **⏺ Video:** nimmt die 3D-Ansicht samt HUD und darunter die Messschriebe des Scopes auf (30 fps, max. 1920 px breit). Erneut klicken: Datei wird gespeichert – als **MP4 (H.264)** in Chrome und Edge; Browser ohne MP4-Aufnahme (z. B. Firefox) speichern WebM.

## Modell und Konvention

```
φ  = M1                 e2 = 180° − M2          e3 = 270° − M2 − M3
ψ  = 360° − M2 − M3 − M4 (Werkzeugwinkel ggü. Horizontale, −90° = senkrecht nach unten)
r  = a2·cos e2 + a3·cos e3 + L·cos ψ,   z = d1 + a2·sin e2 + a3·sin e3 + L·sin ψ
```

DH-Parameter (T = Rot_z(θ)·Trans_z(d)·Trans_x(a)·Rot_x(α)):

| i | θ_i | d_i | a_i | α_i |
|---|---|---|---|---|
| 1 | M1 | d1 | 0 | 90° |
| 2 | 180° − M2 | 0 | a2 | 0 |
| 3 | 90° − M3 | 0 | a3 | 0 |
| 4 | 180° − M4 | 0 | 0 | 90° |
| 5 | M5 | L_TCP | 0 | 0 |

Standardgeometrie: d1 = 71,5 mm, a2 = a3 = 125 mm, d5 = 130 mm (Greiferflansch), L_TCP = 180 mm (Greifmitte), L_Spitze = 186 mm.
Die Werte lassen sich unter *Inverse Kinematik → Modell* an einen konkreten Roboter anpassen.

Die 3D-Darstellung nutzt die STL-Geometrie des Braccio (reduzierte Meshes in `js/meshes.js`, je Glied im zugehörigen DH-Koordinatensystem; der Greifer sitzt auf KS5 mit d5 = 130 mm, die Finger öffnen und schließen mit M6). Der Greifer ist als Getriebe animiert: Servo-Zahnrad und Gegenrad (1:1, gegensinnig) treiben je Seite ein Viergelenk aus Kurbel (30 mm), Schwinge (30 mm) und Fingerträger (25 mm); die Getriebestellung wird aus der Greiferöffnung berechnet (`BS.kin.gripLinkage`).

Die Meshes entsprechen den Visuals des MATLAB-Modells `Braccio_robot.mat` (`rigidBodyTree`, `*_reduced.stl`). Für die Darstellung werden die Normalen mit Kantenwinkel geglättet, Servos (schwarz) und Abtriebswellen (weiß) sind als eigene Teile abgetrennt. `js/details.js` ergänzt Achsbolzen, Basisschrauben, Gelenkstifte im Greifer, die Steuerung wie im Labor direkt hinter dem Roboter, Kabelausgang zum Roboter (graues Gehäuse mit Acryldeckel, DHBW-Trägerplatine mit NUCLEO-H755ZI-Q, Servobuchsen J9–J14, zwei Drehknöpfe, Taster, NotAus, LEDs LIM X/Y/Z, Manual und AUTO, die den Zustand der Simulation anzeigen) und die 3-adrigen Servokabel, die entlang des Arms und durch die Kabeltülle zu den Buchsen laufen und der Bewegung folgen. Die Zusatzteile sind rein visuell und gehen nicht in Kollisions- oder Arbeitsraumprüfung ein.
Alle Servos auf 90° heißt: Arm steht senkrecht. M5 = 90° heißt: Die Greiferbacken öffnen quer zur Armebene.

**Grenzen des Modells:**
- Simuliert werden Kinematik und ein vereinfachtes Servo-Modell (PT1 mit Geschwindigkeitsbegrenzung), keine Mehrkörperdynamik.
- Das Greifen ist vereinfacht: Würfel richten sich beim Schließen an den Backen aus.

## Dateien

```
index.html          Einstieg
start.command       Startskript (macOS)
css/style.css       Gestaltung (Dunkel- und Hell-Modus)
js/core.js          Konfiguration, Hilfsfunktionen, Plot
js/kinematics.js    DH, Vorwärts-/inverse Kinematik, Jacobi, Arbeitsraum, Kalibrier-Schätzung
js/trajectory.js    Trajektorienplanung
js/sim.js           Simulationskern: Zeit, Servos, Greifen, Objekte, Behälter, Förderband, Szenarien, Überwachung
js/scenes.js        Labor-Szenario (Szene der Laborübung 2)
js/autopnp.js       Automatik: Pick-and-Place, Farbsensor, Farb-Sortierung, Förderband-Sortierung
js/record.js        Aufzeichnung von Messdaten (CSV) und Video (MP4/WebM)
js/view3d.js        3D-Darstellung, Ansichten, Greiferkamera
js/meshes.js        STL-Geometrie des Roboters
js/details.js       Zusatzdetails der 3D-Darstellung (Schrauben, Steuerung, Servokabel)
js/ui.js            Reiter, Werkzeugleiste, HUD, Scope, Tastatur, Farbschema
js/gamepad.js       Steuerung mit PS4-Controller (Gamepad-API)
js/cosim.js         Co-Simulation: WebSocket-Empfang der Simulink-Daten
matlab-cosim/       Web-Blöcke für Simulink (Ersatz der Unreal-Blöcke), Ersetzungs- und Testskript
js/ui-*.js          Inhalte der Reiter und des Panels „Umgebung“ (ui-env.js)
```

Der Stand vor dem Umbau auf V0.1 (mit Arduino- und MATLAB-Teil) liegt außerhalb des Projekts in `../_archiv_BraccioRobotSim/_backup_vor_V0.1/`.
