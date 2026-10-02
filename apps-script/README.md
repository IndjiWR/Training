# Script Google Apps: la scheda da Google Drive

Questo piccolo script è l'unico "backend" di Training. Pubblicato come **applicazione web**:

- risponde a una richiesta `GET …/exec?token=…` restituendo **così com'è** il file più recente della
  cartella Drive che si chiama `scheda-AAAA-MM-GG.json` (ordinato per nome: la data nel nome decide
  qual è il più nuovo);
- risponde a una richiesta `POST …/exec?token=…` salvando i dati dell'app (sessioni, diario, media
  fissati) nel file **`training-dati.json`** della stessa cartella, e restituendo quelli cambiati
  dagli altri dispositivi. Così i dati non dipendono dal browser del telefono (vedi
  [Dati dell'app su Drive](#dati-dellapp-su-drive)).

File:

- [`Code.gs`](./Code.gs): il codice da incollare nell'editor.
- [`appsscript.json`](./appsscript.json): il manifest (fuso orario, permesso Drive, impostazioni
  dell'applicazione web). È facoltativo: senza, Apps Script ricava gli stessi permessi dal codice.

L'ID della cartella e il token **non sono nel codice**: si impostano nelle *Proprietà script*.

> **Mai nel repository**: non fare commit, screenshot o issue con l'URL `/exec` o con il token.
> L'app li salva solo sul telefono (Impostazioni): il backup dei dati non contiene né l'URL né il token.

---

## Strada veloce: configurazione guidata dall'app (consigliata)

Dal **computer** apri Training → **Impostazioni → «Crea il collegamento dal computer»**. La guida ha i
pulsanti per copiare tutto, e il token lo genera l'app (non devi inventarlo né scriverlo):

1. **Copia il codice**: è `Code.gs` con in cima due costanti, `SETUP_FOLDER_ID` (la cartella delle
   schede) e `SETUP_TOKEN`. Il token è un segreto: non condividere quel codice.
2. **Apri script.new** (crea un progetto Apps Script nuovo), seleziona tutto, incolla e salva.
3. Scegli la funzione **`setup`** e premi **Esegui**: salva `FOLDER_ID` e `TOKEN` nelle *Proprietà
   script*, chiede l'autorizzazione (come al punto 3 più sotto), crea `training-dati.json` e controlla
   la cartella. Nel log deve comparire «Pronto». Poi puoi cancellare le due righe `SETUP_*`: i valori
   restano nelle proprietà.
4. Pubblica come applicazione web (punto 4 più sotto) e incolla nella guida l'URL `/exec`, poi
   **Salva e prova**.
5. **Copia collegamento** (l'URL `/exec?token=…`) e sull'iPhone, nell'app installata, tocca
   **«Incolla collegamento»**. Con un Mac e lo stesso ID Apple il collegamento copiato è già negli
   appunti dell'iPhone; altrimenti mandalo a te stesso (Note, Mail…) e copialo da lì. I dati già
   salvati su Drive arrivano da soli.

Su iPhone l'app installata nella schermata Home non si apre dai link e ha dati separati da Safari:
per questo il collegamento si **incolla** nell'app invece di aprirlo.

Le sezioni seguenti descrivono la **configurazione a mano**, utile anche per capire cosa fa la guida.

## 1. Crea il progetto

1. Apri <https://script.google.com> con l'account Google che possiede la cartella delle schede e premi
   **Nuovo progetto** (un progetto autonomo, non collegato a un Foglio o a un Documento).
2. In alto a sinistra rinominalo, per esempio `Training – scheda`.
3. Nel file `Code.gs` cancella tutto e incolla il contenuto di [`Code.gs`](./Code.gs).
4. Facoltativo: apri **Impostazioni progetto** (icona a ingranaggio nella barra a sinistra), spunta
   **Mostra il file manifest "appsscript.json" nell'editor**, torna all'**Editor** (icona `< >`), apri
   `appsscript.json`, sostituisci tutto con il contenuto di [`appsscript.json`](./appsscript.json) e
   salva (**Ctrl+S**). Se un vecchio manifest chiede solo `drive.readonly`, va aggiornato (o tolto):
   lo script deve poter scrivere `training-dati.json`.

## 2. Imposta le proprietà dello script

In **Impostazioni progetto → Proprietà script → Aggiungi proprietà script** crea:

| Proprietà   | Valore                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| `FOLDER_ID` | `1tAj1pJI5127hdcePT1p_hrbIQOgRh7TO` (la cartella delle schede)                    |
| `TOKEN`     | una stringa casuale lunga (almeno 32 caratteri), generata come spiegato sotto     |

L'ID di una cartella è l'ultima parte del suo indirizzo:
`https://drive.google.com/drive/folders/`**`1tAj1pJI5127hdcePT1p_hrbIQOgRh7TO`**.
Da solo non dà accesso a nulla: la cartella resta privata.

Per generare il token (64 caratteri esadecimali, senza simboli da codificare nell'URL):

```powershell
# PowerShell 7+
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

```powershell
# Windows PowerShell 5.1
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

```bash
# bash (Linux, macOS, Git Bash)
openssl rand -hex 32
# senza openssl:
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; echo
```

Tieni il token a portata di mano (per esempio nel gestore di password): servirà nell'app.
Le proprietà si possono cambiare in qualsiasi momento: valgono subito, senza un nuovo deployment.
Lo script aggiunge da solo la proprietà `DATA_REV` (l'ultima revisione scritta di
`training-dati.json`, per accorgersi di un file ripristinato): non modificarla.

## 3. Autorizza e verifica la configurazione

1. Nell'editor, nel menu a tendina delle funzioni in alto scegli **`checkSetup`** e premi **Esegui**
   (con la strada veloce si usa invece **`setup`**, che prima salva le proprietà e poi fa lo stesso
   controllo).
2. Alla richiesta premi **Rivedi autorizzazioni**, scegli il tuo account. Se compare *"Google non ha
   verificato questa app"* premi **Avanzate → Vai a Training – scheda (non sicuro)**: l'app è la tua.
   Google chiede di *vedere, modificare, creare ed eliminare i file di Google Drive*: è il permesso
   minimo con cui uno script può scrivere un file in una cartella che non ha creato lui. Il codice
   legge solo le schede e scrive solo `training-dati.json`, nella cartella `FOLDER_ID`. Premi
   **Consenti**.
3. Nel **Log di esecuzione** dovresti leggere qualcosa come:

   ```
   TOKEN: impostato (64 caratteri)
   Cartella: <nome della cartella>
   Scheda servita: scheda-2026-10-04.json (JSON valido, modificata …)
   Dati dell'app: training-dati.json (0 sessioni, revisione 0)
   ```

   Il token non viene mai scritto nel log.

## 4. Pubblica come applicazione web

1. In alto a destra: **Esegui il deployment → Nuovo deployment**.
2. Accanto a *Seleziona tipo* premi l'ingranaggio e scegli **Applicazione web**.
3. Compila:
   - **Descrizione**: `v1` (a piacere);
   - **Esegui come**: **Me** (il tuo indirizzo) — lo script legge Drive con il tuo account;
   - **Chi può accedere**: **Chiunque** (*Anyone*). Non "Chiunque abbia un account Google": l'app
     scarica la scheda senza login, la protezione è il token.
4. Premi **Esegui il deployment** (se richiesto autorizza di nuovo, come al punto 3).
5. Copia l'**URL dell'applicazione web**: deve terminare con **`/exec`**
   (`https://script.google.com/macros/s/…/exec`). Non usare l'URL che termina con `/dev`: è solo per i
   test dall'editor e richiede il login.

## 5. Prova nel browser

Apri in una finestra in incognito (così sei sicuro che non serva il login):

```
https://script.google.com/macros/s/<ID-DEPLOYMENT>/exec?token=<IL-TUO-TOKEN>
```

Risposte possibili:

| Risposta                                       | Significato                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| il JSON della scheda (`{"schema":1,"id":…}`)   | tutto a posto                                                        |
| `{"error":"unauthorized"}`                     | token mancante o sbagliato, oppure proprietà `TOKEN` non impostata   |
| `{"error":"not_configured"}`                   | manca la proprietà `FOLDER_ID`                                       |
| `{"error":"folder_unavailable"}`               | `FOLDER_ID` sbagliato o cartella non accessibile al tuo account      |
| `{"error":"not_found"}`                        | nessun file `scheda-AAAA-MM-GG.json` nella cartella                  |
| `{"error":"invalid_json","file":"scheda-…"}`   | il file più recente non è un JSON valido                             |
| `{"error":"internal","message":"…"}`           | errore imprevisto: guarda **Esecuzioni** nell'editor                 |
| una pagina di accesso Google (HTML)            | *Chi può accedere* non è "Chiunque", oppure stai usando l'URL `/dev` |

Da terminale: `curl -L "https://script.google.com/macros/s/<ID>/exec?token=<TOKEN>"` (`-L` segue il
reindirizzamento di Google).

## 6. Configura l'app

In Training apri **Impostazioni**: copia l'URL di prova del punto 5 (`…/exec?token=…`) e tocca
**«Incolla collegamento»**, oppure apri **«Inserisci URL e token a mano»** e compila i due campi.
Da quel momento l'app controlla da sola all'apertura e quando torna la connessione;
se arriva una scheda con `generated_at` più recente compare un avviso. Senza rete l'app continua con
l'ultima scheda salvata.

---

## Aggiornare lo script mantenendo lo stesso URL

Le modifiche a `Code.gs` **non** arrivano all'URL `/exec` finché non pubblichi una nuova versione:

1. **Esegui il deployment → Gestisci deployment**;
2. seleziona il deployment esistente e premi la **matita** (Modifica);
3. in **Versione** scegli **Nuova versione** e premi **Esegui il deployment**.

L'URL resta lo stesso. "Nuovo deployment" invece crea un **URL diverso** (andrebbe reinserito nell'app).
Cambiare `TOKEN` o `FOLDER_ID` nelle proprietà non richiede un nuovo deployment.

**Se avevi pubblicato una versione precedente** (per esempio solo la scheda, in sola lettura), nello
**stesso progetto**: incolla il nuovo `Code.gs` (dall'app: Impostazioni → «Crea il collegamento dal
computer» → «Copia il codice», controllando la cartella; la guida ha anche la sezione «Hai già lo
script?»), sostituisci `appsscript.json` se avevi incollato il manifest di sola lettura, esegui
**`setup`** per concedere il permesso di scrittura (oppure `checkSetup`, se hai impostato le proprietà
a mano), poi pubblica una **nuova versione** come sopra. Finché lo script non è aggiornato, l'app lo
segnala in Impostazioni e continua a funzionare con i dati sul telefono.

## Dati dell'app su Drive

Con il dispositivo collegato e **«Salva i dati su Google Drive»** attivo (Impostazioni, di default
acceso), l'app salva **sessioni, diario e media fissati** nel file `training-dati.json`, nella stessa
cartella delle schede. La scheda c'è già su Drive; preferenze, URL e token restano sul dispositivo.

- **Quando**: qualche secondo dopo ogni modifica, prima che l'app passi in secondo piano, all'apertura,
  ogni pochi minuti mentre è aperta e quando torna la connessione. Senza rete i dati restano sul
  telefono e partono appena possibile. Se una risposta si perde (rete che cade, app chiusa subito),
  l'app riconosce poi su Drive il proprio invio e non lo scambia per una modifica fatta altrove.
- **Più dispositivi** (iPhone, Mac…): lo script accetta una modifica solo dal dispositivo che aveva
  già visto l'ultima versione di quel giorno (o media); altrimenti gliela rimanda e il dispositivo
  **unisce** le due versioni e la reinvia. Serie registrate, diario e note di entrambi restano, serie
  per serie; se lo stesso valore (per esempio il peso, o la stessa serie) è cambiato su due
  dispositivi, resta la modifica più recente secondo l'orologio dei dispositivi. Le eliminazioni si
  propagano, ma una modifica non ancora salvata altrove vince sempre su un'eliminazione. Se la scheda
  è cambiata su un dispositivo solo, le serie si abbinano per esercizio, non per posizione.
- **Versioni dell'app diverse**: un giorno salvato da una versione più recente dell'app, che questa
  non sa leggere, non viene mai sovrascritto da qui; dopo l'aggiornamento dell'app viene riscaricato.
- **Nuovo URL dello stesso script** (un nuovo deployment): incollalo pure, i dati restano allineati.
  Un collegamento a un altro file unisce invece i dati del dispositivo con quelli del nuovo file.
- **Telefono nuovo o dati del browser cancellati**: incolla di nuovo il collegamento e i dati tornano
  da Drive.
- **Copie precedenti**: Drive conserva le versioni del file (tasto destro → *Gestisci versioni*). Se
  ripristini una versione precedente o elimini il file, lo script se ne accorge (ricorda l'ultima
  revisione scritta nella proprietà `DATA_REV`) e dà al file una nuova identità: ogni dispositivo ci
  rimette allora i dati che ha, senza perdere quelli del file.
- **Ripartire da zero**: Impostazioni → **«Cancella tutti i dati» → «Anche da Google Drive»**. I dati
  spariscono da Drive e, alla loro prossima sincronizzazione, dagli altri dispositivi collegati.
  (Eliminare solo il file su Drive non basta: i dispositivi ci rimetterebbero i loro dati.)
- Il file non va modificato a mano: se diventa illeggibile lo script non lo sovrascrive e l'app
  mostra un errore finché non lo ripristini.

## Risoluzione dei problemi

- **L'app dice che lo script ha risposto con una pagina web, oppure "Impossibile contattare lo
  script"**: quasi sempre è l'accesso. In *Gestisci deployment* controlla che *Chi può accedere* sia
  **Chiunque** e che l'URL nell'app termini con **`/exec`** (non `/dev`). Quando l'accesso richiede il
  login, Google risponde con la pagina di accesso, che il browser blocca come errore di rete. Se il
  problema resta, verifica la connessione e che il deployment non sia stato archiviato.
- **"Token non valido"** (`unauthorized`): il token nell'app deve essere identico alla proprietà
  `TOKEN` (attenzione a spazi o caratteri persi nel copia-incolla). Se la proprietà manca, la risposta è
  sempre `unauthorized`: esegui `checkSetup` per controllare.
- **"Nessuna scheda nella cartella"** (`not_found`): il nome deve essere esattamente
  `scheda-AAAA-MM-GG.json`, per esempio `scheda-2026-10-04.json`. Non funzionano `scheda 2026-10-04.json`,
  `Scheda-2026-10-04.json`, `scheda-2026-10-04.json.txt` o `Copia di scheda-…`. Il file deve stare
  direttamente nella cartella `FOLDER_ID` (non in una sottocartella) e non nel cestino.
- **`folder_unavailable`**: l'ID della cartella è sbagliato oppure l'account che ha pubblicato lo script
  non può leggerla.
- **`invalid_json`** o **"La scheda non rispetta il formato atteso"**: il file più recente è rotto o non
  segue lo schema 1. L'app mostra il campo sbagliato e **continua con la scheda salvata**; correggi il
  file su Drive e premi di nuovo *Aggiorna scheda*.
- **Ho cambiato `Code.gs` ma non cambia nulla**: serve una nuova versione del deployment (vedi sopra).
- **"Lo script su Google Drive è di una versione precedente e non sa ancora salvare i dati"**: il
  deployment pubblicato non ha il `doPost` di questa versione. Aggiorna lo script come spiegato sopra
  (stesso progetto, nuova versione del deployment).
- **"Lo script non ha il permesso di scrivere su Drive"**: lo script è autorizzato in sola lettura
  (vecchio `appsscript.json`). Aggiorna o togli il manifest, esegui `setup` e pubblica una nuova
  versione.
- **"Il file training-dati.json su Drive è danneggiato"**: ripristina una versione precedente da Drive
  (*Gestisci versioni*) oppure elimina il file: i dispositivi ci rimettono i dati che hanno.
- **CORS**: l'app usa di proposito richieste **senza intestazioni personalizzate**: una `GET` per la
  scheda e una `POST` con il corpo in testo semplice per i dati. Così il browser non invia la richiesta
  preliminare (*preflight* `OPTIONS`), a cui Apps Script non sa rispondere. Non aggiungere header o
  `Content-Type` alle richieste.
- **Errori interni**: nell'editor apri **Esecuzioni** (icona a elenco a sinistra) per vedere il
  dettaglio. Lo script non restituisce mai il token o l'ID della cartella nei messaggi di errore.

## Sicurezza

- Lo script gira con il tuo account. Il permesso Drive gli consentirebbe di toccare tutti i tuoi file,
  ma il codice legge solo l'ultimo `scheda-*.json` della cartella configurata e scrive solo
  `training-dati.json` nella stessa cartella. Chi ha il token può leggere la scheda e i tuoi dati di
  allenamento e salvarne altri: trattalo come una password.
- Due salvataggi contemporanei non si sovrascrivono: lo script li esegue uno alla volta (`LockService`).
- Il token viene confrontato tramite hash SHA-256, senza uscite anticipate.
- Se il token finisce dove non deve: cambia la proprietà `TOKEN` (effetto immediato) e aggiorna l'app.
- Per spegnere tutto: **Gestisci deployment → Archivia**.
- Ricorda: **mai fare commit dell'URL `/exec` o del token**, nemmeno in file `.env` o nella
  configurazione di GitHub Pages.
