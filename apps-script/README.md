# Script Google Apps: la scheda da Google Drive

Questo piccolo script è l'unico "backend" di Training. Pubblicato come **applicazione web**, risponde a
una richiesta `GET …/exec?token=…` restituendo **così com'è** il file più recente della cartella Drive
che si chiama `scheda-AAAA-MM-GG.json` (ordinato per nome: la data nel nome decide qual è il più nuovo).

- [`Code.gs`](./Code.gs): il codice da incollare nell'editor.
- [`appsscript.json`](./appsscript.json): il manifest (fuso orario, permesso Drive in sola lettura,
  impostazioni dell'applicazione web).

L'ID della cartella e il token **non sono nel codice**: si impostano nelle *Proprietà script*.

> **Mai nel repository**: non fare commit, screenshot o issue con l'URL `/exec` o con il token.
> L'app li salva solo sul telefono (Impostazioni) e il backup dei dati non contiene il token.

---

## 1. Crea il progetto

1. Apri <https://script.google.com> con l'account Google che possiede la cartella delle schede e premi
   **Nuovo progetto** (un progetto autonomo, non collegato a un Foglio o a un Documento).
2. In alto a sinistra rinominalo, per esempio `Training – scheda`.
3. Nel file `Code.gs` cancella tutto e incolla il contenuto di [`Code.gs`](./Code.gs).
4. Apri **Impostazioni progetto** (icona a ingranaggio nella barra a sinistra) e spunta
   **Mostra il file manifest "appsscript.json" nell'editor**.
5. Torna all'**Editor** (icona `< >`), apri `appsscript.json`, sostituisci tutto con il contenuto di
   [`appsscript.json`](./appsscript.json) e salva (**Ctrl+S**).

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

## 3. Autorizza e verifica la configurazione

1. Nell'editor, nel menu a tendina delle funzioni in alto scegli **`checkSetup`** e premi **Esegui**.
2. Alla richiesta premi **Rivedi autorizzazioni**, scegli il tuo account. Se compare *"Google non ha
   verificato questa app"* premi **Avanzate → Vai a Training – scheda (non sicuro)**: l'app è la tua.
   Il permesso richiesto è solo *vedere i file di Google Drive* (sola lettura). Premi **Consenti**.
3. Nel **Log di esecuzione** dovresti leggere qualcosa come:

   ```
   TOKEN: impostato (64 caratteri)
   Cartella: <nome della cartella>
   Scheda servita: scheda-2026-10-04.json (JSON valido, modificata …)
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

In Training apri **Impostazioni**, incolla l'**URL `/exec`** e il **token**, poi premi
**Aggiorna scheda**. Da quel momento l'app controlla da sola all'apertura e quando torna la connessione;
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
- **CORS**: l'app usa di proposito una semplice `GET` **senza intestazioni personalizzate** e senza
  corpo. Così il browser non invia la richiesta preliminare (*preflight* `OPTIONS`), a cui Apps Script
  non sa rispondere. Non aggiungere header, `POST` o `Content-Type` alle richieste.
- **Errori interni**: nell'editor apri **Esecuzioni** (icona a elenco a sinistra) per vedere il
  dettaglio. Lo script non restituisce mai il token o l'ID della cartella nei messaggi di errore.

## Sicurezza

- Lo script gira con il tuo account ma con il solo permesso **Drive in sola lettura**, e restituisce
  soltanto l'ultimo file `scheda-*.json` della cartella configurata.
- Il token viene confrontato tramite hash SHA-256, senza uscite anticipate.
- Se il token finisce dove non deve: cambia la proprietà `TOKEN` (effetto immediato) e aggiorna l'app.
- Per spegnere tutto: **Gestisci deployment → Archivia**.
- Ricorda: **mai fare commit dell'URL `/exec` o del token**, nemmeno in file `.env` o nella
  configurazione di GitHub Pages.
