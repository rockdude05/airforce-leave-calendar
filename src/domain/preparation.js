// 개인 준비 기록. 날짜·종류·배정에 대한 체크이며 공식 승인과 무관하다.
import { isDateOnly, compareDates } from './dates.js';

export const PREPARATION_ITEMS = Object.freeze([
  { id: 'roster', label: '명부 작성', stage: 'application' },
  { id: 'plan', label: '휴가계획서 제출', stage: 'application' },
  { id: 'announcement', label: '확정 공지 확인', stage: 'application' },
  { id: 'personnel', label: '국인체 신청', stage: 'application' },
  { id: 'proxy', label: '직무대리자 지정', stage: 'application' },
  { id: 'passes', label: '필요한 출타증 모두 출력', stage: 'departure' },
  { id: 'belongings', label: '패스·군번줄·출타증 준비', stage: 'departure' },
  { id: 'departure', label: '출발 보고', stage: 'departure' },
  { id: 'return', label: '복귀 보고', stage: 'return' },
].map(Object.freeze));
const IDS = new Set(PREPARATION_ITEMS.map(i => i.id));

/** 유효한 연속 구간만 계산. 구조가 불완전한 편집 초안·외부 입력도 예외 없이 받는다. */
export function preparationContext(segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  for (const s of segments) {
    if (!s || !['leave', 'performance', 'outing', 'visit'].includes(s.kind)
      || !isDateOnly(s.start) || !isDateOnly(s.end) || compareDates(s.start, s.end) > 0) return null;
    if (s.kind === 'leave' ? typeof s.grantId !== 'string' || !s.grantId : s.grantId !== null) return null;
    if ((s.kind === 'outing' || s.kind === 'visit') && (segments.length !== 1 || s.start !== s.end)) return null;
  }
  const sorted = [...segments].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i += 1) {
    if (compareDates(sorted[i].start, sorted[i - 1].end) !== 1) return null;
  }
  return {
    start: sorted[0].start, end: sorted[sorted.length - 1].end,
    hasLeave: sorted.some(s => s.kind === 'leave'),
    hasPerformance: sorted.some(s => s.kind === 'performance'),
    outingKind: ['outing', 'visit'].includes(sorted[0].kind) ? sorted[0].kind : null,
    basis: JSON.stringify(sorted.map(({ kind, start, end, grantId }) => ({ kind, start, end, grantId }))),
  };
}

export function preparationItems(segments) {
  const context = preparationContext(segments);
  if (!context) return [];
  return PREPARATION_ITEMS.filter(i => (i.id !== 'plan' || !context.outingKind) && (i.id !== 'proxy' || context.hasLeave));
}

export function validatePreparation(checked, segments) {
  const invalid = () => [{ code: 'TRIP_PREPARATION', severity: 'error', message: '일정의 준비 체크 형식이 올바르지 않습니다.' }];
  if (!Array.isArray(checked) || checked.length > 9 || checked.some(id => typeof id !== 'string' || !IDS.has(id))
    || new Set(checked).size !== checked.length) return invalid();
  if (preparationContext(segments)) {
    const allowed = new Set(preparationItems(segments).map(i => i.id));
    if (checked.some(id => !allowed.has(id))) return invalid();
  }
  return [];
}

/** 편집기의 검증된 초안 전용. 외부 백업에는 validatePreparation을 먼저 적용한다. */
export function normalizePreparation(checked, segments) {
  return preparationItems(segments).filter(i => checked.includes(i.id)).map(i => i.id);
}

export function snapshotGrantKinds(grants) { return new Map(grants.map(g => [g.id, g.kind])); }
export function hasChangedGrantKinds(trip, baseline, latestGrants) {
  const latest = snapshotGrantKinds(latestGrants);
  return trip.segments.some(s => s.kind === 'leave'
    && (!baseline.has(s.grantId) || !latest.has(s.grantId) || baseline.get(s.grantId) !== latest.get(s.grantId)));
}
export function resetPreparationForGrant(trips, grantId) {
  let resetCount = 0;
  const next = trips.map(t => {
    if (!t.preparation.length || !t.segments.some(s => s.kind === 'leave' && s.grantId === grantId)) return t;
    resetCount += 1;
    return { ...t, preparation: [] };
  });
  return { trips: resetCount ? next : trips, resetCount };
}
