// 가점 → 포상휴가 1일 전환. 순수 함수 — 저장하지 않는다.
// 사용자 결정(2026-10-02): 기준 점수(포상휴가 1일당 가점)는 사용자가 넣고, 바꾼 만큼 가점에서 뺀다.
import { isDateOnly } from './dates.js';
import { MERIT_CONVERT_MAX_DAYS, MERIT_GRANT_LABEL } from './model.js';
import { validateMerit } from './validation.js';

const hasErrors = (issues) => issues.some((i) => i.severity === 'error');

/**
 * 저장하면 어떻게 되는지 미리 계산한다(ID를 만들지 않는다). 기준이 없거나 입력이 잘못되면 null.
 * @returns {{days:number, used:number, remaining:number, toNext:number} | null}
 */
export function meritPreview(merit) {
  if (hasErrors(validateMerit(merit, { stored: false })) || merit.pointsPerDay === null) return null;
  const { points, pointsPerDay: n } = merit;
  const days = Math.floor(points / n);
  const remaining = points % n;
  return { days, used: days * n, remaining, toNext: n - remaining };
}

/**
 * 기준이 찬 만큼 1일짜리 포상휴가를 만들고 가점에서 뺀다. 모든 검사를 마친 뒤에만 ID를 만든다.
 * @param {{points:number, pointsPerDay:number|null}} merit
 * @param {{today:string, newId:(prefix:string)=>string}} opts
 */
export function convertMerit(merit, { today, newId }) {
  const issues = validateMerit(merit, { stored: false });
  if (hasErrors(issues)) return { ok: false, issues };
  if (!isDateOnly(today)) return { ok: false, issues: [{ code: 'MERIT_DATE', message: '오늘 날짜를 알 수 없어 가점을 바꾸지 않았습니다.', severity: 'error' }] };
  const p = meritPreview(merit);
  if (!p) return { ok: true, merit: { ...merit }, grants: [], days: 0, used: 0 };
  if (p.days > MERIT_CONVERT_MAX_DAYS) {
    return { ok: false, issues: [{ code: 'MERIT_TOO_MANY', message: `한 번에 ${MERIT_CONVERT_MAX_DAYS}일까지만 바꿀 수 있습니다 — 숫자를 확인해 주세요.`, severity: 'error', field: 'points' }] };
  }
  const grants = Array.from({ length: p.days }, () => ({
    id: newId('grant'), kind: 'reward', label: MERIT_GRANT_LABEL, amount: 1, balanceAsOf: today, availableFrom: null, expiresOn: null,
  }));
  return { ok: true, merit: { points: p.remaining, pointsPerDay: merit.pointsPerDay }, grants, days: p.days, used: p.used };
}
