<img src="public/pwa-192.png" alt="" width="96" height="96">

# Training

PWA mobile-first per seguire al parco la scheda settimanale di calisthenics: timer, contatori,
semaforo del gomito, diario e riepilogo della settimana. Funziona offline dopo il primo
caricamento.

**App:** <https://indjiwr.github.io/Training/>

Stack: React + Vite + TypeScript + [vite-plugin-pwa](https://vite-pwa-org.netlify.app/), validazione
con [zod](https://zod.dev/). Nessun backend: la scheda arriva da Google Drive tramite un piccolo
Google Apps Script.

## In English

**Training** is a mobile-first PWA for following a weekly calisthenics plan at the park, offline
after the first load. It opens on today's workout (Europe/Rome time) and gives every kind of
exercise its own tracker: rep counters, hold timers showing the target band, countdowns, distance
sets to tick off, and one value per attempt for max tests. It also runs the rest timers (beep and
vibration), adapts the day's session to an elbow pain score (green, yellow, red), and keeps a
training diary and a weekly summary ready to paste into the Sunday check-in. The plan is a JSON
file validated with zod. It comes from the user's Google Drive through a small Google Apps Script,
which also stores the logs on Drive so they follow the user across devices; edits made on two
devices are merged three-way on the device. The app has no backend of its own. The interface is in
Italian.

Stack: React 19, TypeScript, Vite, vite-plugin-pwa, zod, Vitest; deployed to GitHub Pages by
GitHub Actions after the tests pass.

**Try it:** open the [app](https://indjiwr.github.io/Training/) and tap **Prova con la scheda di
esempio** ("try the example plan"). The bundled example week is moved onto the current week.

## Schermate

<table>
  <tr>
    <td><img src="docs/screenshots/oggi.png" width="180" alt="Oggi: il giorno della scheda, con il check del gomito prima degli esercizi"></td>
    <td><img src="docs/screenshots/gomito-giallo.png" width="180" alt="Gomito 4/10, giallo: la sessione ridotta e cosa cambia oggi"></td>
    <td><img src="docs/screenshots/timer-tenuta.png" width="180" alt="Timer di tenuta: secondi grandi e fascia obiettivo 30-45 s"></td>
    <td><img src="docs/screenshots/riepilogo.png" width="180" alt="Riepilogo settimana: sessioni fatte, parziali e da fare, con il timer di recupero in basso"></td>
  </tr>
  <tr>
    <td align="center">Oggi</td>
    <td align="center">Sessione adattata al gomito</td>
    <td align="center">Timer di tenuta</td>
    <td align="center">Riepilogo settimana</td>
  </tr>
</table>

## Indice

- [Funzionalità](#funzionalità)
- [Requisiti](#requisiti)
- [Avvio rapido](#avvio-rapido)
- [Script npm](#script-npm)
- [Pubblicazione su GitHub Pages](#pubblicazione-su-github-pages)
- [Installare l'app sul telefono](#installare-lapp-sul-telefono)
- [Scheda da Google Drive (Apps Script)](#scheda-da-google-drive-apps-script)
- [Formato della scheda](#formato-della-scheda)
- [Offline](#offline)
- [Dati e backup](#dati-e-backup)
- [Struttura del progetto](#struttura-del-progetto)
- [Test](#test)
- [Privacy](#privacy)

## Funzionalità

- **Oggi**: apre il giorno della scheda con la data di oggi (fuso `Europe/Rome`) o, se non c'è,
  il prossimo in programma; un selettore porta agli altri giorni. In testa: dove, cosa portare,
  durata e note (compatte durante la sessione). Gli esercizi sono un **carosello orizzontale**, uno
  per schermata nell'ordine della scheda: si scorre con il dito o con le frecce, una barra fissa in
  alto mostra a che punto sei (tocca per l'elenco del giorno e salta a qualsiasi esercizio), e
  finita l'ultima serie si passa da soli al prossimo esercizio da fare. Badge **TEST**, esercizi da
  fare a casa in fondo sotto «A casa», riscaldamenti con l'elenco dei punti.
- **Un controllo per ogni tipo di esercizio**:
  - ripetizioni: contatore +/− per serie, precompilato con il massimo dell'obiettivo;
  - tenute: 3-2-1, poi conteggio in avanti con la fascia obiettivo evidenziata; un tocco ferma e
    salva i secondi;
  - tempo: conto alla rovescia con pausa;
  - distanza: spunta per serie;
  - tentativi/massimali: un valore per tentativo (cronometro per i secondi, numero per cm,
    ripetizioni o dolore 0-10), con il migliore evidenziato;
  - `%max`: ripetizioni calcolate dall'ultimo massimale registrato;
  - esercizi per lato: dx e sx per ogni serie.
- **Recupero**: il timer parte da solo dopo ogni serie, mostra l'intervallo e un pulsante +30″
  quando la scheda prevede un recupero variabile; a fine recupero beep e vibrazione (disattivabili).
  Lo schermo resta acceso durante la sessione (Wake Lock, dove supportato).
- **Semaforo del gomito**: nei giorni con il check del gomito chiede subito un punteggio 0-10 e
  adatta la sessione (verde / giallo / rosso), con banner delle regole e override manuale; la regola
  di stop è sempre visibile.
- **Diario**: per sessione RPE (1-10), dolore al gomito durante (0-10) e note; per ogni giorno,
  riposo compreso, peso al mattino (kg), gomito la mattina dopo (0-10) e ore di sonno; risultati dei
  test.
- **Riepilogo settimana**: testo in italiano pronto per il check-in della domenica (sessioni fatte,
  parziali o saltate con serie fatte/previste, risultati dei test, gomito massimo con semaforo, peso
  e sonno medi, note) con pulsante **Copia**.
- **Video ed Esercizi**: pulsante «Video» su ogni esercizio, che di default apre una ricerca
  YouTube; per ogni esercizio puoi fissare un link YouTube (riprodotto incorporato con youtube-nocookie, anche con
  tempo di inizio) o un'immagine/GIF. La pagina **Esercizi** mostra tutta la libreria con i media
  fissati.
- **Dati su Google Drive**: sessioni, diario e media fissati si salvano da soli nel tuo Drive
  (`training-dati.json`) e si allineano tra i dispositivi collegati, unendo le modifiche fatte su
  ciascuno: non dipendono dal browser.
- **Backup**: esportazione e importazione di tutti i dati in JSON.
- Interfaccia in italiano, pensata per l'uso con una mano: pulsanti grandi, tema scuro ad alto
  contrasto e tema chiaro «Sole» per la luce diretta.

## Requisiti

- [Node.js](https://nodejs.org/) **22.12 o superiore** (con npm).
- Per l'installazione come app e l'offline serve HTTPS (o `localhost`).

## Avvio rapido

```bash
npm ci
npm run dev
```

Apri <http://localhost:5173>. Per provare subito senza Apps Script tocca **Prova con la scheda di
esempio** (oppure, in **Impostazioni**, **Usa scheda di esempio**); per usare una tua scheda,
importa il file da **Impostazioni**.

**Sul telefono, nella stessa rete Wi-Fi:**

```bash
npm run dev -- --host
```

e apri dal telefono l'indirizzo «Network» stampato da Vite (es. `http://192.168.1.20:5173`).

> Il service worker (offline e installazione) esiste solo nella build, non in `npm run dev`:
>
> ```bash
> npm run build && npm run preview -- --host
> ```
>
> Fuori da `localhost` però il browser attiva service worker e Wake Lock solo su **HTTPS**: da un
> indirizzo `http://192.168.…` l'app si usa ma non si installa e non va offline. Il modo più semplice
> per provare la PWA completa sul telefono è [GitHub Pages](#pubblicazione-su-github-pages).

## Script npm

| Comando              | Cosa fa                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `npm run dev`        | Server di sviluppo Vite con ricaricamento a caldo.                        |
| `npm run build`      | Controllo dei tipi (`tsc -b`) e build di produzione in `dist/`, con manifest e service worker. |
| `npm run preview`    | Serve la build di `dist/` in locale (porta 4173).                         |
| `npm test`           | Esegue i test vitest una volta.                                           |
| `npm run test:watch` | Test vitest in modalità watch.                                            |
| `npm run typecheck`  | Solo controllo dei tipi (`tsc -b`).                                       |
| `npm run icons`      | Rigenera icone PWA e favicon in `public/` (`scripts/gen-icons.mjs`, solo Node, nessuna dipendenza). |

## Pubblicazione su GitHub Pages

Repository: [IndjiWR/Training](https://github.com/IndjiWR/Training) → <https://indjiwr.github.io/Training/>

1. Una volta sola: **Settings → Pages → Build and deployment → Source: «GitHub Actions»**.
2. Ogni push su `main` avvia il workflow [`Deploy to GitHub Pages`](.github/workflows/deploy.yml)
   (si può lanciare anche a mano da **Actions → Deploy to GitHub Pages → Run workflow**), che esegue
   `npm ci`, `npm test`, `npm run build` e pubblica `dist/`.

Il workflow compila con `BASE_PATH=/<nome-repo>/` (`/Training/`), ricavato in automatico dal nome
del repository: se lo rinomini, il percorso si aggiorna da solo. L'app usa il routing con hash
(`#/oggi`, `#/esercizi`, …), quindi non serve un `404.html` di fallback.

**Base path configurabile** per altri hosting (default `/`; le barre iniziale e finale vengono
aggiunte se mancano):

```bash
BASE_PATH=/altro/ npm run build
```

```powershell
$env:BASE_PATH='/altro/'; npm run build
Remove-Item Env:BASE_PATH   # la variabile resta nella sessione di PowerShell
```

In Git Bash su Windows usa `MSYS_NO_PATHCONV=1 BASE_PATH=/altro/ npm run build`: senza
`MSYS_NO_PATHCONV=1` la shell trasforma `/altro/` in un percorso Windows.

## Installare l'app sul telefono

Apri <https://indjiwr.github.io/Training/> con la connessione attiva, poi:

- **Android (Chrome)**: menu **⋮ → «Installa app»** (o «Aggiungi a schermata Home»).
- **iPhone (Safari)**: **Condividi → «Aggiungi alla schermata Home»**.

Dopo il primo caricamento l'app funziona anche senza rete. Su iPhone l'app installata ha dati
separati da Safari (e non si apre dai link): collegala a Google Drive dall'app installata con
**«Incolla collegamento»** (vedi sotto; il backup non contiene il collegamento) ed eventualmente
importa il backup. Safari su iPhone non supporta la vibrazione: resta il beep.

Il service worker è in modalità *prompt*: una nuova versione pubblicata non ricarica mai la pagina
da sola, così non interrompe un allenamento in corso.

## Scheda da Google Drive (Apps Script)

Ogni domenica la nuova scheda viene salvata in una cartella di Google Drive come
`scheda-AAAA-MM-GG.json`; la più recente è quella corrente. Lo script
[`apps-script/Code.gs`](apps-script/Code.gs) restituisce come JSON il file più recente della
cartella il cui nome rispetta `^scheda-\d{4}-\d{2}-\d{2}\.json$` (ordinati per nome); senza il
token giusto risponde `{"error":"unauthorized"}`.

Configurazione guidata, una volta sola (dettagli in [`apps-script/README.md`](apps-script/README.md)):

1. **Sul computer** apri l'app → **Impostazioni → «Crea il collegamento dal computer»** e segui i
   passi: *Copia il codice* (lo script con la cartella e un token generato dall'app), *Apri
   script.new*, incolla, esegui la funzione **`setup`** (salva cartella e token nelle *Proprietà
   script* e chiede il permesso di leggere Drive), poi **Esegui il deployment → Nuovo deployment →
   App web** con *Esegui come: Me* e *Chi ha accesso: Chiunque* (*Execute as: Me*, *Who has access:
   Anyone*). Incolla nell'app l'URL che termina con `/exec` e premi **Salva e prova**.
2. Premi **Copia collegamento** (è l'URL `/exec?token=…`) e portalo sull'iPhone: con un Mac e lo
   stesso ID Apple è già negli appunti dell'iPhone (Appunti universali), altrimenti mandalo a te
   stesso (Note, Mail…).
3. **Sull'iPhone**, nell'app installata: **«Incolla collegamento»** (in *Oggi* al primo avvio o in
   *Impostazioni*). La scheda si scarica subito e poi da sola a ogni apertura.

In alternativa resta la strada manuale: proprietà `FOLDER_ID` e `TOKEN` impostate a mano e URL +
token inseriti in **Impostazioni → «Inserisci URL e token a mano»**.

L'app scarica la scheda con una GET semplice, senza header personalizzati (Apps Script non risponde
al preflight CORS), passando il token come parametro `?token=`. Senza endpoint resta sempre
disponibile l'importazione manuale di un file JSON da **Impostazioni** (su iPhone, con l'app Google
Drive installata, il file si sceglie direttamente da Drive: *Sfoglia → Drive*).

Perché non un «Accedi con Google»: senza un server l'app riceverebbe un permesso valido un'ora e
rinnovabile solo con un tocco, dovrebbe chiedere la lettura di tutto il Drive e su iPhone il login a
popup dall'app installata è fragile. Lo script invece scarica la scheda da solo, senza scadenze.

> **Sicurezza**: l'URL dell'endpoint e il token non sono mai nel repository. Vivono solo sul
> dispositivo (localStorage) e sono esclusi dai backup.

## Formato della scheda

Il contratto è [`scheda-corrente.json`](scheda-corrente.json), una scheda reale usata sia come
esempio sia come fixture dei test, descritta dallo schema zod in
[`src/plan/schema.ts`](src/plan/schema.ts) (`schema: 1`). Il formato è dato: è l'app ad adattarsi.

| Campo                | Contenuto                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------- |
| radice               | `schema` (1), `id`, `generated_at` (data/ora ISO), `cycle`, `week`, `title`, `period`, `start`, `end`, `next_checkin`, `goals`, `elbow`, `warmups`, `library`, `days`, `tests` |
| `days[]`             | `date` (ISO), `weekday`, `type` (`TIRATA` \| `SPINTA` \| `GAMBE` \| `RIPOSO`), `title`, `where`, `bring`, `duration`, `note`, `exercises[]` |
| `exercises[]`        | `n`, `key`, `block`, `name`, `dose` (testo da mostrare), `kind` (`reps` \| `hold` \| `time` \| `distance` \| `attempts` \| `max` \| `info`), `sets`/`sets_max`, `target_min`/`target_max`, `unit` (`rep` \| `s` \| `min` \| `m` \| `%max` \| `cm`), `per_side`, `rest` (testo), `rest_s`/`rest_max_s` (`null` = recupero libero), `note`, `test`, `home` |
| `library[key]`       | `label`, `measure` (unità del risultato; `"0-10"` = dolore), `video_query`, `hanging`, `on_yellow` (`skip` \| `halve`) |
| `warmups[key]`       | chiavi `riscaldamento-*`: `title`, `items[]` (`name`, `dose`, `note`)                        |
| `elbow`              | `green_max`, `yellow_max`, `rules` (`green`, `yellow`, `red`, `stop`)                        |
| `tests[]`            | `name`, `unit`, `value`, `when`, `note`                                                     |

Molti campi possono essere `null` o mancare. Se una scheda non rispetta il formato, l'app mostra un
errore chiaro (campo per campo) e continua a usare la scheda già salvata.

**Come la usa l'app**

- **Giorno**: quello con la data di oggi nel fuso `Europe/Rome`; altrimenti il prossimo in
  programma (se la scheda è tutta passata, l'ultimo giorno).
- **Semaforo del gomito** (punteggio 0-10 chiesto prima di tutto nei giorni che contengono
  l'esercizio `check-gomito`):
  - 🟢 **verde** se ≤ `green_max`: sessione invariata;
  - 🟡 **giallo** se ≤ `yellow_max`: gli esercizi con `library.hanging = true` seguono
    `on_yellow`: `skip` li nasconde, `halve` dimezza le serie arrotondando per eccesso;
  - 🔴 **rosso** sopra `yellow_max`: tutti gli esercizi in sospensione sono nascosti.

  Un banner mostra il testo di `elbow.rules` per il livello; il semaforo si può cambiare a mano
  (override) e la regola `stop` è sempre visibile nel dialogo del check. Se la scheda non ha
  `elbow`, valgono le soglie 3 e 5.
- **`%max`**: ripetizioni = round(percentuale × ultimo massimale registrato per la stessa `key`);
  se non c'è ancora un massimale, si vede il testo di `dose`.
- **Scheda più recente**: una scheda scaricata sostituisce quella salvata solo se il suo
  `generated_at` è successivo; in quel caso compare un avviso.
- **Scheda di esempio**: «Prova con la scheda di esempio» (in Impostazioni «Usa scheda di
  esempio») carica `scheda-corrente.json` spostata di settimane intere sulla settimana corrente:
  ogni giorno resta nel suo giorno della settimana e con le date si spostano `id`, `start`, `end`,
  `period`, il prossimo check-in e le date scritte nei testi con il loro giorno («lunedì 5/10»).
  Finché la scheda salvata è l'esempio, segue la settimana in corso, anche riaprendo l'app
  settimane dopo. Le schede scaricate da Drive o importate da file non vengono mai spostate.

## Offline

- Dopo il primo caricamento il service worker mette in cache tutta l'app (HTML, JS, CSS, icone):
  al parco funziona senza segnale.
- L'ultima scheda valida resta salvata sul dispositivo.
- La scheda si aggiorna da sola all'apertura e quando torna la connessione, oltre che con
  **Aggiorna scheda**. Se il download fallisce resta quella in cache.
- Le immagini/GIF fissate vengono conservate in cache dopo la prima visualizzazione; i video
  YouTube richiedono la rete.

## Dati e backup

L'app lavora sui dati salvati nel dispositivo (`localStorage`), così funziona anche senza rete.

**Su Google Drive.** Con il dispositivo collegato a Drive e **«Salva i dati su Google Drive»**
attivo (Impostazioni, acceso di default), sessioni, diario e media fissati vengono salvati anche nel
file `training-dati.json`, nella cartella delle schede, attraverso lo stesso Apps Script. Il
salvataggio è automatico: pochi secondi dopo ogni modifica, prima che l'app vada in secondo piano,
all'apertura, ogni pochi minuti mentre l'app è aperta e quando torna la connessione. Più
dispositivi (iPhone, Mac) restano allineati: se lo stesso giorno cambia su due dispositivi, le
modifiche si **uniscono** (serie registrate, diario e note di entrambi), senza sovrascrivere nulla.
Se Safari cancella i dati del sito o cambi telefono, basta incollare di nuovo il collegamento: i dati
tornano da Drive. Per ripartire da zero: Impostazioni → «Cancella tutti i dati» → «Anche da Google
Drive». Dettagli in [`apps-script/README.md`](apps-script/README.md#dati-dellapp-su-drive).

**Backup manuale.**

- **Esporta** da **Riepilogo** o **Impostazioni**: scarica `training-backup-AAAA-MM-GG.json` con
  tutti i dati, media fissati compresi (ma senza URL dell'endpoint e token).
- **Importa** lo stesso file per ripristinare i dati, ad esempio su un altro telefono; il file
  viene validato prima di sostituire i dati attuali. URL dell'endpoint e token restano quelli già
  configurati sul dispositivo. Con il salvataggio su Drive attivo il backup sostituisce i dati anche
  su Drive e sugli altri dispositivi collegati.

## Struttura del progetto

```text
├── apps-script/          Code.gs e guida al deploy della Web app
├── docs/screenshots/     schermate del README
├── public/               icone PWA e favicon (generate da scripts/gen-icons.mjs)
├── scripts/              gen-icons.mjs: encoder PNG e rasterizzatore in puro Node
├── src/
│   ├── plan/             schema zod della scheda (contratto + validazione)
│   ├── lib/              logica pura: date, gomito, risultati e %max, riepilogo, sync, backup,
│   │                     media, scheda di esempio, suoni/vibrazione, wake lock
│   ├── state/            store su localStorage, azioni, stato UI (avvisi, timer di recupero),
│   │                     sincronizzazione della scheda e dei dati con Drive
│   ├── test/             Code.gs eseguito contro servizi Google simulati (per i test)
│   ├── components/       UI condivisa, icone, timer, esercizi, media, shell e navigazione
│   ├── screens/          Oggi, Esercizi, Riepilogo, Impostazioni
│   └── styles/           token e primitive CSS
├── scheda-corrente.json  scheda reale: esempio e fixture dei test
└── vite.config.ts        Vite + PWA (manifest, service worker, BASE_PATH)
```

## Test

```bash
npm test
```

Test [vitest](https://vitest.dev/) (`src/**/*.test.ts`) che usano `scheda-corrente.json` come
fixture. Coprono: logica del semaforo del gomito, trasformazioni giallo/rosso, calcolo `%max`,
riepilogo settimanale, validazione della scheda, scelta del giorno (fuso `Europe/Rome`), scheda di
esempio sempre sulla settimana corrente, sincronizzazione (URL, errori, scheda più recente),
collegamento (lettura del link incollato, token, `Code.gs` generato con `setup()` eseguito contro
servizi Google simulati), salvataggio dei dati su Drive (unione delle modifiche, conflitti, file
cancellato o ripristinato, `doPost` dello script e scenari con più dispositivi contro lo script
vero), backup e parsing dei link media. Il workflow di deploy esegue i test prima di ogni build.

## Privacy

Il repository è **pubblico**. `scheda-corrente.json` è la scheda reale (con alcuni dati personali
di allenamento), usata come esempio e fixture dei test. Nel repository non ci sono URL
dell'endpoint, token né dati del diario: restano sul dispositivo e, se il salvataggio su Drive è
attivo, nel tuo Google Drive.
