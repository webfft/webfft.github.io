import * as ut from '../utils.js';
import * as db from './dbutils.js';

let { DB_PREFIX, DB_TABLE } = db;
let { $, $$, $$$, log, showStatus } = ut;

window.onload = () => {
  ut.setUncaughtErrorHandlers();
  $('#cards').append(createOpenFileCard());
  $('#cards').append(createAudioRecordCard());
  showSampleSounds();
  showUserSounds();
};

async function showSampleSounds() {
  let list_file = await fetch('ogg/list.txt');
  let list_text = await list_file.text();
  let file_names = list_text.split('\n').filter(s => !!s);
  if (!file_names.length) return;
  await showStatus(['Loading', file_names.length, 'sample sounds']);
  for (let file_name of file_names)
    await showAudioCard('ogg/' + file_name);
  await showStatus('');
}

async function showUserSounds() {
  let file_names = await ut.DB.open(DB_TABLE).keys();
  if (!file_names.length) return;
  await showStatus(['Loading', file_names.length, 'user sounds']);
  for (let file_name of file_names)
    await showAudioCard(DB_PREFIX + file_name);
  await showStatus('');
}

async function showAudioCard(file_url) {
  let file_name = file_url.replace(DB_PREFIX, '');
  let first_card = $('#cards > .audio');
  let card = createCard(file_name);
  let card_title = card.querySelector('.title');
  let card_img = card.querySelector('.img');

  try {
    let blob = await db.fetchAudioFile(file_url);
    log('Drawing spectrogram:', blob.name, blob.size, blob.type);
    let canvas = $$$('canvas', { width: 128, height: 128 })
    await ut.drawSpectrogramFromFile(canvas, blob,
      { num_frames: 256, num_freqs: 0.99, frame_width: 1024, frame_size: 2048, x2_mul: s => 1.5 * s ** 0.5, disk: true });
    let size_kb = (blob.size / 1024).toFixed(1) + ' KB';
    card_title.textContent = size_kb + ' ' + file_name;
    card_img.append($$$('a', { href: '/dft?a=' + file_url }, [canvas]));
    card.classList.add('audio');
    $('#cards').insertBefore(card, first_card);
  } catch (err) {
    card_title = file_name + ': ' + err;
    console.error(err);
  }
}

function createAudioRecordCard() {
  let stop_recording = null;

  return createIconCard('pic/record.png', 'Record', async (card) => {
    if (stop_recording) {
      stop_recording();
      stop_recording = null;
      return;
    }

    let img = card.querySelector('img');
    let label = card.querySelector('.label');
    let label_text = label.textContent;
    label.textContent = 'Stop';
    img.style.filter = 'hue-rotate(180deg)';

    try {
      let max_duration = new Promise(resolve => stop_recording = resolve);
      let blob = await ut.recordAudio({ max_duration });
      let name = await db.getUnusedAudioFileName({ prefix: 'rec', suffix: '.wav' });
      let file = new File([blob], name);
      await saveUserAudio(file);
    } finally {
      label.textContent = label_text;
      img.style.filter = '';
    }
  });
}

function createOpenFileCard() {
  return createIconCard('pic/open.png', 'Open', async () => {
    let blob = await ut.selectAudioFile();
    await saveUserAudio(blob);
  });
}

async function saveUserAudio(blob) {
  if (!blob) return;
  let size_kb = (blob.size / 1024).toFixed(1) + ' KB';
  await ut.showStatus('Saving audio file to local DB: ' + size_kb);
  let db_path = DB_TABLE + '/' + blob.name;
  log('Writing to DB:', db_path, blob.type, blob.size);
  await ut.DB.set(db_path, blob);
  await showStatus('Drawing spectrogram: ' + blob.name);
  await showAudioCard(DB_PREFIX + blob.name);
  await showStatus('');
}

function createIconCard(img_url, text, onclick) {
  let card = createCard('');
  let img = card.querySelector('.img');
  img.onclick = () => onclick(card);
  img.append(
    $$$('img', { src: img_url, style: 'cursor:pointer' }),
    $$$('div', { class: 'label' }, text));
  return card;
}

function createCard(title) {
  return $$$('div', { class: 'card' }, [
    $$$('div', { class: 'img' }),
    $$$('div', { class: 'title' }, title),
  ]);
}
