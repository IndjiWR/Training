/**
 * Training — web app that serves the current weekly plan from Google Drive.
 *
 * GET <deploy URL>/exec?token=<TOKEN>
 *   -> the newest file of the folder named scheda-YYYY-MM-DD.json, returned as-is (JSON)
 *   -> {"error": "unauthorized" | "not_configured" | "folder_unavailable" | "not_found"}
 *   -> {"error": "invalid_json", "file": "<name>"}  the newest file is not valid JSON
 *   -> {"error": "internal", "message": "..."}
 *
 * Configuration lives only in Script Properties (Project Settings -> Script Properties):
 *   FOLDER_ID  id of the Drive folder that holds the scheda-*.json files
 *   TOKEN      long random shared secret, the same one entered in the app (Impostazioni)
 * Never hardcode them in this file. The app's guided setup (Impostazioni -> "Crea il collegamento
 * dal computer") copies this code with two SETUP_* constants on top: run setup() once and they
 * are stored in the Script Properties.
 *
 * The app calls this with a plain GET without custom headers: Apps Script cannot answer a
 * CORS preflight, while simple GETs (and the redirect to googleusercontent.com) work.
 *
 * POST <deploy URL>/exec?token=<TOKEN>   body {"action":"sync","epoch":..,"since":<rev>,"changes":{...}}
 *   -> saves the app logs (sessions, days, pins) in DATA_FILE, in the same folder. A record is
 *      accepted only if the device had seen its latest version (stored revision <= since);
 *      otherwise it is a conflict: the device merges it with the stored one and sends it again.
 *      Answers {"ok":true,"epoch","rev","reset","accepted","conflicts","records"} with the records
 *      changed after `since`. A deletion is {"deleted":true,"updatedAt":...}.
 *   -> {"error": "unauthorized" | "busy" | "data_corrupt" | "no_write_permission" | ...}
 * The body is sent as text/plain (no preflight either). `epoch` identifies the file: a device
 * synced with another one (file recreated, or restored from Drive's version history) gets
 * `reset` and merges all its data with this file again.
 */

const PLAN_FILE_PATTERN = /^scheda-\d{4}-\d{2}-\d{2}\.json$/;
const DATA_FILE = 'training-dati.json';
const DATA_KINDS = ['sessions', 'days', 'pins'];
const LOCK_WAIT_MS = 20000;
/** Script Property: highest revision written to DATA_FILE (a lower one means a restored file). */
const DATA_REV_PROP = 'DATA_REV';

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const secrets = [];
  try {
    const expected = (props.getProperty('TOKEN') || '').trim();
    const given = e && e.parameter && typeof e.parameter.token === 'string' ? e.parameter.token.trim() : '';
    // Checked first: callers without the token learn nothing about the configuration.
    if (!expected || !given || !safeEquals_(given, expected)) return json_({ error: 'unauthorized' });
    secrets.push(expected);

    const folderId = (props.getProperty('FOLDER_ID') || '').trim();
    if (!folderId) return json_({ error: 'not_configured' });
    secrets.push(folderId);

    const folder = openFolder_(folderId);
    if (!folder) return json_({ error: 'folder_unavailable' });

    const file = findLatestPlan_(folder);
    if (!file) return json_({ error: 'not_found' });

    const name = file.getName();
    const text = readText_(file);
    try {
      JSON.parse(text);
    } catch (parseError) {
      return json_({ error: 'invalid_json', file: name });
    }
    // The file content is served unchanged (no re-serialisation): the format is owned by the file.
    return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error(err);
    return json_({ error: 'internal', message: safeMessage_(err, secrets) });
  }
}

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const secrets = [];
  try {
    const expected = (props.getProperty('TOKEN') || '').trim();
    const given = e && e.parameter && typeof e.parameter.token === 'string' ? e.parameter.token.trim() : '';
    if (!expected || !given || !safeEquals_(given, expected)) return json_({ error: 'unauthorized' });
    secrets.push(expected);

    const folderId = (props.getProperty('FOLDER_ID') || '').trim();
    if (!folderId) return json_({ error: 'not_configured' });
    secrets.push(folderId);

    let request;
    try {
      request = JSON.parse((e.postData && e.postData.contents) || '');
    } catch (parseError) {
      return json_({ error: 'invalid_request' });
    }
    if (!request || request.action !== 'sync') return json_({ error: 'invalid_request' });

    const folder = openFolder_(folderId);
    if (!folder) return json_({ error: 'folder_unavailable' });

    // One sync at a time: two devices saving together must not overwrite each other.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ error: 'busy' });
    try {
      return json_(syncData_(folder, request, props));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return json_({ error: 'internal', message: safeMessage_(err, secrets) });
  }
}

/** Applies the uploaded records to DATA_FILE and returns what the device has not seen yet. */
function syncData_(folder, request, props) {
  const file = findDataFile_(folder);
  let doc;
  let dirty = false;
  if (file) {
    doc = readDataDoc_(file);
    // Never overwrite a file that cannot be read: it may hold everything.
    if (!doc) return { error: 'data_corrupt' };
  } else {
    doc = emptyDataDoc_();
    dirty = true;
  }
  // A file without identity, or older than the last one written (restored from Drive's version
  // history), gets a new identity: every device then merges its own data with it again.
  // Revisions keep growing across identities, so a number is never reused for other records.
  const highWater = Number(props.getProperty(DATA_REV_PROP)) || 0;
  if (!doc.epoch || (Number(doc.rev) || 0) < highWater) {
    doc.epoch = Utilities.getUuid();
    doc.rev = Math.max(Number(doc.rev) || 0, highWater);
    dirty = true;
  }
  // Never below a record's revision (a file edited by hand): devices would conflict forever.
  let storedRev = Number(doc.rev) || 0;
  DATA_KINDS.forEach(function (kind) {
    const stored = doc[kind] && typeof doc[kind] === 'object' ? doc[kind] : {};
    Object.keys(stored).forEach(function (key) {
      storedRev = Math.max(storedRev, Number(stored[key] && stored[key]._rev) || 0);
    });
  });
  const requested = Math.max(0, Number(request.since) || 0);
  const reset = request.epoch !== doc.epoch || requested > storedRev;
  const since = reset ? 0 : requested;

  const rev = storedRev + 1;
  const changes = request.changes && typeof request.changes === 'object' ? request.changes : {};
  const accepted = {};
  const conflicts = {};
  let changed = false;
  DATA_KINDS.forEach(function (kind) {
    accepted[kind] = [];
    conflicts[kind] = [];
    const incoming = changes[kind];
    if (!incoming || typeof incoming !== 'object') return;
    if (!doc[kind] || typeof doc[kind] !== 'object') doc[kind] = {};
    const stored = doc[kind];
    Object.keys(incoming).forEach(function (key) {
      const rec = incoming[key];
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return;
      const current = stored[key];
      // Changed here after the device's last sync: the device merges and sends it again.
      if (current && (Number(current._rev) || 0) > since) {
        conflicts[kind].push(key);
        return;
      }
      rec._rev = rev;
      stored[key] = rec;
      accepted[kind].push(key);
      changed = true;
    });
  });

  doc.rev = changed ? rev : storedRev;
  if (changed || dirty) {
    doc.savedAt = new Date().toISOString();
    const text = JSON.stringify(doc);
    try {
      if (file) file.setContent(text);
      else folder.createFile(DATA_FILE, text, 'application/json');
    } catch (err) {
      if (/permission|authoriz|autorizz/i.test(String((err && err.message) || err))) return { error: 'no_write_permission' };
      throw err;
    }
    props.setProperty(DATA_REV_PROP, String(Math.max(highWater, Number(doc.rev) || 0)));
  }

  const records = {};
  DATA_KINDS.forEach(function (kind) {
    const out = {};
    const stored = doc[kind] || {};
    Object.keys(stored).forEach(function (key) {
      const rec = stored[key];
      if (!rec || (Number(rec._rev) || 0) <= since) return;
      if (accepted[kind].indexOf(key) >= 0) return; // the device's own upload
      out[key] = withoutRev_(rec);
    });
    records[kind] = out;
  });
  return {
    ok: true,
    epoch: doc.epoch,
    rev: Number(doc.rev) || 0,
    reset: reset,
    accepted: accepted,
    conflicts: conflicts,
    records: records,
  };
}

function withoutRev_(rec) {
  const out = {};
  Object.keys(rec).forEach(function (k) {
    if (k !== '_rev') out[k] = rec[k];
  });
  return out;
}

function emptyDataDoc_() {
  return {
    format: 'training-data',
    version: 2,
    epoch: Utilities.getUuid(),
    rev: 0,
    savedAt: null,
    sessions: {},
    days: {},
    pins: {},
  };
}

/** DATA_FILE in the folder (the most recently updated copy if there are several), or null. */
function findDataFile_(folder) {
  const files = folder.getFilesByName(DATA_FILE);
  let best = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
  }
  return best;
}

/** Parsed DATA_FILE, or null when it is not a JSON object. */
function readDataDoc_(file) {
  try {
    const doc = JSON.parse(readText_(file));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  } catch (err) {
    return null;
  }
}

/**
 * First setup, once (select "setup" -> Esegui): saves the SETUP_FOLDER_ID / SETUP_TOKEN constants
 * prepared by the app into the Script Properties, asks for the Drive permission (read the plans,
 * write DATA_FILE) and checks the folder. Without the constants it only explains what to do:
 * nothing is overwritten.
 */
function setup() {
  const folderId = typeof SETUP_FOLDER_ID === 'string' ? SETUP_FOLDER_ID.trim() : '';
  const token = typeof SETUP_TOKEN === 'string' ? SETUP_TOKEN.trim() : '';
  if (!folderId || !token) {
    console.log(
      'Mancano SETUP_FOLDER_ID e SETUP_TOKEN in cima al codice. Copia il codice da Training → ' +
        'Impostazioni → «Crea il collegamento dal computer», oppure imposta FOLDER_ID e TOKEN a mano ' +
        'nelle Proprietà script e usa checkSetup.'
    );
    return;
  }
  PropertiesService.getScriptProperties().setProperties({ FOLDER_ID: folderId, TOKEN: token });
  console.log('Proprietà script salvate (FOLDER_ID e TOKEN).');
  // Creating the data file now checks the write permission here, not at the first sync.
  const folder = openFolder_(folderId);
  if (folder && !findDataFile_(folder)) {
    try {
      folder.createFile(DATA_FILE, JSON.stringify(emptyDataDoc_()), 'application/json');
      console.log('Creato ' + DATA_FILE + ': qui l’app salva sessioni, diario e media fissati.');
    } catch (err) {
      console.warn(
        'Non posso creare ' + DATA_FILE + ' (' + String((err && err.message) || err) + '). ' +
          'Se in appsscript.json c’è "drive.readonly", sostituiscilo con il manifest copiato dall’app ' +
          '(o con "https://www.googleapis.com/auth/drive"), salva ed esegui di nuovo setup.'
      );
    }
  }
  if (checkSetup()) {
    console.log(
      'Pronto. Ora pubblica: Esegui il deployment → Nuovo deployment → Applicazione web ' +
        '(Esegui come: Me · Chi può accedere: Chiunque) e incolla nell’app l’URL che finisce con /exec.'
    );
  }
}

/**
 * Run this from the editor (select "checkSetup" -> Esegui) to grant the Drive permission and
 * check the configuration. The log shows which file the web app would serve; never the token.
 * Returns true when the web app would serve a valid plan.
 */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty('TOKEN') || '').trim();
  const folderId = (props.getProperty('FOLDER_ID') || '').trim();
  console.log(token ? 'TOKEN: impostato (' + token.length + ' caratteri)' : 'TOKEN: MANCANTE');
  if (token && token.length < 24) console.warn('TOKEN troppo corto: usa almeno 32 caratteri casuali.');
  if (!folderId) {
    console.log('FOLDER_ID: MANCANTE');
    return false;
  }
  const folder = openFolder_(folderId);
  if (!folder) {
    console.log('FOLDER_ID: cartella non trovata o non accessibile con questo account.');
    return false;
  }
  console.log('Cartella: ' + folder.getName());
  const file = findLatestPlan_(folder);
  if (!file) {
    console.log('Nessun file scheda-AAAA-MM-GG.json nella cartella.');
    return false;
  }
  let valid = true;
  try {
    JSON.parse(readText_(file));
  } catch (parseError) {
    valid = false;
  }
  const status = valid ? 'JSON valido' : 'JSON NON valido';
  console.log('Scheda servita: ' + file.getName() + ' (' + status + ', modificata ' + file.getLastUpdated() + ')');
  const dataFile = findDataFile_(folder);
  if (!dataFile) {
    console.log('Dati dell’app: ' + DATA_FILE + ' non ancora creato (lo crea «setup» o il primo salvataggio).');
  } else {
    const doc = readDataDoc_(dataFile);
    console.log(
      doc
        ? 'Dati dell’app: ' + DATA_FILE + ' (' + Object.keys(doc.sessions || {}).length + ' sessioni, revisione ' + (doc.rev || 0) + ')'
        : 'Dati dell’app: ' + DATA_FILE + ' NON leggibile (JSON danneggiato).'
    );
  }
  return Boolean(token) && valid;
}

/** Folder by id, or null when the id is wrong or the deploying account cannot read it. */
function openFolder_(folderId) {
  try {
    return DriveApp.getFolderById(folderId);
  } catch (err) {
    return null;
  }
}

/**
 * Newest plan of the folder: the greatest name matching scheda-YYYY-MM-DD.json (the date in the
 * name sorts lexicographically). Trashed files are skipped; on duplicate names the most recently
 * updated copy wins.
 */
function findLatestPlan_(folder) {
  const candidates = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (PLAN_FILE_PATTERN.test(name) && !file.isTrashed()) {
      candidates.push({ file: file, name: name, updated: file.getLastUpdated().getTime() });
    }
  }
  if (!candidates.length) return null;
  candidates.sort(function (a, b) {
    if (a.name !== b.name) return a.name < b.name ? 1 : -1;
    return b.updated - a.updated;
  });
  return candidates[0].file;
}

/** UTF-8 content without a leading byte order mark (JSON.parse rejects it). */
function readText_(file) {
  return file.getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Compares SHA-256 digests byte by byte: no early exit, length-independent. */
function safeEquals_(a, b) {
  const da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  const db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  let diff = da.length ^ db.length;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** Error message for the client: short, with any configured secret masked. */
function safeMessage_(err, secrets) {
  let message = String((err && err.message) || err || 'errore sconosciuto');
  secrets.forEach(function (secret) {
    if (secret) message = message.split(secret).join('***');
  });
  return message.slice(0, 200);
}
