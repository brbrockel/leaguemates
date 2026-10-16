/**
 * TeeMate: export Golf League attachments from Gmail to a Drive folder.
 *
 * Run in your own Google account at https://script.google.com:
 *   1. New project, paste this file, save.
 *   2. Select `exportGolfLeagueAttachments` and click Run. Approve the permission prompt.
 *   3. If the log says "Paused", click Run again until it says "Done".
 *   4. In Drive, download the "TeeMate Golf League Export" folder (downloads as a zip).
 *
 * Only reads mail. Identical attachments (same bytes) are saved once.
 * Files are named <email date>_<short hash>_<original name>. manifest.csv lists every file saved.
 */

const LABEL = 'Golf League';
const FOLDER_NAME = 'TeeMate Golf League Export';
const EXTENSIONS = ['xlsx', 'xlsm', 'xls', 'csv', 'ods', 'pdf'];
const THREADS_PER_BATCH = 50;
const RUN_BUDGET_MS = 5 * 60 * 1000; // Apps Script stops a run after 6 minutes
const START_KEY = 'teemate_export_start';

function exportGolfLeagueAttachments() {
  const label = GmailApp.getUserLabelByName(LABEL);
  if (!label) throw new Error('Gmail label not found: ' + LABEL);

  const folder = getOrCreateFolder_(FOLDER_NAME);
  const seen = existingHashes_(folder);
  const manifest = getOrCreateManifest_(folder);
  const props = PropertiesService.getUserProperties();
  const tz = Session.getScriptTimeZone();
  const deadline = Date.now() + RUN_BUDGET_MS;

  let start = Number(props.getProperty(START_KEY) || 0);
  let saved = 0;
  const rows = [];

  while (Date.now() < deadline) {
    const threads = label.getThreads(start, THREADS_PER_BATCH);
    if (threads.length === 0) {
      appendManifest_(manifest, rows);
      props.deleteProperty(START_KEY);
      Logger.log('Done. Saved %s new file(s) this run. Folder: %s', saved, folder.getUrl());
      return;
    }

    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        message.getAttachments().forEach(function (att) {
          const name = att.getName();
          const ext = name.split('.').pop().toLowerCase();
          if (EXTENSIONS.indexOf(ext) === -1) return;

          const hash = shortHash_(att.getBytes());
          if (seen[hash]) return;

          const date = Utilities.formatDate(message.getDate(), tz, 'yyyy-MM-dd');
          const fileName = date + '_' + hash + '_' + name;
          folder.createFile(att.copyBlob().setName(fileName));
          seen[hash] = true;
          saved++;
          rows.push([fileName, date, message.getSubject(), message.getFrom(), name, hash]);
        });
      });
    });

    start += threads.length;
    props.setProperty(START_KEY, String(start));
  }

  appendManifest_(manifest, rows);
  Logger.log(
    'Paused after %s thread(s); saved %s file(s) this run. Click Run again to continue.',
    start,
    saved,
  );
}

/** Clears saved progress so the next run starts from the newest thread again. */
function resetExportProgress() {
  PropertiesService.getUserProperties().deleteProperty(START_KEY);
  Logger.log('Progress reset.');
}

function getOrCreateFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function existingHashes_(folder) {
  const seen = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const m = /^\d{4}-\d{2}-\d{2}_([0-9a-f]{12})_/.exec(files.next().getName());
    if (m) seen[m[1]] = true;
  }
  return seen;
}

function getOrCreateManifest_(folder) {
  const it = folder.getFilesByName('manifest.csv');
  if (it.hasNext()) return it.next();
  return folder.createFile(
    'manifest.csv',
    'file,email_date,subject,from,original_name,hash\n',
    MimeType.CSV,
  );
}

function appendManifest_(file, rows) {
  if (rows.length === 0) return;
  const csv = rows
    .map(function (r) {
      return r
        .map(function (v) {
          return '"' + String(v).replace(/"/g, '""') + '"';
        })
        .join(',');
    })
    .join('\n');
  file.setContent(file.getBlob().getDataAsString() + csv + '\n');
}

function shortHash_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .slice(0, 6)
    .map(function (b) {
      return ((b + 256) % 256).toString(16).padStart(2, '0');
    })
    .join('');
}
