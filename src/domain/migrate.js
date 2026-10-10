// 기록 판 이행. 저장소 읽기와 백업 읽기가 함께 쓴다. 순수 함수 — 저장하지 않는다.
import { SCHEMA_VERSION, RULE_VERSION, emptyMerit, emptyPromotionGrants } from './model.js';
import { validateState } from './validation.js';

const hasErrors = (issues) => issues.some((i) => i.severity === 'error');

/**
 * 원본 판 규칙으로 검증 → 1→2 → 2→3 → 3→4 → 4→5 → 5→6 → 6→7 → 7→8(휴가 계획서 plan:null) → 규칙 이행 → 최신 판 검증. 상위 판은 future로 구별한다.
 * 2→3은 merit만, 3→4는 promotionGrants만, 4→5는 공유 필드(일정 shareConfirmed·received·설정 shareId·viewOnly)만 더하고 ruleVersion은 건드리지 않는다(규칙 이행이 예전 규칙 버전을 보고 판단하므로).
 * 이행에서는 정기휴가를 자동으로 넣지 않는다(복무 정보 저장 때만).
 * 메모리에서만 바꾸고 저장하지 않는다. fromVersion은 원본 판.
 * @param {unknown} input
 * @returns {{ok:true, state:any, migrated:boolean, fromVersion:number, issues:any[]} | {ok:false, issues:any[], future?:boolean}}
 */
export function migrateState(input) {
  const version = input && typeof input === 'object' && !Array.isArray(input) ? /** @type {any} */ (input).schemaVersion : undefined;
  if (Number.isInteger(version) && version > SCHEMA_VERSION) {
    return {
      ok: false,
      future: true,
      issues: [{ code: 'SCHEMA_FUTURE', severity: 'error', message: '새 버전 앱이 저장한 기록입니다 — 앱을 업데이트해 주세요' }],
    };
  }
  const fromVersion = version === 1 || version === 2 || version === 3 || version === 4 || version === 5 || version === 6 || version === 7 ? version : SCHEMA_VERSION;
  const sourceIssues = validateState(input, { version: fromVersion });
  if (hasErrors(sourceIssues)) return { ok: false, issues: sourceIssues };
  let next = /** @type {any} */ (input);
  if (fromVersion === 1) next = { ...next, schemaVersion: 2, ruleVersion: RULE_VERSION, service: null };
  if (fromVersion <= 2) next = { ...next, schemaVersion: 3, merit: emptyMerit() };
  if (fromVersion <= 3) next = { ...next, schemaVersion: 4, promotionGrants: emptyPromotionGrants() };
  if (fromVersion <= 4) {
    next = {
      ...next, schemaVersion: 5, received: [],
      settings: { ...next.settings, shareId: null, viewOnly: false },
      trips: next.trips.map((t) => ({ ...t, shareConfirmed: false })),
    };
  }
  if (fromVersion <= 5) next = { ...next, schemaVersion: 6, trips: next.trips.map((t) => ({ ...t, preparation: [] })) };
  if (fromVersion <= 6) next = { ...next, schemaVersion: 7, trips: next.trips.map((t) => ({ ...t, performanceSource: null })) };
  if (fromVersion <= 7) next = { ...next, schemaVersion: 8, trips: next.trips.map((t) => ({ ...t, plan: null })) };
  next = migrateRules(next);
  if (next === input) return { ok: true, state: input, migrated: false, fromVersion, issues: sourceIssues };
  const issues = validateState(next);
  if (hasErrors(issues)) return { ok: false, issues };
  return { ok: true, state: next, migrated: true, fromVersion, issues };
}

/**
 * 규칙 버전 이행 (같은 2판 안).
 * unit-user-2026-10-02 → .2: 성과제 회차 기준이 '수료일 다음 날'에서 '수료일'로 하루 당겨져
 * 마지막 덜 찬 회차 기간이 바뀐다 → 예전 기준으로 입력한 마지막 회차 일수는 '확인 필요'(null)로 되돌린다.
 * 저장된 출타 일정은 바꾸지 않는다.
 */
export function migrateRules(state) {
  if (!state || state.ruleVersion === RULE_VERSION) return state;
  const next = { ...state, ruleVersion: RULE_VERSION };
  if (state.ruleVersion === 'unit-user-2026-10-02' && state.service && state.service.lastPerformanceDays !== null) {
    next.service = { ...state.service, lastPerformanceDays: null };
  }
  return next;
}
