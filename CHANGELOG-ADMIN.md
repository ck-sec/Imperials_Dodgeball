# Imperials Social League - Release 12. September 2026

**Fuer Dominik | Gesamtueberblick seit Beginn der Umsetzung**

Hier steht das ganze Paket: das neue Season-2-System, der mobile Mitgliederbereich,
die Website-Ueberarbeitung und die anschliessenden Verbesserungen fuer deinen
Donnerstagsbetrieb. Also nicht nur die letzten Komfort-Aenderungen.

## Update 18. September 2026: Admin-Konten und vereinfachte Teamerstellung

- Das gemeinsame Admin-Passwort wurde vollstaendig entfernt. Der Admin-Bereich
  wird jetzt ueber die normale Mitglieder-Anmeldung freigeschaltet und ist nur
  fuer die fest hinterlegten Konten von **Christoph Kopka** und
  **Dominik Riedl** zugaenglich.
- Die Admin-Berechtigung ist dauerhaft an die unveraenderliche Konto-ID
  gebunden, nicht an den spaeter aenderbaren Anzeigenamen. Bei jeder
  Admin-Sitzungserneuerung wird erneut geprueft, ob das Konto freigeschaltet,
  aktiv und weiterhin als Admin hinterlegt ist. Alte Sitzungen aus der
  Passwort-Anmeldung werden abgewiesen.
- Vor dem Deployment zuerst die neue, additive Migration pruefen und danach
  gezielt auf die richtige Datenbank anwenden:
  `node scripts\migrate-admin-access.js` und anschliessend
  `node scripts\migrate-admin-access.js --apply --expected-host DEIN_DB_HOST`.
  Die Anwendung bricht ohne Aenderung ab, falls fuer einen noch nicht
  zugeordneten Admin kein eindeutig passendes, freigeschaltetes und aktives
  Mitgliedskonto existiert.
- Die Teamerstellung zeigt im normalen Donnerstagsablauf nur noch die
  wesentlichen Schritte: Spieler bestaetigen, Teams automatisch ausgleichen,
  den empfohlenen Spielplan erzeugen und veroeffentlichen.
- Abweichungen bleiben moeglich, ueberladen aber nicht mehr die Standardansicht:
  Gaeste und No-Shows, private Ratings und Profile, manuelle Teamwechsel,
  Platzanzahl, Courts, Timing, Saisonoptionen, Head-Ref-Rollen und die
  vollstaendige Veroeffentlichungspruefung liegen in klar benannten
  **Advanced**-Bereichen.
- Der komplette Fixture-Plan ist vor der Veroeffentlichung eingeklappt.
  Ergebnis-Korrekturen und die Funktion **Last-minute player** bleiben
  unveraendert im Schritt **Results** erhalten.

## Update 17. September 2026: Admin-Sitzung, Mitgliederverwaltung und Statistik

- Aktive Admin-Sitzungen erneuern ihr kurzlebiges Zugriffstoken automatisch
  ueber ein geschuetztes HttpOnly-Cookie. Nach Ablauf der erneuerbaren Sitzung
  wird sauber wieder die Anmeldung gezeigt, statt dass die Oberflaeche mit
  "Invalid token" unbenutzbar bleibt.
- Freigaben und laufende Mitgliederverwaltung sind jetzt getrennte Admin-Tabs.
  In **Member Management** koennen freigeschaltete Konten mit bestehenden
  Social-League-Spielerprofilen beziehungsweise Gastprofilen verknuepft werden.
  Dabei werden vorhandene Identitaeten zusammengefuehrt; gespeicherte Punkte,
  Platzierungen und historische Aufstellungen bleiben erhalten.
- Die Zuordnung zum eingefrorenen Season-1-Archiv kann dort separat gepflegt
  werden.
- Der neue Admin-Tab **Statistics** zeigt Kennzahlen, Punktebalken,
  Platzierungsverteilung, die Leistung aller Spieler und alle abgeschlossenen
  Trainingsergebnisse je Saison. Grundlage sind ausschliesslich finalisierte,
  bereits in der Ergebnis-Ledger gespeicherte Wertungen.
- Jedes Mitglied hat im Portal einen eigenen Tab **Statistik** mit Saisonrang,
  Punkten, Siegquote, Durchschnitts- und Bestplatzierung, Diagrammen und der
  persoenlichen Ergebnis-Historie. Fehlt die Spieler-Verknuepfung, weist der Tab
  sichtbar darauf hin.
- Die persoenliche Statistik zeigt jetzt auch, mit welchen Mitspielern man in
  finalisierten Trainings wie oft im selben Team stand. Im Admin-Statistik-Tab
  kann dieselbe Auswertung fuer jeden Spieler ausgewaehlt werden.
- Kommt jemand nach der Teamfreigabe kurzfristig dazu, kann die Person im
  Admin-Schritt **Results** einem bestehenden Team hinzugefuegt werden.
  Spielplan und bereits gespeicherte Match-Scores bleiben dabei unveraendert.
  Bei einem bereits finalisierten Training ersetzt die Transaktion dessen
  Punkte- und ELO-Ledger einmalig anhand der gespeicherten Platzierungen; Punkte
  werden nicht doppelt addiert.

## Update 14. September 2026: Live-Match-Timer

- Jeder veroeffentlichte Spielplan verlinkt jetzt pro Begegnung eine eigene
  oeffentliche Live-Spieluhr mit Vienna-Imperials-Branding.
- Die Bedienung entspricht dem WDBF-Timer: gemeinsame Start-/Pause-Steuerung
  fuer Match Clock und Set Clock, Zeitkorrekturen, Reset, Standardzeiten und
  Vollbild.
- Alle Bedienelemente bleiben wie beim Referenz-Timer sichtbar. Fuer Zuschauer
  sind sie gesperrt; Head Refs und Admins sehen sie am Spieltag aktiv. Match-
  und Set-Standardzeit koennen jeweils separat uebernommen werden.
- Zuschauen kann jeder. Starten, pausieren und anpassen duerfen nur Admins und
  dauerhaft ernannte Head Refs, und nur am jeweiligen veroeffentlichten
  Donnerstag.
- Im ersten Admin-Schritt koennen bestehende, freigeschaltete Mitgliedskonten
  als permanente Head Refs markiert werden. Dasselbe normale Mitglieder-Login
  erlaubt dann Ergebniseingabe und Timer-Steuerung; ein separates Timer-Konto
  gibt es nicht. Entfernen der Rolle sperrt beide Rechte sofort.
- Der Timer wird serverseitig synchronisiert. Ein zweites Handy oder ein
  Hallendisplay sieht daher denselben Stand. Gleichzeitige Aenderungen werden
  ueber eine eigene Timer-Version abgefangen und ueberschreiben keine
  Ergebniseingaben.
- Vor dem Deployment einmalig die additive Migration ausfuehren:
  `node scripts\migrate-match-timer.js --apply --expected-host DEIN_DB_HOST`.
  Ohne `--apply` laeuft das Skript nur als sicherer Offline-Dry-Run.

## Update 14. September 2026: WhatsApp-Bilder

- Jeder veroeffentlichte oder abgeschlossene Spieltag kann im Match Center als
  einzelnes, hochformatiges **1080 x 1920 JPEG** fuer WhatsApp und Handy
  exportiert werden. Das **Spielplan-Bild** ist schon direkt nach der
  Veroeffentlichung verfuegbar und
  zeigt ohne Ergebnis-Spoiler die Teams, Aufstellungen, Rundenzeiten, Felder,
  Begegnungen und Pausen als Match Tree.
- Nach dem Abschluss steht zusaetzlich ein separates **Ergebnis-Bild** im selben
  Design bereit. Es zeigt alle Endresultate im Match Tree und die Tagestabelle.
- Der Export entsteht direkt im Browser aus denselben oeffentlichen Daten wie
  der Spieltag. Private Ratings, Geschlecht, Rookie-Markierungen, Konto-IDs und
  Rollen werden weder gelesen noch in das Bild geschrieben.
- Auf Geraeten mit Datei-Freigabe kann das bereits erstellte JPEG ueber
  **Bild teilen** direkt an WhatsApp uebergeben werden. Andernfalls wird die
  Datei mit einem WhatsApp-tauglichen Namen heruntergeladen.

## Update 14. September 2026: Ref-Team und fixer Abendablauf

- Neue Aufstellungen bevorzugen fuenf Teams fuer zwei kleine Felder oder drei
  Teams fuer ein grosses Feld. Damit bleibt in jeder Spielrunde mindestens ein
  nicht spielendes Team als klar zugewiesenes Ref-Team frei.
- Zwei Teams sind als bewusster Head-to-Head-Modus ebenfalls moeglich. Weil
  beide Teams gleichzeitig spielen, muss dafuer ein externer Head Ref oder
  Admin pfeifen; Spielplan, Match Center, Timer und Export weisen darauf hin.
- Falls eine bestehende Vierer-Aufstellung verwendet wird, laeuft bewusst nur
  eine Begegnung gleichzeitig: zwei Teams spielen, eines pfeift und eines hat
  Pause. Die Ref-Einsaetze werden ueber den ganzen Abend moeglichst gleichmaessig
  und ohne vermeidbare direkte Wiederholungen verteilt.
- Der gemeinsame Ablauf steht jetzt im Admin, im oeffentlichen Match Center und
  im Spielplan-Bild: **18:00 Treffpunkt und Warm-up**, **18:15 Spielbeginn**,
  **20:00 Spielende** und danach maximal zehn Minuten **Last Man / Last Woman
  Standing** bis **20:10**.
- Die Last-Standing-Auszeichnungen werden vor dem Ergebnisabschluss strukturiert
  ausgewaehlt: Sieger und Siegerin erhalten jeweils **+1 BP**, die beiden
  Zweitplatzierten jeweils **+0,5 BP**. Diese BP fliessen wie alle anderen BP in
  Tages- und Saison-Gesamtpunkte ein.
- Spielplan, Timer und beide WhatsApp-Bilder zeigen das je Runde eingeteilte
  Ref-Team beziehungsweise im Zwei-Team-Modus den externen Head Ref; separate
  Pausenteams werden eindeutig davon unterschieden.
- Ein noch ungewerteter gespeicherter oder bereits veroeffentlichter Spielplan
  kann geloescht werden. Bei einem veroeffentlichten Spieltag werden Teams und
  Aufstellung sofort wieder privat; Timer-Zustaende werden entfernt. Die Teams
  bleiben als Entwurf fuer einen neuen Spielplan erhalten.

## 1. Social League: von der Aufstellung bis zur Saisonwertung

### Mit der ersten Umsetzung dazugekommen

- **Eigenes Season-2-System:** Teilnehmer, Teams, Spielplaene und Ergebnisse
  werden je Training verwaltet. Die neue Saisonwertung ist vom alten
  Season-1-Archiv getrennt.
- **Ausgeglichene Teams:** Die Berechnung beruecksichtigt private Spielstaerke,
  Geschlechterverteilung und die Markierung **Really rookie**. Das Ziel ist eine
  moeglichst faire Verteilung, keine Garantie auf gleich starke Mannschaften.
- **Private Spielerprofile:** Du kannst Geschlechtskategorie, Rookie-Status und
  Start-Rating pflegen. Die Standard-Startwerte sind 1000, fuer Rookies 800.
  Ratings entwickeln sich anhand der Teamplatzierungen weiter; sie sind keine
  oeffentlichen Ranglistenpunkte.
- **Zufaellige Teamnamen:** Beim Erstellen werden Namen vergeben, die du
  anschliessend bearbeiten kannst. Neuladen mischt weder Namen noch Teams neu.
- **Mitglieder und Gaeste gemeinsam:** Trainingszusagen sind der Ausgangspunkt.
  Du kannst Mitglieder ohne Zusage manuell aufnehmen und Gaeste ohne Konto
  anlegen. Gastprofile bleiben fuer spaetere Trainings erhalten und koennen
  spaeter mit einem Mitgliedskonto verknuepft werden. Vorher nach dem Namen suchen,
  damit keine doppelten Profile entstehen.
- **Rotierende Ersatzspieler:** Groessere Kader werden nicht abgeschnitten.
  Alle bleiben einem Team zugeteilt und erhalten dessen Platzierungspunkte.
- **Zwei Wege zum Ergebnis:** Entweder ohne Spielplan die Endplatzierungen
  manuell eintragen oder einen Jeder-gegen-jeden-Spielplan erstellen und die
  Platzierungen aus gespeicherten Match-Ergebnissen berechnen lassen.
- **Bewusste Freigabe und Abschluss:** Entwuerfe bleiben privat. Erst die
  Veroeffentlichung zeigt Teams und Spielplan; erst der Ergebnisabschluss
  verbucht Saisonpunkte und Rating-Aenderungen. Korrekturen bleiben moeglich.

### Mit den anschliessenden Verbesserungen ergaenzt

- **Klarer Admin-Einstieg:** fest auf **Season 2** ausgerichtet, nur
  Donnerstagstermine; der naechste nicht abgesagte Donnerstag ist hervorgehoben.
- **Flexible Feldbesetzung:** **2 bis 6 Spieler auf dem Feld pro Team** oder
  automatische Auswahl. Das ist die Feldbesetzung, nicht die Zahl der Spielfelder.
  Neue Liga-Aufstellungen beginnen ab 6 Teilnehmern und bilden bevorzugt 3 oder
  5 Teams, damit immer ein Ref-Team verfuegbar bleibt. Es gibt hoechstens 5 Teams.
- **Gezielt statt immer neu mischen:** Spieler verschieben, tauschen, entfernen
  und nachtraeglich zuordnen, per Drag-and-drop, Antippen oder Tastatur.
  **Undo last draft change** nimmt die letzte lokale Aufstellungsaenderung
  zurueck. **Save draft** speichert genau deine Verteilung; **Rebalance teams**
  berechnet bewusst neue Zuordnungen.
- **Bonuspunkte fuer Season 2:** je Spieler und Training, mit eigenem BP-Ausweis
  neben den Gesamtpunkten. Die BP sind in **TOTAL/Gesamtpunkten bereits enthalten**.
- **Eigene Seite `/spieltag`:** oeffentliche Spielplaene, Ergebnisse,
  Matchtabelle und Saison-Rangliste; mobile Ergebniseingabe fuer berechtigte
  Personen nach dem Login.
- **Dauerhafte Head-Ref-Rolle:** Ergebnisseingabe kann an freigegebene
  Mitglieder delegiert werden, ohne ihnen Adminrechte zu geben.
- **Wieder eine kompakte Rangliste:** Tabellenansicht wie bei den bisherigen
  Admin-Rankings statt grosser Einzelkarten. Gesamtpunkte, BP, Zuwachs und
  Rangveraenderung bleiben erkennbar; am Handy werden Zusatzwerte platzsparend
  zusammengefasst. Die Homepage startet mit **Season 2 / Saison-Rangliste**.
  Teams, Spielplan, Season 1 und Hall of Fame bleiben erreichbar.
- **Kategorien nicht erraten:** Eine automatische Uebernahme aus Season 1
  verwendet nur eindeutig zuordenbare Archivdaten. Unklare Zuordnungen bleiben
  offen; vorhandene Angaben werden nicht einfach ueberschrieben. Bei der
  bestaetigten Datenpflege wurden **45 eindeutig zugeordnete Profile** ergaenzt:
  **30 maennlich, 15 weiblich**. **3 Profile bleiben ohne Angabe**; diese kannst
  du nach Rueckfrage bewusst ergaenzen.

## 2. Season 1 und Hall of Fame bleiben erhalten

Die alte Rangliste ist als festes **Season-1-Archiv mit 125 Spielern** gesichert
und ueber die Saisonauswahl erreichbar. Sie wird nicht durch Season-2-Ergebnisse
veraendert. Der **Hall-of-Fame-Link bleibt auch bei ausgewaehlter Season 2 sichtbar**.

| Kategorie | Fuehrende im Season-1-Archiv |
|---|---|
| Maenner | Dominik R. **70**, Flo K. **56,5**, Heinrich W. **52** |
| Frauen | Ilvy L. und Magdalena M. **gleichauf mit 58**, danach Silke K. **57** |

Aktuelle Rang- und Punktebewegungen werden nicht auf das eingefrorene Archiv
uebertragen.

## 3. Mitgliederbereich und Anmeldung

Der Mitgliederbereich ist fuer die Bedienung am Handy neu aufgebaut und in
**Training / Liga / Konto** gegliedert. Bestehende Funktionen wie Registrierung,
Kontofreigabe und Trainingszusagen bleiben erhalten, sind aber neu angeordnet.

- **Training:** Termine und eigene Zusagen, Teilnehmeranzeige sowie
  veroeffentlichte Teams und Spielplaene direkt beim Termin. Auch eine manuelle
  Teamzuordnung ohne eigene Zusage wird angezeigt.
- **Liga:** Saison-Rangliste, eigene Punkte, Trainingshistorie und Season-1-Archiv.
  BP sind separat erkennbar, aber schon in der Gesamtsumme enthalten.
- **Konto:** Kontodaten, bestehende E-Mail-Einstellungen und Abmelden.
- **Neu: Passwort vergessen:** Ein Link per E-Mail erlaubt ein neues Passwort.
  Der Link gilt **30 Minuten**, ist **nur einmal verwendbar** und wird durch
  einen neu angeforderten Link ersetzt. Danach bitte neu anmelden; bisherige
  Sitzungen koennen nicht mehr automatisch verlaengert werden.
- **Klareres Sitzungsverhalten:** Abgelaufene Sitzungen fuehren zur erneuten
  Anmeldung. Beim erfolgreichen Abmelden werden lokale Mitgliederdaten geleert;
  verspaetete Antworten laden nicht wieder das vorherige Konto in die Ansicht.
  Schlaegt die Abmeldeanfrage fehl, erscheint ein Fehler statt einer falschen
  Erfolgsmeldung.

**Wichtig fuer Mitglieder:** Sobald Teams veroeffentlicht sind, sind eigene
Aenderungen der Trainingszusage gesperrt. Kurzfristige Aenderungen laufen dann
ueber dich; die Grenzen fuer Aufstellungsaenderungen stehen unten.

## 4. Oeffentliche Website

- **Homepage ueberarbeitet:** der Navy-/Gold-Stil bleibt, Trainingsangebote und
  Einstiege sind klarer. Die Navigation verwendet **Login** und
  **Kontaktiere uns**; auch der Kontaktbereich wurde neu gestaltet.
- **Einheitliche DE/EN-Sprachwahl:** Die Auswahl wird zwischen den eingebundenen
  Seiten und dem Mitgliederbereich beibehalten, statt voneinander unabhaengige
  Sprachschalter zu verwenden.
- **Schriften lokal statt von Google Fonts:** Die betroffenen Seiten laden
  Schriftarten von der eigenen Website. Hinweise zu Schriftarten und Datenschutz
  wurden entsprechend angepasst.
- **Neue Jugendtrainingsseite als HTML:** Informationen fuer **12- bis
  18-Jaehrige**, Trainingsort, Freitagstermin, kostenloses Probetraining und
  Kontaktmoeglichkeit. Kein neues Online-Anmeldeformular auf dieser Seite.
- **Sponsorenmappe zum Herunterladen:** Das bereitgestellte Original-PDF ist im
  Partnerbereich verlinkt. Es wird nicht ungefragt als grosses Dokument eingebettet
  oder beim Seitenaufruf vorgeladen.

## 5. Saisonkalender 2026/27

Der Saisonkalender reicht vom **14. September 2026 bis 2. Juli 2027**
und umfasst **143 Trainingstermine insgesamt**, nicht 143 Ligaspieltage.
Diese Kalendertermine sind im System vorhanden. Zusammen mit zwei bereits
bestehenden Terminen sind es **145 Trainings**; der bestehende Ligaentwurf
bleibt erhalten. Alle Uhrzeiten gelten in Wien.

| Tag | Angebot | Uhrzeit | Ort |
|---|---|---|---|
| Montag | Basic Skill Training | 19:00-21:00 | O-MS Max Winter Platz 12 |
| Donnerstag | Imperials Social League | 18:00-21:00 | Volksschule in der Krieau |
| Freitag | Jugendtraining | 17:00-19:00 | Am Kaisermuehlendamm 2 |
| Freitag | Erwachsenentraining | 19:00-21:00 | Am Kaisermuehlendamm 2 |

Wiener Schulferien, oesterreichische Feiertage und die beruecksichtigten
gesetzlichen schulfreien Tage sind ausgenommen. Unbestaetigte schulautonome
Schliesstage werden **nicht geraten**; zusaetzliche Hallensperren bitte gesondert
pruefen. Kalenderergaenzungen ersetzen keine bestehenden individuellen
Absagen oder Einstellungen.

## 6. Dein Donnerstag in 8 Schritten

1. **Termin oeffnen:** Im Adminbereich zu Social League wechseln und den
   hervorgehobenen beziehungsweise gewuenschten Donnerstag auswaehlen.
2. **Teilnehmer pruefen:** Zusagen kontrollieren, kurzfristige Mitglieder oder
   Gaeste ergaenzen und Ausfaelle aus der Aufstellung nehmen. Rookie-Status und
   private Profile bei Bedarf vor der Teamberechnung pruefen.
3. **Teams erstellen und anpassen:** Feldbesetzung waehlen und einen
   ausgeglichenen Entwurf erzeugen. Danach gezielt verschieben oder tauschen.
   Neue Teilnehmer einem Team zuordnen und **Save draft** verwenden.
   **Rebalance teams** nur waehlen, wenn du wirklich neu verteilen willst.
4. **Spielplan erstellen:** Standard sind **18:00 Treffpunkt**, 15 Minuten
   Warm-up und Ligaspiele ab **18:15** bis spaetestens **20:00**. Fuenf Teams
   nutzen zwei Felder mit einem rotierenden Ref-Team; drei Teams ein Feld.
   Fuer zwei Teams bewusst den Head-to-Head-Modus waehlen und einen externen
   Head Ref oder Admin einteilen. Ein unpassender Zeitplan wird abgelehnt, nicht
   stillschweigend verkuerzt.
5. **Freigeben und Link teilen:** Teams und Spielplan veroeffentlichen und den
   Spieltagslink aus dem Adminbereich teilen. Das geht schon vor dem Training.
   Auch Gastnamen werden damit oeffentlich; Gaeste vorher darauf hinweisen.
6. **Matches werten:** Den normalen Website-Login verwenden und als
   freigeschalteter **Head Ref** den Spieltag oeffnen. Es gibt dort kein
   zusaetzliches Loginformular. Beide Scores eintragen und
   **jedes Match einzeln speichern**. Bereits angemeldete Admins behalten
   ihre Berechtigung zum Werten.
   Ergebnisse sind erst ab dem Trainingstag nach Wiener Datum eintragbar.
   Ab dem ersten gespeicherten Match ist die Aufstellung dauerhaft gesperrt.
7. **BP vergeben:** Im Adminbereich die BP der tatsaechlichen Teilnehmer der
   Aufstellung kontrollieren und speichern. Standard: 0, 0,5 oder 1 BP.
8. **Ergebnisse abschliessen:** Alle Match-Ergebnisse pruefen, gegebenenfalls
   exakte Gleichstaende aufloesen und das Training abschliessen.
   Erst jetzt zaehlen Platzierungspunkte, BP und Rating-Aenderungen zur Wertung.

**Alternative ohne Spielplan:** Schritte 4 und 6 entfallen; nach der
Teamfreigabe traegst du im Adminbereich eindeutige Endplatzierungen ein und
schliesst das Training ab. Ein vorhandener Spielplan muss dagegen vollstaendig
gewertet werden; fehlende Matches lassen sich nicht mit manuellen Plaetzen umgehen.

## 7. Matchpunkte, Saisonpunkte und BP auseinanderhalten

### Matchtabelle: nur fuer die Platzierung an diesem Spieltag

**Sieg = 2 Matchpunkte, Unentschieden = 1, Niederlage = 0.**
Danach entscheiden **Punktedifferenz**, dann **erzielte Punkte**.
Erst wenn auch das gleich ist, legst du im Adminbereich die Reihenfolge zwischen
diesen exakt gleichstehenden Teams fest. Besser platzierte Teams lassen sich
dabei nicht beliebig uebergehen. Matchpunkte sind **keine Saisonpunkte**.

### Saisonwertung: Platzierungspunkte plus persoenliche BP

Die Standardkurve ist **3 / 2,5 / 2 / 1 / 0,5**. Bei weniger Teams wird sie
relativ angepasst und auf halbe Punkte gerundet:

| Teams | Platz 1 | Platz 2 | Platz 3 | Platz 4 | Platz 5 |
|---|---:|---:|---:|---:|---:|
| 2 | 3 | 0,5 | - | - | - |
| 3 | 3 | 2 | 0,5 | - | - |
| 4 | 3 | 2,5 | 1,5 | 0,5 | - |
| 5 | 3 | 2,5 | 2 | 1 | 0,5 |

- Jeder zugeteilte Spieler erhaelt die Platzierungspunkte seines Teams, auch
  rotierende Ersatzspieler. **Alle abgeschlossenen Trainings zaehlen**;
  gleiche Gesamtpunktzahl bedeutet gleichen Saisonrang.
- **BP-Standard:** maximal **1 BP pro Spieler und Training**, in
  **0,5er-Schritten**. Maximum und Schrittweite sind in den Saison-Einstellungen
  anpassbar. Nur Teilnehmer der Aufstellung koennen BP erhalten.
- Beispiel: **2,5 Platzierungspunkte + 0,5 BP = 3 Gesamtpunkte**.
  Den daneben angezeigten BP-Wert **nicht nochmals dazurechnen**.
- Das private Rating/Elo dient nur dem Teamausgleich. **BP haben darauf keinen
  Einfluss.** Ratings, Geschlechtsangaben und Rookie-Markierungen bleiben im
  Adminbereich, nicht in den oeffentlichen Teams.
- Rangpfeile und Punktezuwachs beziehen sich auf das **letzte abgeschlossene
  Training der ausgewaehlten Saison**, mit Datum und Bezeichnung als Bezug.
  Sie zeigen nicht die Aenderung seit deinem letzten Besuch oder Browser-Refresh.

### Farbige Rangstufen bis Diamond

Die kompakten Ranglisten zeigen wieder farbig hinterlegte Badges im bisherigen
Stil. Fuer Season 2 zaehlen die **Gesamtpunkte inklusive BP**, nicht das private
Elo und nicht die aktuelle Tabellenposition:

| Rangstufe | Ab Gesamtpunkten | Teilnahmen bei durchschnittlich 2,5 Punkten |
|---|---:|---:|
| Bronze | 0 | Saisonstart |
| Silver | 10 | 4 |
| Gold | 25 | 10 |
| Platinum | 45 | 18 |
| Diamond | 70 | 28 |

Es sind **35 Donnerstagstermine** eingeplant. Diamond ist beispielsweise mit
28 Teilnahmen und durchschnittlich 2,5 Punkten erreichbar; dabei bleiben sieben
Termine frei. Auch ohne BP geht es: 35 dritte Plaetze bei jeweils fuenf Teams
ergeben 70 Punkte. Das sind Rechenbeispiele zur aktuellen Punktekurve, keine
Erfolgsgarantie; zusaetzliche Absagen oder geaenderte Punkte beeinflussen den Weg.
Die Schwellen stehen unter **Punkte & Rangstufen**. Pro Saison wird neu gezaehlt.
**Season 1 behaelt seine archivierten Rangstufen**, auch wenn die damaligen
Punkte nach den neuen Regeln eine andere Stufe ergeben wuerden.

## 8. Head Ref freischalten

Im ersten Admin-Schritt unter **Account access · Head Refs** ein bestehendes,
freigegebenes und aktives Mitgliedskonto als **Head Ref** markieren.
Die Rolle gilt **dauerhaft fuer alle Donnerstagsspieltage**, bis du sie entziehst;
sie muss nicht jede Woche neu vergeben werden. Gaeste ohne Mitgliedskonto koennen
diese Rolle nicht erhalten.

Head Refs nutzen ihren normalen Mitglieder-Login und duerfen Match-Ergebnisse
speichern beziehungsweise korrigieren, solange die Ergebnisse offen sind. Am
veroeffentlichten Spieltag duerfen sie mit demselben Login auch die jeweilige
Live-Spieluhr bedienen. Der Login fuehrt direkt zum zuvor ausgewaehlten Spieltag
oder Timer zurueck. Wer bereits angemeldet ist, braucht keine weitere Anmeldung.
Sie duerfen **keine Teams, Teilnehmer, BP, Saisonregeln oder Rollen bearbeiten**
und **weder Trainings abschliessen noch abgeschlossene Ergebnisse wieder oeffnen**.
Zuschauer brauchen auf der Spieltagsseite keinen Login.

## 9. Aenderungen und typische Stolperfallen

- **Entfernen betrifft nur die Aufstellung:** Weder Mitgliedskonto noch
  Spielerprofil noch Trainingszusage werden dadurch geloescht.
- **Zusagen haben sich waehrend der Vorbereitung geaendert?** Aktuelle
  Teilnehmer pruefen und den Entwurf bewusst speichern. Manuelle Teilnehmer und
  Gaeste werden nicht automatisch durch eine neue Zusagenliste ersetzt;
  ein Neu-Ausgleich ist dafuer nicht erforderlich.
- **Schon freigegeben, noch kein Match gespeichert?** Mit **Edit lineup**
  voruebergehend zur privaten Aufstellung zurueckkehren. Das blendet die
  oeffentlichen Teams aus. Gespeicherte Aufstellungsaenderungen loeschen einen
  vorhandenen, ungewerteten Spielplan; danach neu erstellen und wieder freigeben.
- **Nur den Spielplan ersetzen?** Mit **Delete published schedule** den
  ungewerteten Spielplan samt Timer-Zustaenden loeschen. Der Spieltag wird
  sofort privat, Teams und Aufstellung bleiben als Entwurf erhalten. Danach
  neuen Spielplan erstellen und erneut freigeben.
- **Ab dem ersten gespeicherten Match bleibt die Aufstellung dauerhaft gesperrt.**
  Auch nach dem Abschluss oder einem Wiedereroeffnen werden Teams und
  Teilnehmer nicht wieder bearbeitbar.
- **Training bereits abgeschlossen?** Mit **Reopen results** wieder oeffnen,
  Scores, zulaessige Platzierungen oder BP korrigieren und erneut abschliessen.
  Die bisherigen Punkte und Rating-Beitraege dieses Trainings werden bis dahin
  aus der Wertung entfernt. Der erneute Abschluss ersetzt sie, statt doppelt zu
  zaehlen; die uebrigen Trainings bleiben gewertet.
- **Saisonregeln wirken nicht rueckwirkend:** Bestehende Trainings behalten ihre
  gespeicherten Regeln und Rating-Grundlagen. Ein noch bearbeitbarer Entwurf muss
  neu generiert werden, um neue Standardwerte zu uebernehmen; **Save draft allein
  uebernimmt keine neuen Saisonregeln**.
- **Trainingstermine und Historie sind geschuetzt:** Vergangene Termine werden
  beim Laden nicht mehr automatisch geloescht. Termine mit einem Ligaereignis
  koennen nicht geloescht werden. Veroeffentlichte Ligatermine lassen sich nicht
  einfach verschieben oder absagen; zuerst muss die Freigabe zurueckgenommen
  werden, soweit das noch erlaubt ist.
- **Mehrere Personen werten gleichzeitig:** Die Spieltagsseite fragt etwa alle
  **15 Sekunden** nach Aktualisierungen. Nicht gespeicherte Eingaben bleiben
  dabei im offenen Formular erhalten, werden aber nicht automatisch gespeichert.
  Bei einem Konflikt erst aktuelle Scores laden und vergleichen, dann bewusst
  den gespeicherten Stand uebernehmen oder die eigenen Eingaben erneut speichern.
- **Sitzung waehrend der Eingabe abgelaufen?** Den Anmeldelink am Spieltag
  verwenden. Nach der Rueckkehr werden lokale Eingaben wiederhergestellt und
  muessen vor dem Speichern bewusst geprueft werden. Blockiert der Browser die
  Zwischenspeicherung, den angebotenen Login in einem neuen Tab oeffnen und den
  urspruenglichen Tab mit den Eingaben offen lassen.
- **Spielpaarung hat sich geaendert?** Eine alte Eingabe wird nicht einfach auf
  die neue Paarung uebertragen. Erst die aktualisierte Paarung anzeigen lassen
  und das Ergebnis dafuer neu pruefen. Ungespeicherte Formulare sind kein Ersatz
  fuer Speichern und keine Zusage, dass Eingaben ein Schliessen der Seite ueberleben.

## 10. Technische SEO-Grundlagen

- Die Sitemap enthaelt nur kanonische, indexierbare Inhaltsseiten. Der
  Mitglieder-Login mit bestehendem `noindex` wurde daraus entfernt; die
  Aenderungsdaten entsprechen den aktuellen Seiten.
- Such- und Linkvorschauen sind auf Deutsch klarer formuliert. Vereinsstartseite,
  Trainings-/Regelseite und Jugendangebot haben unterschiedliche Schwerpunkte.
- Die Jugendseite hat vollstaendige Social-Preview-Angaben. Die Vereinsdaten in
  den strukturierten Daten verwenden eine gemeinsame, stabile Club-Kennung.
- Irrefuehrende Sprachverweise auf dieselbe URL wurden entfernt. DE/EN bleibt
  bedienbar; echte separat indexierbare englische URLs sind damit nicht umgesetzt.
- Keine neue Ligaseite, keine geaenderten Loginablaeufe und keine neuen Tracker.
  Suchmaschinen entscheiden selbst ueber Indexierung und Rankings; ein
  Rankinganstieg oder neue Rich Results sind nicht garantiert.

## Direkte Einstiege

[Adminbereich](https://www.imperialsdodgeball.com/admin) |
[Spieltag](https://www.imperialsdodgeball.com/spieltag) |
[Mitglieder-Login](https://www.imperialsdodgeball.com/member) |
[Jugendtraining](https://www.imperialsdodgeball.com/jugendtraining-wien)
