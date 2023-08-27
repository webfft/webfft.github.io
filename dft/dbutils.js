import * as ut from '../utils.js';

export const DB_PREFIX = 'db://';
export const DB_TABLE = 'user_db/audio_files';

let { log, DB } = ut;

export async function fetchAudioFile(file_url) {
  if (file_url.indexOf(DB_PREFIX) == 0) {
    let file_name = file_url.replace(DB_PREFIX, '');
    let db_path = DB_TABLE + '/' + file_name;
    log('Reading from DB:', db_path);
    let blob = await DB.get(db_path);
    ut.dcheck(blob instanceof Blob);
    return blob;
  } else {
    log('Fetching audio file:', file_url);
    let resp = await fetch(file_url);
    return await resp.blob();
  }
}

export async function getUnusedAudioFileName({ prefix = '', suffix = '', min_id = 1 } = {}) {
  let tab = await DB.open(DB_TABLE);
  let keys = await tab.keys();
  let kset = new Set(keys);
  for (let i = min_id; i <= min_id + keys.length; i++)
    if (!kset.has(prefix + i + suffix))
      return prefix + i + suffix;
  ut.dcheck(0);
}
