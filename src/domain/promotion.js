// 정기휴가 자동 지급 계획. 순수 함수 — 저장하지 않는다. (2026-10-03 사용자 승인, Codex 협의)
// 앞으로 진급할 계급만 진급일부터 쓸 수 있게 넣고, 진급일이 바뀌면 연동 중인 휴가의 시작일만 옮긴다.
import { compareDates } from './dates.js';
import { GRANT_KIND_LABELS, REGULAR_GUIDE, PROMOTION_KINDS } from './model.js';
import { computeSchedule } from './service.js';

const RANK = { 'regular-private-first': '일병', 'regular-corporal': '상병', 'regular-sergeant': '병장' };
const DATE_KEY = { 'regular-private-first': 'privateFirst', 'regular-corporal': 'corporal', 'regular-sergeant': 'sergeant' };
const EDIT_FIELDS = ['amount', 'availableFrom', 'expiresOn', 'balanceAsOf', 'kind'];

const valuesOf = (g) => (g ? { availableFrom: g.availableFrom, amount: g.amount } : null);

/**
 * 복무 정보를 저장할 때 정기휴가를 어떻게 넣고 옮길지 계산한다. 화면 미리보기와 저장이 같은 결과(rows)를 쓴다.
 * action: add(새로 넣음) · move(시작일 이동) · keep(연동 중, 변화 없음) · unlink(진급일이 지나 연동 멈춤)
 *         past(이미 진급 — 직접 입력) · manual(같은 종류를 직접 넣어 둠) · fixed(연동 멈춘 휴가) · suppressed(지운 휴가) · none(복무 정보 없음)
 * planned = 저장 후 자동 휴가 값(add/move/keep), current = 그대로 두는 실제 휴가 값(manual/unlink/fixed).
 * @param {{grants:any[], promotionGrants:Record<string, any>}} state
 * @param {any} service
 * @param {{today:string, newId:(prefix:string)=>string}} opts
 */
export function planPromotionGrants(state, service, { today, newId }) {
  if (!service) {
    return { grants: state.grants, promotionGrants: state.promotionGrants,
      rows: PROMOTION_KINDS.map((kind) => ({ kind, rank: RANK[kind], promotionDate: null, action: 'none', planned: null, current: null })) };
  }
  const schedule = computeSchedule(service, today);
  let grants = state.grants;
  const promotionGrants = { ...state.promotionGrants };
  const rows = PROMOTION_KINDS.map((kind) => {
    const date = schedule[DATE_KEY[kind]];
    const future = compareDates(date, today) > 0;
    const entry = state.promotionGrants[kind];
    const base = { kind, rank: RANK[kind], promotionDate: date, planned: null, current: null };
    if (entry === null) {
      const manual = grants.find((g) => g.kind === kind);
      if (manual) return { ...base, action: 'manual', current: valuesOf(manual) };
      if (!future) return { ...base, action: 'past' };
      const g = { id: newId('g'), kind, label: GRANT_KIND_LABELS[kind], amount: REGULAR_GUIDE[kind], balanceAsOf: today, availableFrom: date, expiresOn: null };
      grants = [...grants, g];
      promotionGrants[kind] = { grantId: g.id, status: 'managed' };
      return { ...base, action: 'add', planned: valuesOf(g) };
    }
    if (entry.status === 'suppressed') return { ...base, action: 'suppressed' };
    const g = grants.find((x) => x.id === entry.grantId);
    if (entry.status === 'fixed') return { ...base, action: 'fixed', current: valuesOf(g) };
    if (!future) {
      promotionGrants[kind] = { ...entry, status: 'fixed' };
      return { ...base, action: 'unlink', current: valuesOf(g) };
    }
    if (g.availableFrom === date) return { ...base, action: 'keep', planned: valuesOf(g) };
    const moved = { ...g, availableFrom: date };
    grants = grants.map((x) => (x.id === g.id ? moved : x));
    return { ...base, action: 'move', planned: valuesOf(moved), current: valuesOf(g) };
  });
  return { grants, promotionGrants, rows };
}

/** 연동 중인 자동 휴가를 사용자가 고치면(이름만 바꾼 경우 제외) 연동을 멈춘다. */
export function promotionEntryAfterEdit(entry, before, after) {
  if (entry?.status !== 'managed') return entry;
  return EDIT_FIELDS.some((k) => before[k] !== after[k]) ? { ...entry, status: 'fixed' } : entry;
}

/** 자동 휴가가 어느 계급 기록인지 — 종류가 바뀌었을 수 있으니 grantId로 찾는다. */
export function entryForGrant(pg, grantId) {
  const kind = PROMOTION_KINDS.find((k) => pg[k]?.grantId === grantId);
  return kind ? { kind, entry: pg[kind] } : null;
}

/** 자동 휴가를 지우면 다시 넣지 않도록 기록한다. */
export function promotionGrantsAfterDelete(pg, grantId) {
  const hit = entryForGrant(pg, grantId);
  return hit ? { ...pg, [hit.kind]: { grantId: null, status: 'suppressed' } } : pg;
}
