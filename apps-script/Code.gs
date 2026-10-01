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
 * Never hardcode them here.
 *
 * The app calls this with a plain GET without custom headers: Apps Script cannot answer a
 * CORS preflight, while simple GETs (and the redirect to googleusercontent.com) work.
 */

const PLAN_FILE_PATTERN = /^scheda-\d{4}-\d{2}-\d{2}\.json$/;

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

/**
 * Run this from the editor (select "checkSetup" -> Esegui) to grant the Drive permission and
 * check the configuration. The log shows which file the web app would serve; never the token.
 */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty('TOKEN') || '').trim();
  const folderId = (props.getProperty('FOLDER_ID') || '').trim();
  console.log(token ? 'TOKEN: impostato (' + token.length + ' caratteri)' : 'TOKEN: MANCANTE');
  if (token && token.length < 24) console.warn('TOKEN troppo corto: usa almeno 32 caratteri casuali.');
  if (!folderId) {
    console.log('FOLDER_ID: MANCANTE');
    return;
  }
  const folder = openFolder_(folderId);
  if (!folder) {
    console.log('FOLDER_ID: cartella non trovata o non accessibile con questo account.');
    return;
  }
  console.log('Cartella: ' + folder.getName());
  const file = findLatestPlan_(folder);
  if (!file) {
    console.log('Nessun file scheda-AAAA-MM-GG.json nella cartella.');
    return;
  }
  let status = 'JSON valido';
  try {
    JSON.parse(readText_(file));
  } catch (parseError) {
    status = 'JSON NON valido';
  }
  console.log('Scheda servita: ' + file.getName() + ' (' + status + ', modificata ' + file.getLastUpdated() + ')');
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
