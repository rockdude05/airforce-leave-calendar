// 순수 날짜 연산. 'YYYY-MM-DD' 문자열을 UTC 정수 일수로 바꿔 계산하므로
// 기기 시간대와 무관하게 하루 밀림이 없다.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** @param {unknown} value @returns {value is string} */
export function isDateOnly(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function assertDate(value, name = 'date') {
  if (!isDateOnly(value)) throw new RangeError(`${name} must be a valid YYYY-MM-DD date: ${String(value)}`);
}

/** @param {string} date @returns {number} days since 1970-01-01 */
export function toDayNumber(date) {
  assertDate(date);
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** @param {number} n @returns {string} */
export function fromDayNumber(n) {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** @returns {number} 시작·종료일 포함 일수 */
export function inclusiveDays(start, end) {
  assertDate(start, 'start');
  assertDate(end, 'end');
  const diff = toDayNumber(end) - toDayNumber(start);
  if (diff < 0) throw new RangeError(`end ${end} is before start ${start}`);
  return diff + 1;
}

export function addDays(date, offset) {
  if (!Number.isInteger(offset)) throw new RangeError('offset must be an integer');
  return fromDayNumber(toDayNumber(date) + offset);
}

/** 문자열 비교로 충분하지만 유효성까지 확인한다. */
export function compareDates(a, b) {
  return toDayNumber(a) - toDayNumber(b);
}

/** start~end 사이(양끝 포함) 여부 */
export function withinRange(date, start, end) {
  return compareDates(date, start) >= 0 && compareDates(date, end) <= 0;
}

/** 대한민국(Asia/Seoul) 기준 오늘 날짜 */
export function seoulToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 달만 더하고(음수 가능) 그 달에 없는 날이면 말일로 당긴다. */
export function addMonthsClamped(date, months) {
  assertDate(date);
  if (!Number.isInteger(months)) throw new RangeError('months must be an integer');
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const targetY = Math.floor(total / 12);
  const targetM = total - targetY * 12; // 0-indexed
  const daysInMonth = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInMonth);
  return `${String(targetY).padStart(4, '0')}-${String(targetM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 0=일요일 */
export function weekday(date) {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7; // 1970-01-01은 목요일
}

/** @param {string} month 'YYYY-MM' */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** 일요일 시작 주 단위의 월간 그리드 */
export function monthGrid(month) {
  const first = `${month}-01`;
  assertDate(first, 'month');
  const next = `${shiftMonth(month, 1)}-01`;
  const start = toDayNumber(first) - weekday(first);
  const lastDay = toDayNumber(next) - 1;
  const end = lastDay + (6 - weekday(fromDayNumber(lastDay)));
  const cells = [];
  for (let n = start; n <= end; n += 1) {
    const date = fromDayNumber(n);
    cells.push({ date, inMonth: date.startsWith(month) });
  }
  return cells;
}

/** 사용자 문구용 날짜: '2026-10-03' → '2026년 10월 3일' */
export function koreanDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}
