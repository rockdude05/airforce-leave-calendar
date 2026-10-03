import { isDateOnly } from './dates.js';

export const SCHEMA_VERSION = 3;
export const RULE_VERSION = 'unit-user-2026-10-02.2';
export const STORAGE_KEY = 'airforce-leave-calendar:v1';
export const VISIT_PRINCIPLE_LIMIT = 7;
/** 일반 외출: 한 달 2회, 남은 횟수는 다음 달로 넘어가지 않음 (2026-10-02 사용자 확인) */
export const OUTING_MONTHLY_LIMIT = 2;
/** 가점 → 포상휴가 1일 전환 (2026-10-02 사용자 결정: 기준 점수는 사용자가 입력, 바꾼 만큼 차감) */
export const MERIT_POINTS_MAX = 999;
export const MERIT_PER_DAY_MAX = 999;
export const MERIT_CONVERT_MAX_DAYS = 30;
export const MERIT_GRANT_LABEL = '포상 (가점 전환)';

/** @type {readonly string[]} */
export const GRANT_KINDS = Object.freeze([
  'regular-private-first', 'regular-corporal', 'regular-sergeant',
  'reward', 'consolation', 'compensation', 'petition', 'other',
]);

export const GRANT_KIND_LABELS = Object.freeze({
  'regular-private-first': '정기 (일병)',
  'regular-corporal': '정기 (상병)',
  'regular-sergeant': '정기 (병장)',
  reward: '포상',
  consolation: '위로',
  compensation: '보상',
  petition: '청원',
  other: '기타',
});

/** 사용자 제공 부대 안내값. 자동 지급하지 않는다. */
export const REGULAR_GUIDE = Object.freeze({
  'regular-private-first': 10,
  'regular-corporal': 8,
  'regular-sergeant': 10,
});

export const SEGMENT_KINDS = Object.freeze(['leave', 'performance', 'outing', 'visit']);
export const SEGMENT_KIND_LABELS = Object.freeze({
  leave: '휴가', performance: '성과제외박', outing: '외출', visit: '면회외출',
});
export const TRIP_STATUSES = Object.freeze(['planned', 'completed', 'cancelled']);
export const TRIP_STATUS_LABELS = Object.freeze({ planned: '계획', completed: '사용완료', cancelled: '취소' });
export const TRANSPORT_ASSESSMENTS = Object.freeze(['unknown', 'confirmed-eligible', 'confirmed-ineligible']);

/** @param {string} today */
export function createEmptyState(today) {
  if (!isDateOnly(today)) throw new RangeError(`invalid today: ${String(today)}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    grants: [],
    trips: [],
    settings: { visitBaselineCount: 0, visitBaselineAsOf: today },
    service: null,
    merit: emptyMerit(),
  };
}

/** 가점 없음·기준 없음 */
export function emptyMerit() {
  return { points: 0, pointsPerDay: null };
}

export function emptyTransport() {
  return { assessment: 'unknown', issued: false, validFrom: null, validTo: null, note: '' };
}

/** 충돌 가능성이 낮은 로컬 ID */
export function newId(prefix) {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

/** 일정 구간 중 휴가만 지급 건을 참조 */
export function tripDates(trip) {
  const segs = [...trip.segments].sort((a, b) => (a.start < b.start ? -1 : 1));
  return { start: segs[0]?.start ?? null, end: segs.at(-1)?.end ?? null };
}
