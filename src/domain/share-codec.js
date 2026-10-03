// 일정 공유 코드. 날짜 범위·계획/확정·보낸 기기 번호·만든 날짜만 담는다 (스펙 §코드 형식).
// 문자 집합은 0-9A-Z와 하이픈뿐이라 QR 알파뉴메릭 세그먼트에 들어가고 메신저에서 깨지지 않는다.
// 검출값(CRC-16)은 붙여넣기 오류를 잡는 용도이지 위조 방지가 아니다.
import { isDateOnly, compareDates } from './dates.js';
import { SHARE_ID_RE, SHARE_ITEMS_LIMIT } from './model.js';

export const CODE_VERSION = 'CT1';
/** 붙여넣은 글 전체 상한 (링크·앞뒤 글 포함) */
export const MAX_INPUT_CHARS = 2000;
/** 추출한 코드 상한 — 20건 코드(285자)에 여유를 둔 값 */
export const MAX_CODE_CHARS = 400;

const ITEM_LEN = 13;
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2099-12-31';
/** CT<판>-<번호8>-<YYMMDD>-<13자 항목들>-<검출값4> */
const CODE_RE = /^CT(\d)-([0-9A-Z]{8})-(\d{6})-((?:\d{12}[PC])+)-([0-9A-Z]{4})$/;
const SHARE_MARK_RE = /#s=/gi;

/** 항목 n건 코드의 길이 */
export function codeLength(n) {
  return 25 + ITEM_LEN * n;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, 반사 없음, xorout 0). 입력은 ASCII. */
export function crc16(text) {
  let crc = 0xFFFF;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= (text.charCodeAt(i) & 0xFF) << 8;
    for (let b = 0; b < 8; b += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

const checksum = (body) => crc16(body).toString(36).toUpperCase().padStart(4, '0');

/** 'YYYY-MM-DD'(2000~2099) → 'YYMMDD'. 아니면 RangeError. */
function toShort(date, name) {
  if (!isDateOnly(date) || date < MIN_DATE || date > MAX_DATE) throw new RangeError(`${name} must be a date between 2000 and 2099: ${String(date)}`);
  return `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
}

/** 'YYMMDD' → 'YYYY-MM-DD'. 실제 달력 날짜가 아니면 null. */
function fromShort(s) {
  const d = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return isDateOnly(d) ? d : null;
}

/** 시작일순·비겹침·start≤end 여부 (정렬된 목록 기준) */
function wellOrdered(items) {
  for (let i = 0; i < items.length; i += 1) {
    if (compareDates(items[i].start, items[i].end) > 0) return false;
    if (i > 0 && compareDates(items[i - 1].end, items[i].start) >= 0) return false;
  }
  return true;
}

/**
 * payload → 코드. 입력은 바꾸지 않는다(복사해 정렬).
 * @param {{senderId: string, issuedOn: string, items: {start: string, end: string, confirmed: boolean}[]}} payload
 * @returns {string}
 */
export function encodeShare({ senderId, issuedOn, items }) {
  if (typeof senderId !== 'string' || !SHARE_ID_RE.test(senderId)) throw new RangeError(`invalid senderId: ${String(senderId)}`);
  if (!Array.isArray(items) || items.length < 1 || items.length > SHARE_ITEMS_LIMIT) throw new RangeError(`items must have 1~${SHARE_ITEMS_LIMIT} entries`);
  const sorted = items.map((it) => {
    if (!it || typeof it !== 'object' || typeof it.confirmed !== 'boolean') throw new RangeError('item must have start, end and a boolean confirmed');
    return { start: it.start, end: it.end, confirmed: it.confirmed, s: toShort(it.start, 'start'), e: toShort(it.end, 'end') };
  }).sort((a, b) => compareDates(a.start, b.start));
  if (!wellOrdered(sorted)) throw new RangeError('items must not overlap and each start must be on or before its end');
  const body = `${CODE_VERSION}-${senderId}-${toShort(issuedOn, 'issuedOn')}-${sorted.map((it) => `${it.s}${it.e}${it.confirmed ? 'C' : 'P'}`).join('')}`;
  return `${body}-${checksum(body)}`;
}

/**
 * 코드 → payload. 정규형(대문자·정렬·비겹침)만 받는다.
 * @param {string} code
 * @returns {{ok: true, payload: {senderId: string, issuedOn: string, items: {start: string, end: string, confirmed: boolean}[]}} | {ok: false, reason: 'too-long'|'corrupt'|'unknown-version'}}
 */
export function decodeShare(code) {
  if (typeof code !== 'string') return { ok: false, reason: 'corrupt' };
  if (code.length > MAX_CODE_CHARS) return { ok: false, reason: 'too-long' };
  const m = CODE_RE.exec(code);
  if (!m) return { ok: false, reason: 'corrupt' };
  const [, version, senderId, issued, itemText, crc] = m;
  if (version !== '1') return { ok: false, reason: 'unknown-version' };
  const body = code.slice(0, code.length - 5);
  if (checksum(body) !== crc) return { ok: false, reason: 'corrupt' };
  if (itemText.length / ITEM_LEN > SHARE_ITEMS_LIMIT) return { ok: false, reason: 'corrupt' };
  const issuedOn = fromShort(issued);
  if (!issuedOn) return { ok: false, reason: 'corrupt' };
  const items = [];
  for (let i = 0; i < itemText.length; i += ITEM_LEN) {
    const start = fromShort(itemText.slice(i, i + 6));
    const end = fromShort(itemText.slice(i + 6, i + 12));
    if (!start || !end) return { ok: false, reason: 'corrupt' };
    items.push({ start, end, confirmed: itemText[i + 12] === 'C' });
  }
  if (!wellOrdered(items)) return { ok: false, reason: 'corrupt' };
  return { ok: true, payload: { senderId, issuedOn, items } };
}

/**
 * 붙여넣은 글(코드 또는 링크)에서 코드를 뽑는다. 공백을 모두 지운 뒤 마지막 '#s=' 뒤를 취하므로
 * 링크 앞의 안내문은 허용되지만, 코드 뒤에 공백 아닌 글자가 붙으면 decodeShare가 거절한다.
 * 2000자를 넘으면 손대지 않고 돌려준다(decodeShare가 too-long으로 거절).
 * @param {unknown} text
 * @returns {string}
 */
export function extractCode(text) {
  if (typeof text !== 'string') return '';
  if (text.length > MAX_INPUT_CHARS) return text;
  const compact = text.replace(/\s+/g, '');
  let last = -1;
  for (const hit of compact.matchAll(SHARE_MARK_RE)) last = hit.index + hit[0].length;
  return (last >= 0 ? compact.slice(last) : compact).toUpperCase();
}

/** 앱 주소 + '#s=' + 코드. 조각(#)은 서버로 가지 않는다. */
export function buildShareLink(code, base) {
  return `${base}#s=${code}`;
}
