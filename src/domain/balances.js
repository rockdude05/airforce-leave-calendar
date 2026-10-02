import { compareDates, inclusiveDays, withinRange } from './dates.js';
import { VISIT_PRINCIPLE_LIMIT } from './model.js';

/** 배정 가능 기간: 시작 = max(balanceAsOf, availableFrom), 끝 = expiresOn(없으면 null) */
export function grantWindow(g) {
  const start = g.availableFrom && compareDates(g.availableFrom, g.balanceAsOf) > 0 ? g.availableFrom : g.balanceAsOf;
  return { start, end: g.expiresOn ?? null };
}

export function grantStatus(g, today) {
  const w = grantWindow(g);
  if (compareDates(today, w.start) < 0) return 'pending';
  if (w.end && compareDates(today, w.end) > 0) return 'expired';
  return 'active';
}

export function isActiveTrip(t) {
  return t.status !== 'cancelled';
}

/** 지급 건별 사용완료·계획 일수 (취소 일정 제외) */
export function allocationByGrant(trips) {
  /** @type {Record<string,{used:number,planned:number}>} */
  const out = Object.create(null);
  for (const t of trips) {
    if (!isActiveTrip(t)) continue;
    for (const s of t.segments) {
      if (s.kind !== 'leave' || !s.grantId) continue;
      const slot = (out[s.grantId] ??= { used: 0, planned: 0 });
      const days = inclusiveDays(s.start, s.end);
      if (t.status === 'completed') slot.used += days;
      else slot.planned += days;
    }
  }
  return out;
}

export function visitCounts(state) {
  let used = 0;
  let planned = 0;
  for (const t of state.trips) {
    if (!isActiveTrip(t)) continue;
    const n = t.segments.filter((s) => s.kind === 'visit').length;
    if (t.status === 'completed') used += n;
    else planned += n;
  }
  const baseline = state.settings.visitBaselineCount;
  return { baseline, used, planned, total: baseline + used + planned, limit: VISIT_PRINCIPLE_LIMIT };
}

/**
 * 잔여량은 매번 지급 내역과 일정에서 다시 계산한다.
 * @param {import('./model.js').AppState} state
 * @param {string} today Asia/Seoul 기준 DateOnly
 */
export function calculateBalances(state, today) {
  const alloc = allocationByGrant(state.trips);
  /** @type {Record<string, any>} */
  const byGrant = Object.create(null);
  let availableTodayAfterPlans = 0;
  let ledgerRemaining = 0;
  let ledgerAfterPlans = 0;
  for (const g of state.grants) {
    const { used = 0, planned = 0 } = alloc[g.id] ?? {};
    const remaining = g.amount - used;
    const afterPlans = remaining - planned;
    const status = grantStatus(g, today);
    const w = grantWindow(g);
    byGrant[g.id] = { issued: g.amount, used, planned, remaining, afterPlans, status, windowStart: w.start, windowEnd: w.end };
    ledgerRemaining += remaining;
    ledgerAfterPlans += afterPlans;
    if (status === 'active') availableTodayAfterPlans += afterPlans;
  }
  return { byGrant, availableTodayAfterPlans, ledgerRemaining, ledgerAfterPlans, visits: visitCounts(state) };
}

/** 날짜가 지급 건 배정 가능 기간 안인지 */
export function inGrantWindow(g, start, end) {
  const w = grantWindow(g);
  return withinRange(start, w.start, w.end ?? '9999-12-31') && withinRange(end, w.start, w.end ?? '9999-12-31');
}
