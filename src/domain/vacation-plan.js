// 휴가 계획서: 출타 동안 할 일과 기본 정보. 이 기기에만 저장하며 공유 코드·가족 문장에는 넣지 않는다.
import { isDateOnly, addDays, compareDates } from './dates.js';
import { tripDates } from './model.js';

/** 백업 2MB 복원 한도 안에 들도록 일정 하나당 크기를 묶는다 (2026-10-10 Codex 검토). */
export const PLAN_LIMITS = Object.freeze({
  destination: 40, contact: 40, companions: 40, route: 80, memo: 300, text: 50, place: 30, items: 60,
});
const PLAN_KEYS = ['destination', 'contact', 'companions', 'route', 'memo', 'items'];
const ITEM_KEYS = ['id', 'date', 'time', 'text', 'place', 'done'];
const TEXT_FIELDS = ['destination', 'contact', 'companions', 'route', 'memo'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const isPlanTime = (v) => typeof v === 'string' && TIME_RE.test(v);

export function emptyPlan() {
  return { destination: '', contact: '', companions: '', route: '', memo: '', items: [] };
}

function exactKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

/** null(작성 안 함) 또는 계획서. 기간 밖 날짜는 오류가 아니다 — 일정 날짜를 바꿔도 계획은 남긴다. */
export function validatePlan(plan) {
  if (plan === null) return [];
  const invalid = (message = '휴가 계획서 형식이 올바르지 않습니다.') => [{ code: 'TRIP_PLAN', severity: 'error', message }];
  if (!exactKeys(plan, PLAN_KEYS) || !Array.isArray(plan.items)) return invalid();
  for (const k of TEXT_FIELDS) {
    if (typeof plan[k] !== 'string' || plan[k].length > PLAN_LIMITS[k]) return invalid(`휴가 계획서의 글자 수가 한도를 넘었습니다 (${PLAN_LIMITS[k]}자).`);
  }
  if (plan.items.length > PLAN_LIMITS.items) return invalid(`할 일은 일정 하나에 ${PLAN_LIMITS.items}개까지 적을 수 있습니다.`);
  const ids = new Set();
  for (const it of plan.items) {
    if (!exactKeys(it, ITEM_KEYS)) return invalid();
    if (typeof it.id !== 'string' || !ITEM_ID_RE.test(it.id) || it.id === '__proto__' || ids.has(it.id)) return invalid();
    ids.add(it.id);
    if (it.date !== null && !isDateOnly(it.date)) return invalid();
    if (it.time !== null && !isPlanTime(it.time)) return invalid();
    if (typeof it.text !== 'string' || !it.text.trim() || it.text.length > PLAN_LIMITS.text) return invalid(`할 일은 1~${PLAN_LIMITS.text}자로 적어 주세요.`);
    if (typeof it.place !== 'string' || it.place.length > PLAN_LIMITS.place) return invalid(`장소는 ${PLAN_LIMITS.place}자 이하로 적어 주세요.`);
    if (typeof it.done !== 'boolean') return invalid();
  }
  return [];
}

/** 화면 초안 → 저장 형태. 글자 앞뒤 공백을 지우고, 아무것도 없으면 null로 둔다. */
export function normalizePlan(plan) {
  if (!plan) return null;
  const next = {
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(plan[k] ?? '').trim()])),
    items: sortPlanItems(plan.items.map((it) => ({ id: it.id, date: it.date ?? null, time: it.time || null, text: String(it.text).trim(), place: String(it.place ?? '').trim(), done: it.done === true }))),
  };
  return isPlanEmpty(next) ? null : next;
}

export function isPlanEmpty(plan) {
  return !plan || (TEXT_FIELDS.every((k) => !plan[k]) && plan.items.length === 0);
}

/** 날짜순(미정은 끝) → 시간 있는 것 먼저 시간순 → 입력 순서 */
export function sortPlanItems(items) {
  return items.map((it, i) => ({ it, i })).sort((a, b) => {
    const da = a.it.date ?? '9999-99-99';
    const db = b.it.date ?? '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    if (a.it.time !== b.it.time) {
      if (a.it.time === null) return 1;
      if (b.it.time === null) return -1;
      return a.it.time < b.it.time ? -1 : 1;
    }
    return a.i - b.i;
  }).map((x) => x.it);
}

/** 일정의 모든 날짜 (구간은 이어져 있으므로 첫날~끝날). 날짜가 깨졌으면 빈 배열. */
export function planDays(trip) {
  const { start, end } = tripDates(trip);
  if (!isDateOnly(start) || !isDateOnly(end) || compareDates(start, end) > 0) return [];
  const out = [];
  for (let d = start; compareDates(d, end) <= 0 && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 계획서 화면의 묶음: 날짜별(일정 기간) · 날짜 미정 · 기간 밖 */
export function groupPlanItems(trip, items) {
  const days = planDays(trip);
  const inRange = new Set(days);
  const sorted = sortPlanItems(items);
  return {
    days: days.map((date) => ({ date, items: sorted.filter((it) => it.date === date) })),
    undated: sorted.filter((it) => it.date === null),
    outside: sorted.filter((it) => it.date !== null && !inRange.has(it.date)),
  };
}

/** 카드·편집기에 쓰는 짧은 요약 */
export function planSummary(trip) {
  const plan = trip.plan;
  const days = planDays(trip);
  if (!plan) return { written: false, items: 0, done: 0, plannedDays: 0, totalDays: days.length };
  const dated = new Set(plan.items.map((it) => it.date).filter((d) => d && days.includes(d)));
  return {
    written: true,
    items: plan.items.length,
    done: plan.items.filter((it) => it.done).length,
    plannedDays: dated.size,
    totalDays: days.length,
  };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** 복사용 글. 휴가계획서 양식에 옮겨 적거나 메모에 붙여넣는 용도. */
export function planText(trip, plan = trip.plan) {
  const { start, end } = tripDates(trip);
  const days = planDays(trip);
  const lines = [`[휴가 계획서] ${trip.title}`];
  if (start && end) lines.push(`기간: ${dayLabel(start)}${start === end ? '' : ` ~ ${dayLabel(end)}`}${days.length ? ` · ${days.length}일` : ''}`);
  const p = plan ?? emptyPlan();
  const info = [['행선지', p.destination], ['비상 연락처', p.contact], ['동행', p.companions], ['이동', p.route]].filter(([, v]) => v && v.trim());
  if (info.length) { lines.push(''); for (const [k, v] of info) lines.push(`${k}: ${v.trim()}`); }
  const groups = groupPlanItems(trip, p.items);
  const itemLine = (it) => `${it.done ? '☑' : '□'} ${it.time ? `${it.time} ` : ''}${it.text.trim()}${it.place.trim() ? ` @${it.place.trim()}` : ''}`;
  groups.days.forEach((g, i) => {
    if (!g.items.length) return;
    lines.push('', `${i + 1}일차 ${dayLabel(g.date)}`, ...g.items.map(itemLine));
  });
  if (groups.undated.length) lines.push('', '날짜 미정', ...groups.undated.map(itemLine));
  if (groups.outside.length) lines.push('', '일정 기간 밖', ...groups.outside.map((it) => `${dayLabel(it.date)} ${itemLine(it)}`));
  if (p.memo.trim()) lines.push('', '메모', p.memo.trim());
  return `${lines.join('\n')}\n`;
}
