// 기록 판 이행. 저장소 읽기와 백업 읽기가 함께 쓴다. 순수 함수 — 저장하지 않는다.
import { SCHEMA_VERSION, RULE_VERSION } from './model.js';
import { validateState } from './validation.js';

const hasErrors = (issues) => issues.some((i) => i.severity === 'error');

/**
 * 1판 원본은 1판 규칙으로 검증 → 순수 변환 → 2판 검증. 상위 판은 future로 구별한다.
 * @param {unknown} input
 * @returns {{ok:true, state:any, migrated:boolean, issues:any[]} | {ok:false, issues:any[], future?:boolean}}
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
  if (version === 1) {
    const v1Issues = validateState(input, { version: 1 });
    if (hasErrors(v1Issues)) return { ok: false, issues: v1Issues };
    const next = { ...(/** @type {any} */ (input)), schemaVersion: 2, ruleVersion: RULE_VERSION, service: null };
    const issues = validateState(next, { version: 2 });
    if (hasErrors(issues)) return { ok: false, issues };
    return { ok: true, state: next, migrated: true, issues };
  }
  const issues = validateState(input, { version: 2 });
  if (hasErrors(issues)) return { ok: false, issues };
  return { ok: true, state: input, migrated: false, issues };
}
