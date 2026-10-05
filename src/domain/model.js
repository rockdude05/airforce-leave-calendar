import { isDateOnly } from './dates.js';

export const SCHEMA_VERSION = 6;
export const RULE_VERSION = 'unit-user-2026-10-03';
export const STORAGE_KEY = 'airforce-leave-calendar:v1';
export const VISIT_PRINCIPLE_LIMIT = 7;
/** 일반 외출: 한 달 2회, 남은 횟수는 다음 달로 넘어가지 않음 (2026-10-02 사용자 확인) */
export const OUTING_MONTHLY_LIMIT = 2;
/** 가점 → 포상휴가 1일 전환 (2026-10-02 사용자 결정: 기준 점수는 사용자가 입력, 바꾼 만큼 차감) */
export const MERIT_POINTS_MAX = 999;
export const MERIT_PER_DAY_MAX = 999;
export const MERIT_CONVERT_MAX_DAYS = 30;
export const MERIT_GRANT_LABEL = '포상 (가점 전환)';
/** 일정 공유 (2026-10-03 사용자 결정): 받은 사람 수·코드 한 건의 일정 수·별명 길이·색 자리 수 */
export const RECEIVED_LIMIT = 30;
export const SHARE_ITEMS_LIMIT = 20;
export const NICKNAME_LIMIT = 20;
export const COLOR_SLOTS = 6;
/** 내 공유 번호·상대 번호: 대문자·숫자 8자 (QR 알파뉴메릭 세그먼트에 맞춤) */
export const SHARE_ID_RE = /^[0-9A-Z]{8}$/;

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
    settings: { visitBaselineCount: 0, visitBaselineAsOf: today, shareId: null, viewOnly: false },
    service: null,
    merit: emptyMerit(),
    promotionGrants: emptyPromotionGrants(),
    received: [],
  };
}

const SHARE_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 내 공유 번호 8자. 처음 공유할 때 한 번 만들어 저장한다. */
export function newShareId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => SHARE_ID_ALPHABET[b % SHARE_ID_ALPHABET.length]).join('');
}

/** 화면용 규칙 버전 이름: 'unit-user-2026-10-02.2' → '2026년 10월 2일 기준 (2차)'. 내부 값은 문의 양식에만 쓴다. */
export function ruleVersionLabel(v = RULE_VERSION) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?$/.exec(v);
  if (!m) return '사용자 확인 규칙';
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일 기준${m[4] ? ` (${m[4]}차)` : ''}`;
}

/** 정기휴가 자동 지급 대상 계급(진급 순서) — 2026-10-03 사용자 승인 */
export const PROMOTION_KINDS = Object.freeze(['regular-private-first', 'regular-corporal', 'regular-sergeant']);
export const PROMOTION_STATUSES = Object.freeze(['managed', 'fixed', 'suppressed']);

/** 계급별 자동 지급 기록: null = 아직 처리 안 함 */
export function emptyPromotionGrants() {
  return Object.fromEntries(PROMOTION_KINDS.map((k) => [k, null]));
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
