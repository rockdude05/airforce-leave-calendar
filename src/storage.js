// 저장 모듈. UI와 계산 모듈은 localStorage를 직접 만지지 않고 이 모듈만 거친다.
import { STORAGE_KEY, createEmptyState } from './domain/model.js';
import { validateState } from './domain/validation.js';
import { migrateState } from './domain/migrate.js';
import { isDateOnly } from './domain/dates.js';

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const BACKUP_APP_ID = 'airforce-leave-calendar';

const hasErrors = (issues) => issues.some((i) => i.severity === 'error');

/**
 * @param {{getItem(k:string):string|null}} storage
 * @param {string} today
 * 읽는 도중에는 저장하지 않는다. 예전 판 기록은 메모리에서만 최신 판으로 바꾸고, raw는 실제 저장 원문 그대로 둔다.
 * @returns {{kind:'ok'|'empty'|'corrupt'|'future'|'unavailable', state?:any, raw?:string|null, migrated?:boolean, error?:string, issues?:any[]}}
 */
export function loadState(storage, today) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (e) {
    return { kind: 'unavailable', error: describe(e) };
  }
  if (raw === null || raw === undefined) return { kind: 'empty', state: createEmptyState(today), raw: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { kind: 'corrupt', raw, error: '저장된 기록을 읽을 수 없습니다 (JSON 오류).' };
  }
  const m = migrateState(parsed);
  if (!m.ok) {
    const error = m.issues.find((i) => i.severity === 'error').message;
    return { kind: m.future ? 'future' : 'corrupt', raw, error, issues: m.issues };
  }
  return { kind: 'ok', state: m.state, raw, migrated: m.migrated, issues: m.issues };
}

/**
 * 유효한 전체 상태만 저장한다. 실패하면 기존 값은 그대로 남는다.
 * expectedRaw를 주면 저장 직전 값이 그와 같을 때만 쓴다 — 다른 창(홈 화면 앱과 브라우저 탭 등)이
 * 그사이 바꾼 기록을 오래된 화면 상태로 덮어쓰지 않기 위해서다.
 * @param {{getItem?(k:string):string|null, setItem(k:string,v:string):void}} storage
 * @param {any} state
 * @param {{expectedRaw?: string|null}} [opts]
 * @returns {{ok:boolean, raw?:string, error?:string, conflict?:boolean}}
 */
export function saveState(storage, state, { expectedRaw } = {}) {
  const issues = validateState(state);
  if (hasErrors(issues)) {
    return { ok: false, error: `저장하지 않았습니다: ${issues.find((i) => i.severity === 'error').message}` };
  }
  try {
    if (expectedRaw !== undefined && storage.getItem(STORAGE_KEY) !== expectedRaw) {
      return { ok: false, conflict: true, error: '다른 창에서 기록이 바뀌어 저장하지 않았습니다. 최신 기록을 불러왔으니 다시 시도해 주세요.' };
    }
    const raw = JSON.stringify(state);
    storage.setItem(STORAGE_KEY, raw);
    return { ok: true, raw };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

function describe(e) {
  const name = e && typeof e === 'object' && 'name' in e ? String(e.name) : '';
  if (/quota/i.test(name) || /quota/i.test(String(e?.message))) return '기기 저장 공간(quota)이 부족해 저장하지 못했습니다.';
  if (/security/i.test(name) || /security/i.test(String(e?.message))) return '브라우저가 이 사이트의 저장을 막았습니다 (개인정보 보호 모드 등).';
  return '기기 저장소를 사용할 수 없습니다. 브라우저를 다시 열거나 다른 브라우저(Safari·Chrome)에서 열어 주세요.';
}

export function serializeBackup(state, exportedAt = new Date().toISOString()) {
  return `${JSON.stringify({ app: BACKUP_APP_ID, exportedAt, state }, null, 2)}\n`;
}

/**
 * 백업 텍스트를 검증한다. 감싼 형식과 상태 그대로의 형식을 모두 받는다.
 * @param {string} text
 */
export function parseBackup(text) {
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  if (bytes > MAX_BACKUP_BYTES) {
    return { ok: false, issues: [{ code: 'BACKUP_TOO_LARGE', severity: 'error', message: '백업 파일이 2MB를 넘습니다.' }] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ code: 'BACKUP_PARSE', severity: 'error', message: 'JSON 파일이 아니거나 손상되었습니다.' }] };
  }
  const candidate = parsed && typeof parsed === 'object' && parsed.app === BACKUP_APP_ID && 'state' in parsed ? parsed.state : parsed;
  const m = migrateState(candidate);
  if (!m.ok) return m.future ? { ok: false, future: true, issues: m.issues } : { ok: false, issues: m.issues };
  return { ok: true, state: m.state, migrated: m.migrated, fromVersion: m.fromVersion, issues: m.issues, exportedAt: validExportedAt(parsed.exportedAt) };
}

/** 백업 저장 시각은 실제 날짜일 때만 쓴다 — 'undefined' 같은 문자열을 화면에 내지 않기 위해 */
function validExportedAt(v) {
  return typeof v === 'string' && isDateOnly(v.slice(0, 10)) && !Number.isNaN(Date.parse(v)) ? v : null;
}
