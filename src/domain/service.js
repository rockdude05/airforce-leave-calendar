// 복무 일정 계산 (규칙 버전 unit-user-2026-10-02.2: 성과제 회차 = 수료일 + n·주기). 순수 함수만 — dates.js 외 의존 없음.
import { addDays, addMonthsClamped, compareDates, inclusiveDays, isDateOnly, weekday } from './dates.js';

/** @typedef {{code:string,message:string,severity:'error'|'warning'|'info',field?:string}} Issue */

/** 주기(주) → 마지막 숙박 일수 */
export const PERFORMANCE_DAYS = Object.freeze({ 6: 3, 8: 4, 12: 6 });

const OVERRIDE_KEYS = ['graduation', 'privateFirst', 'corporal', 'sergeant', 'discharge'];
const SERVICE_KEYS = ['enlistDate', 'performanceCycleWeeks', 'overrides', 'lastPerformanceDays'];

/** @returns {Issue} */
function issue(severity, code, message, field) {
  return field ? { code, message, severity, field } : { code, message, severity };
}
const err = (code, message, field) => issue('error', code, message, field);

/** 입대일이 속한 주(월요일 시작) 의 월요일 */
function mondayOfWeek(date) {
  const wd = weekday(date); // 0=일
  const daysSinceMonday = (wd + 6) % 7; // 월=0, 화=1, ... 일=6
  return addDays(date, -daysSinceMonday);
}

/** 수료일: 입대 주의 월요일 + 4주 + 4일 (금요일) */
function computeGraduation(enlistDate) {
  return addDays(mondayOfWeek(enlistDate), 4 * 7 + 4);
}

/** 진급 기산월 1일: 1일 입대면 입대월, 아니면 다음 달 1일 */
function promotionBaseMonth(enlistDate) {
  const day = Number(enlistDate.slice(8, 10));
  const enlistMonthFirst = `${enlistDate.slice(0, 7)}-01`;
  return day === 1 ? enlistMonthFirst : addMonthsClamped(enlistMonthFirst, 1);
}

function computeDischarge(enlistDate) {
  return addDays(addMonthsClamped(enlistDate, 21), -1);
}

function computedValues(enlistDate) {
  const graduation = computeGraduation(enlistDate);
  const baseMonth = promotionBaseMonth(enlistDate);
  return {
    graduation,
    privateFirst: addMonthsClamped(baseMonth, 2),
    corporal: addMonthsClamped(baseMonth, 8),
    sergeant: addMonthsClamped(baseMonth, 14),
    discharge: computeDischarge(enlistDate),
  };
}

function effectiveValues(overrides, computed) {
  const effective = {};
  const overridden = {};
  for (const key of OVERRIDE_KEYS) {
    const ov = overrides?.[key] ?? null;
    overridden[key] = ov !== null;
    effective[key] = ov ?? computed[key];
  }
  return { effective, overridden };
}

/** 성과제 회차·마지막 덜 찬 회차 계산 */
function computePerformances(graduationEffective, dischargeEffective, cycleWeeks, lastPerformanceDays) {
  // 회차 = 수료일 + n·주기 (2026-10-02 사용자 확인: 수료일 다음 날 기준은 하루씩 늦었음)
  const base = graduationEffective;
  const cycleLength = 7 * cycleWeeks;
  const days = PERFORMANCE_DAYS[cycleWeeks];
  const performances = [];
  let lastCompleteDate = null;
  // 안전 상한: 비정상 입력으로 무한 루프 방지
  for (let n = 1; n <= 1000; n += 1) {
    const date = addDays(base, n * cycleLength);
    if (compareDates(date, dischargeEffective) > 0) break;
    performances.push({ n, date, days });
    lastCompleteDate = date;
  }

  const partialStart = addDays(lastCompleteDate ?? base, 1);
  let lastPartial = null;
  if (compareDates(partialStart, dischargeEffective) <= 0) {
    const span = inclusiveDays(partialStart, dischargeEffective);
    if (span >= 1 && span < cycleLength) {
      lastPartial = { start: partialStart, end: dischargeEffective, days: lastPerformanceDays };
    }
  }

  return { performances, lastPartial };
}

function computeRank(today, effective) {
  if (compareDates(today, effective.discharge) > 0) return '전역';
  if (compareDates(today, effective.sergeant) >= 0) return '병장';
  if (compareDates(today, effective.corporal) >= 0) return '상병';
  if (compareDates(today, effective.privateFirst) >= 0) return '일병';
  return '이병';
}

/**
 * @param {object} service Service (overrides·lastPerformanceDays 포함)
 * @param {string} today DateOnly
 */
export function computeSchedule(service, today) {
  const computed = computedValues(service.enlistDate);
  const { effective, overridden } = effectiveValues(service.overrides, computed);
  const { performances, lastPartial } = computePerformances(
    effective.graduation,
    effective.discharge,
    service.performanceCycleWeeks,
    service.lastPerformanceDays,
  );
  const nextPerformance = performances.find((p) => compareDates(p.date, today) >= 0) ?? null;
  const rank = computeRank(today, effective);
  // 다 차는 회차가 더 없고 전역 전 마지막(덜 찬) 회차만 남았으면 그 회차(날짜 = 전역일)
  const nextLastPartial = !nextPerformance && lastPartial && compareDates(lastPartial.end, today) >= 0 ? lastPartial : null;

  return {
    ...effective,
    computed,
    overridden,
    rank,
    performances,
    lastPartial,
    nextPerformance,
    nextLastPartial,
  };
}

function isValidDateOrNull(v) {
  return v === null || v === undefined || isDateOnly(v);
}

/** @param {unknown} service @returns {Issue[]} */
export function validateService(service) {
  if (service === null) return [];
  const out = [];
  if (!service || typeof service !== 'object' || Array.isArray(service)) {
    return [err('SERVICE_SHAPE', '복무 정보 형식이 올바르지 않습니다.')];
  }

  for (const key of Object.keys(service)) {
    if (!SERVICE_KEYS.includes(key)) out.push(err('SERVICE_UNKNOWN_KEY', `알 수 없는 항목입니다: ${key}`, key));
  }

  if (!isDateOnly(service.enlistDate)) {
    out.push(err('SERVICE_ENLIST_DATE', '입대일을 올바른 날짜로 입력해 주세요.', 'enlistDate'));
  }

  if (![6, 8, 12].includes(service.performanceCycleWeeks)) {
    out.push(err('SERVICE_CYCLE', '성과제 주기는 6, 8, 12주 중에서 선택해 주세요.', 'performanceCycleWeeks'));
  }

  if (service.lastPerformanceDays !== null
    && !(Number.isInteger(service.lastPerformanceDays) && service.lastPerformanceDays >= 0 && service.lastPerformanceDays <= 7)) {
    out.push(err('SERVICE_LAST_DAYS', '마지막 성과제 일수는 0~7 사이의 정수 또는 모름이어야 합니다.', 'lastPerformanceDays'));
  }

  const overrides = service.overrides;
  let overridesValid = true;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    out.push(err('SERVICE_OVERRIDES_SHAPE', '직접 수정한 날짜 형식이 올바르지 않습니다.', 'overrides'));
    overridesValid = false;
  } else {
    for (const key of Object.keys(overrides)) {
      if (!OVERRIDE_KEYS.includes(key)) {
        out.push(err('SERVICE_UNKNOWN_KEY', `알 수 없는 항목입니다: ${key}`, key));
        overridesValid = false;
      }
    }
    for (const key of OVERRIDE_KEYS) {
      if (!isValidDateOrNull(overrides[key])) {
        out.push(err('SERVICE_OVERRIDE_DATE', '직접 수정한 날짜가 올바르지 않습니다.', key));
        overridesValid = false;
      }
    }
  }

  if (out.length > 0 || !overridesValid) return out;

  const schedule = computeSchedule(service, service.enlistDate);
  if (compareDates(schedule.graduation, service.enlistDate) <= 0) {
    out.push(err('SERVICE_ORDER', '수료일은 입대일보다 늦어야 합니다.', 'graduation'));
  }
  if (compareDates(schedule.privateFirst, schedule.corporal) > 0) {
    out.push(err('SERVICE_ORDER', '상병 진급일은 일병 진급일보다 빠를 수 없습니다.', 'corporal'));
  }
  if (compareDates(schedule.corporal, schedule.sergeant) > 0) {
    out.push(err('SERVICE_ORDER', '병장 진급일은 상병 진급일보다 빠를 수 없습니다.', 'sergeant'));
  }
  if (compareDates(schedule.sergeant, schedule.discharge) >= 0) {
    out.push(err('SERVICE_ORDER', '전역일은 병장 진급일보다 늦어야 합니다.', 'discharge'));
  }
  if (compareDates(schedule.discharge, schedule.graduation) <= 0) {
    out.push(err('SERVICE_ORDER', '전역일은 수료일보다 늦어야 합니다.', 'discharge'));
  }

  return out;
}
