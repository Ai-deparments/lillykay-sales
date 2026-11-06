/* Nutq → matn: Whisper shovqinda to‘qib chiqaradigan iboralar matn deb olinmaydi */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Boshqa testlardagidek vaqtinchalik baza: stt.js bazani ochadi — loyiha papkasidagi data/ ga yozilmasin
const dir = mkdtempSync(join(tmpdir(), 'sales-stt-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });
after(() => rmSync(dir, { recursive: true, force: true }));
const { cleanTranscript } = await import('../src/services/stt.js');
test('Whisper «gallyutsinatsiyasi» tashlanadi, haqiqiy matn qoladi', () => {
  assert.equal(cleanTranscript(' Продолжение следует... '), '');
  assert.equal(cleanTranscript('Субтитры сделал DimaTorzok'), '');
  assert.equal(cleanTranscript('[Music]'), '');
  assert.equal(cleanTranscript('  Салом, микрофон  нархи қанча? '), 'Салом, микрофон нархи қанча?');
});
