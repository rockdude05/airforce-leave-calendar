import { compareDates, isDateOnly, addDays, koreanDate } from './dates.js';
import {
  GRANT_KINDS, SEGMENT_KINDS, TRIP_STATUSES, TRANSPORT_ASSESSMENTS, SEGMENT_KIND_LABELS, VISIT_PRINCIPLE_LIMIT, OUTING_MONTHLY_LIMIT,
  MERIT_POINTS_MAX, MERIT_PER_DAY_MAX, PROMOTION_KINDS, PROMOTION_STATUSES,
  RECEIVED_LIMIT, SHARE_ITEMS_LIMIT, NICKNAME_LIMIT, COLOR_SLOTS, SHARE_ID_RE,
} from './model.js';
import { validatePreparation } from './preparation.js';
import { validateService } from './service.js';
import { allocationByGrant, grantWindow, inGrantWindow, isActiveTrip, visitCounts } from './balances.js';

export const LIMITS = Object.freeze({ title: 60, label: 40, note: 300, amount: 365, id: 80 });
/** 시작 전 면회외출 횟수 입력 상한 (오타 방지용, 원칙 7회와 별개) */
export const VISIT_BASELINE_MAX = 30;

/** @typedef {{code:string,message:string,severity:'error'|'warning'|'info',field?:string}} Issue */

/** @returns {Issue} */
function issue(severity, code, message, field) {
  return field ? { code, message, severity, field } : { code, message, severity };
}
const err = (code, message, field) => issue('error', code, message, field);

const isNonEmptyString = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** 식별자는 영숫자·_·- 만 허용 (__proto__ 같은 특수 키 방지) */
export const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v) && v !== '__proto__';
const isOptionalDate = (v) => v === null || isDateOnly(v);

/* ---------------- 지급 건 ---------------- */

/** @returns {Issue[]} */
export function grantFieldIssues(g) {
  const out = [];
  if (!g || typeof g !== 'object') return [err('GRANT_SHAPE', '지급 건 형식이 올바르지 않습니다.')];
  if (!isId(g.id)) out.push(err('ID_INVALID', '지급 건 식별자가 올바르지 않습니다.', 'id'));
  if (!GRANT_KINDS.includes(g.kind)) out.push(err('GRANT_KIND', '휴가 종류를 선택해 주세요.', 'kind'));
  if (!isNonEmptyString(g.label, LIMITS.label)) out.push(err('GRANT_LABEL', `이름을 1~${LIMITS.label}자로 입력해 주세요.`, 'label'));
  if (!Number.isInteger(g.amount) || g.amount < 1 || g.amount > LIMITS.amount) {
    out.push(err('GRANT_AMOUNT', `일수는 1~${LIMITS.amount} 사이의 정수여야 합니다.`, 'amount'));
  }
  if (!isDateOnly(g.balanceAsOf)) out.push(err('GRANT_DATE', '입력 기준일을 선택해 주세요.', 'balanceAsOf'));
  if (!isOptionalDate(g.availableFrom)) out.push(err('GRANT_DATE', '사용 시작일이 올바르지 않습니다.', 'availableFrom'));
  if (!isOptionalDate(g.expiresOn)) out.push(err('GRANT_DATE', '만료일이 올바르지 않습니다.', 'expiresOn'));
  if (out.length === 0 && g.expiresOn && compareDates(g.expiresOn, grantWindow(g).start) < 0) {
    out.push(err('GRANT_WINDOW_EMPTY', '만료일이 사용 가능 시작일보다 빠릅니다.', 'expiresOn'));
  }
  return out;
}

/* ---------------- 일정 ---------------- */

function segmentFieldIssues(s) {
  const out = [];
  if (!s || typeof s !== 'object') return [err('SEGMENT_SHAPE', '구간 형식이 올바르지 않습니다.')];
  if (!isId(s.id)) out.push(err('ID_INVALID', '구간 식별자가 올바르지 않습니다.'));
  if (!SEGMENT_KINDS.includes(s.kind)) out.push(err('SEGMENT_KIND', '구간 종류가 올바르지 않습니다.'));
  if (!isDateOnly(s.start) || !isDateOnly(s.end) || compareDates(s.end, s.start) < 0) {
    out.push(err('SEGMENT_RANGE', '구간 날짜가 올바르지 않습니다. 종료일은 시작일과 같거나 이후여야 합니다.'));
  }
  if (s.kind === 'leave') {
    if (typeof s.grantId !== 'string' || !s.grantId) out.push(err('GRANT_MISSING', '휴가 구간에 사용할 휴가를 선택해 주세요.'));
  } else if (s.grantId !== null) {
    out.push(err('GRANT_NOT_ALLOWED', `${SEGMENT_KIND_LABELS[s.kind] ?? '이 구간'}은 휴가 일수를 차감하지 않습니다.`));
  }
  return out;
}

function transportIssues(tr) {
  if (!tr || typeof tr !== 'object') return [err('TRANSPORT_SHAPE', '후급 기록 형식이 올바르지 않습니다.')];
  const out = [];
  if (!TRANSPORT_ASSESSMENTS.includes(tr.assessment)) out.push(err('TRANSPORT_SHAPE', '후급 확인 상태가 올바르지 않습니다.'));
  if (typeof tr.issued !== 'boolean') out.push(err('TRANSPORT_SHAPE', '후급 발급 여부가 올바르지 않습니다.'));
  if (typeof tr.note !== 'string' || tr.note.length > LIMITS.note) out.push(err('TRANSPORT_SHAPE', `메모는 ${LIMITS.note}자 이하로 입력해 주세요.`));
  if (!isOptionalDate(tr.validFrom) || !isOptionalDate(tr.validTo)) {
    out.push(err('TRANSPORT_RANGE', '후급 사용 가능 기간 날짜가 올바르지 않습니다.'));
  } else if (tr.validFrom && tr.validTo && compareDates(tr.validTo, tr.validFrom) < 0) {
    out.push(err('TRANSPORT_RANGE', '후급 사용 가능 기간의 끝이 시작보다 빠릅니다.'));
  }
  return out;
}

/** 일정 단독 구조 검사 (다른 일정·지급 건과 무관). version<5 기록에는 shareConfirmed가 없다. */
export function tripFieldIssues(t, { version = 7 } = {}) {
  if (!t || typeof t !== 'object') return [err('TRIP_SHAPE', '일정 형식이 올바르지 않습니다.')];
  const out = [];
  if (!isId(t.id)) out.push(err('ID_INVALID', '일정 식별자가 올바르지 않습니다.'));
  if (version >= 5 && typeof t.shareConfirmed !== 'boolean') out.push(err('TRIP_SHARE_FLAG', '일정의 확정 표시 값이 올바르지 않습니다.'));
  if (!isNonEmptyString(t.title, LIMITS.title)) out.push(err('TITLE_REQUIRED', `제목을 1~${LIMITS.title}자로 입력해 주세요.`, 'title'));
  if (!TRIP_STATUSES.includes(t.status)) out.push(err('TRIP_STATUS', '일정 상태가 올바르지 않습니다.'));
  out.push(...transportIssues(t.transport));
  if (version >= 6) out.push(...validatePreparation(t.preparation, t.segments));
  if (!Array.isArray(t.segments) || t.segments.length === 0) {
    out.push(err('SEGMENTS_REQUIRED', '날짜 구간을 하나 이상 추가해 주세요.'));
    return out;
  }
  if (version >= 7 && t.performanceSource !== null && (!isDateOnly(t.performanceSource) || !t.segments.some(s => s?.kind === 'performance'))) {
    out.push(err('PERFORMANCE_SOURCE', '성과제 일정의 발생일 연결이 올바르지 않습니다.'));
  }
  const segIssues = t.segments.flatMap(segmentFieldIssues);
  out.push(...segIssues);
  if (segIssues.some((i) => i.code === 'SEGMENT_RANGE' || i.code === 'SEGMENT_SHAPE' || i.code === 'SEGMENT_KIND')) return out;

  for (const s of t.segments) {
    if ((s.kind === 'visit' || s.kind === 'outing') && s.start !== s.end) {
      out.push(err('SINGLE_DAY_ONLY', `${SEGMENT_KIND_LABELS[s.kind]}은 하루 단위로만 입력할 수 있습니다.`));
    }
  }
  if (t.segments.length > 1 && t.segments.some((s) => s.kind === 'visit' || s.kind === 'outing')) {
    out.push(err('STANDALONE_ONLY', '외출·면회외출은 다른 구간과 묶지 말고 별도 일정으로 입력해 주세요.'));
  }
  const ids = new Set();
  for (const s of t.segments) {
    if (ids.has(s.id)) out.push(err('DUPLICATE_ID', '구간 식별자가 중복되었습니다.'));
    ids.add(s.id);
  }
  const sorted = [...t.segments].sort((a, b) => compareDates(a.start, b.start));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (compareDates(cur.start, prev.end) <= 0) out.push(err('SEGMENT_OVERLAP', '같은 일정 안의 구간 날짜가 겹칩니다.'));
    else if (cur.start !== addDays(prev.end, 1)) out.push(err('SEGMENT_GAP', '같은 일정의 구간은 날짜가 이어져야 합니다. 떨어진 날짜는 별도 일정으로 입력해 주세요.'));
  }
  return out;
}

function datesOverlap(a, b) {
  return compareDates(a.start, b.end) <= 0 && compareDates(b.start, a.end) <= 0;
}

export function tripsOverlap(a, b) {
  return a.segments.some((x) => b.segments.some((y) => datesOverlap(x, y)));
}

/**
 * 후급 판정 (부대 기준, 2026-10-02 사용자 확인):
 *  - 성과제외박만 쓴 출타 → 후급 없음
 *  - 정기휴가(연가)가 하루라도 들어간 출타 → 후급 없음
 *  - 그 밖(포상·위로·보상·청원 등, 성과제외박과 함께 써도) → 확인 필요 (앱이 확정하지 않음)
 * @returns {'none-performance-only'|'none-regular'|'unconfirmed'|null} 휴가·성과제가 없으면 null
 */
export function transportRule(state, t) {
  const kinds = new Set(t.segments.map((s) => s.kind));
  if (!kinds.has('leave') && !kinds.has('performance')) return null;
  if (!kinds.has('leave')) return 'none-performance-only';
  const hasRegular = t.segments.some((s) => s.kind === 'leave'
    && String(state.grants.find((g) => g.id === s.grantId)?.kind ?? '').startsWith('regular'));
  return hasRegular ? 'none-regular' : 'unconfirmed';
}

export const TRANSPORT_RULE_TEXT = {
  'none-performance-only': '후급 대상 아님 — 성과제외박만 쓰는 출타는 후급이 나오지 않습니다 (부대 기준).',
  'none-regular': '후급 대상 아님 — 정기휴가(연가)가 하루라도 들어가면 후급이 나오지 않습니다 (부대 기준).',
  unconfirmed: '후급 가능 여부: 정기휴가 없이 쓰는 출타라 후급이 나올 수 있습니다. 부대에 확인한 뒤 직접 기록해 주세요.',
};

/** 후급·결합 등 안내 */
function tripInfos(state, t) {
  const out = [];
  const kinds = new Set(t.segments.map((s) => s.kind));
  if (kinds.has('leave') && kinds.has('performance')) {
    out.push(issue('info', 'COMBINATION_UNCONFIRMED', '휴가와 성과제외박을 이어 쓰는 조건은 부대 확인이 필요합니다.'));
  }
  const rule = transportRule(state, t);
  if (rule === 'none-performance-only' || rule === 'none-regular') {
    out.push(issue('info', rule === 'none-regular' ? 'TRANSPORT_NONE_REGULAR' : 'TRANSPORT_NONE_PERFORMANCE', TRANSPORT_RULE_TEXT[rule]));
  } else if (rule === 'unconfirmed' && t.transport?.assessment === 'unknown') {
    out.push(issue('info', 'TRANSPORT_UNCONFIRMED', TRANSPORT_RULE_TEXT.unconfirmed));
  }
  return out;
}

/** 같은 달(YYYY-MM) 활성 외출 수 */
export function outingsInMonth(trips, month) {
  let n = 0;
  for (const t of trips) {
    if (!isActiveTrip(t)) continue;
    for (const s of t.segments) if (s.kind === 'outing' && s.start.startsWith(month)) n += 1;
  }
  return n;
}

/** 전체 상태에서 특정 지급 건들의 배정 불변식 */
function grantAllocationIssues(state, grantIds) {
  const out = [];
  const alloc = allocationByGrant(state.trips);
  for (const id of grantIds) {
    const g = state.grants.find((x) => x.id === id);
    if (!g) continue;
    const a = alloc[id];
    if (a && a.used + a.planned > g.amount) {
      out.push(err('GRANT_OVERDRAWN', `'${g.label}' 잔여량이 부족합니다 (보유 ${g.amount}일, 배정 ${a.used + a.planned}일).`));
    }
    for (const t of state.trips) {
      if (!isActiveTrip(t)) continue;
      for (const s of t.segments) {
        if (s.kind === 'leave' && s.grantId === id && !inGrantWindow(g, s.start, s.end)) {
          const w = grantWindow(g);
          out.push(err('GRANT_OUT_OF_WINDOW', `'${g.label}'은 ${koreanDate(w.start)}${w.end ? `~${koreanDate(w.end)}` : ' 이후'}에만 배정할 수 있습니다.`));
        }
      }
    }
  }
  return out;
}

/**
 * 후보 일정을 (replaceId 일정 대신) 넣었을 때의 문제.
 * @returns {Issue[]}
 */
export function validateTrip(state, candidate, replaceId = null) {
  const out = tripFieldIssues(candidate);
  if (out.some((i) => i.severity === 'error')) return out;

  const others = state.trips.filter((t) => t.id !== replaceId);
  if (others.some((t) => t.id === candidate.id)) out.push(err('DUPLICATE_ID', '같은 식별자의 일정이 이미 있습니다.'));

  for (const s of candidate.segments) {
    if (s.kind === 'leave' && !state.grants.some((g) => g.id === s.grantId)) {
      out.push(err('GRANT_MISSING', '선택한 휴가가 삭제되었거나 없습니다. 다시 선택해 주세요.'));
    }
  }
  if (out.some((i) => i.severity === 'error')) return out;

  if (isActiveTrip(candidate)) {
    if (others.some((t) => isActiveTrip(t) && tripsOverlap(t, candidate))) {
      out.push(err('TRIP_CONFLICT', '기존 일정과 겹칩니다. 기존 일정을 수정하거나 취소해 주세요'));
    }
    const next = { ...state, trips: [...others, candidate] };
    const touched = new Set(candidate.segments.filter((s) => s.kind === 'leave').map((s) => s.grantId));
    out.push(...dedupe(grantAllocationIssues(next, touched)));

    const visits = candidate.segments.filter((s) => s.kind === 'visit');
    if (visits.length) {
      if (visits.some((s) => compareDates(s.start, state.settings.visitBaselineAsOf) < 0)) {
        out.push(err('VISIT_BEFORE_BASELINE', `면회외출 시작 전 횟수(${koreanDate(state.settings.visitBaselineAsOf)} 기준)에 이미 포함된 기간입니다. 중복 집계를 막기 위해 기준일부터의 날짜만 기록할 수 있습니다.`));
      }
      const v = visitCounts(next);
      if (v.total > VISIT_PRINCIPLE_LIMIT) {
        out.push(issue('warning', 'VISIT_OVER_PRINCIPLE', `면회외출이 복무 중 ${VISIT_PRINCIPLE_LIMIT}회 한도를 넘습니다 (합계 ${v.total}회). 확인 후 저장할 수 있습니다.`));
      }
    }
  }
  if (isActiveTrip(candidate)) {
    const others2 = state.trips.filter((t) => t.id !== replaceId);
    const months = new Set(candidate.segments.filter((s) => s.kind === 'outing').map((s) => s.start.slice(0, 7)));
    for (const m of months) {
      const n = outingsInMonth([...others2, candidate], m);
      if (n > OUTING_MONTHLY_LIMIT) {
        out.push(issue('warning', 'OUTING_OVER_MONTHLY', `외출은 한 달에 ${OUTING_MONTHLY_LIMIT}회까지이고 남은 횟수는 다음 달로 넘어가지 않습니다 (${Number(m.slice(5))}월 ${n}회). 확인 후 저장할 수 있습니다.`));
      }
    }
  }
  out.push(...tripInfos(state, candidate));
  return out;
}

function dedupe(issues) {
  const seen = new Set();
  return issues.filter((i) => {
    const k = `${i.code}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 지급 건 추가·수정 */
export function validateGrantChange(state, candidate, replaceId = null) {
  const out = grantFieldIssues(candidate);
  if (out.length) return out;
  const others = state.grants.filter((g) => g.id !== replaceId);
  if (others.some((g) => g.id === candidate.id)) return [err('DUPLICATE_ID', '같은 식별자의 휴가가 이미 있습니다.')];
  if (replaceId && replaceId !== candidate.id && state.trips.some((t) => t.segments.some((s) => s.grantId === replaceId))) {
    return [err('GRANT_IN_USE', '일정에 연결된 휴가의 식별자는 바꿀 수 없습니다.')];
  }
  const next = { ...state, grants: [...others, candidate] };
  return dedupe(grantAllocationIssues(next, [candidate.id]));
}

/** 지급 건 삭제: 취소 일정 포함 어떤 일정이라도 참조하면 막는다. */
export function validateGrantDelete(state, id) {
  const users = state.trips.filter((t) => t.segments.some((s) => s.grantId === id));
  if (users.length) {
    return [err('GRANT_IN_USE', `이 휴가를 사용하는 일정 ${users.length}건이 있어 삭제할 수 없습니다. 먼저 해당 일정에서 다른 휴가로 바꾸거나 일정을 삭제해 주세요.`)];
  }
  return [];
}

/** 면회외출 시작 전 횟수 설정 */
export function validateSettings(state, settings, { version = 7 } = {}) {
  const out = [];
  if (!settings || typeof settings !== 'object') return [err('SETTINGS_SHAPE', '설정 형식이 올바르지 않습니다.')];
  if (version >= 5) {
    if (settings.shareId !== null && !(typeof settings.shareId === 'string' && SHARE_ID_RE.test(settings.shareId))) {
      out.push(err('SETTINGS_SHARE_ID', '공유 번호 형식이 올바르지 않습니다.', 'shareId'));
    }
    if (typeof settings.viewOnly !== 'boolean') out.push(err('SETTINGS_VIEW_ONLY', '보기 전용 설정 값이 올바르지 않습니다.', 'viewOnly'));
  }
  if (!Number.isInteger(settings.visitBaselineCount) || settings.visitBaselineCount < 0 || settings.visitBaselineCount > VISIT_BASELINE_MAX) {
    out.push(err('VISIT_BASELINE_COUNT', `시작 전 면회외출 횟수는 0~${VISIT_BASELINE_MAX} 사이 정수여야 합니다.`, 'visitBaselineCount'));
  } else if (settings.visitBaselineCount > VISIT_PRINCIPLE_LIMIT) {
    // 7회는 원칙일 뿐이라 예외로 더 다녀온 사람도 기록할 수 있어야 한다 (일정의 7회 초과 허용과 일치)
    out.push(issue('warning', 'VISIT_OVER_PRINCIPLE', `시작 전 횟수가 복무 중 총 ${VISIT_PRINCIPLE_LIMIT}회 한도를 넘습니다. 실제 다녀온 횟수가 맞으면 그대로 저장하세요.`, 'visitBaselineCount'));
  }
  if (!isDateOnly(settings.visitBaselineAsOf)) {
    out.push(err('VISIT_BASELINE_DATE', '기준일을 선택해 주세요.', 'visitBaselineAsOf'));
  } else {
    // 손상된 기록(일정 자리에 null 등)도 예외 없이 지나가야 복구 화면에 닿는다 — 형식이 깨진 일정은 건너뛴다
    const early = (Array.isArray(state.trips) ? state.trips : []).some((t) => t && typeof t === 'object' && Array.isArray(t.segments) && isActiveTrip(t)
      && t.segments.some((s) => s && typeof s === 'object' && s.kind === 'visit' && isDateOnly(s.start) && compareDates(s.start, settings.visitBaselineAsOf) < 0));
    if (early) out.push(err('VISIT_BEFORE_BASELINE', '기준일 이전 날짜의 면회외출 기록이 있습니다. 기준일을 그보다 앞당기거나 해당 기록을 취소·정리해 주세요.', 'visitBaselineAsOf'));
  }
  return out;
}


/* ---------------- 가점 ---------------- */

/**
 * 가점 형식·범위. stored=true(저장된 상태)면 기준이 있을 때 남은 가점이 기준보다 작아야 한다 — 바꿀 수 있는 가점은 저장 전에 전환된다.
 * 가점 시트의 입력 후보는 stored=false로 범위만 본다.
 * @returns {Issue[]}
 */
export function validateMerit(merit, { stored = true } = {}) {
  if (!exactKeys(merit, ['points', 'pointsPerDay'])) return [err('MERIT_SHAPE', '가점 형식이 올바르지 않습니다.')];
  const out = [];
  const { points, pointsPerDay } = merit;
  if (!Number.isInteger(points) || points < 0 || points > MERIT_POINTS_MAX) {
    out.push(err('MERIT_POINTS', `가점은 0~${MERIT_POINTS_MAX} 사이의 정수여야 합니다.`, 'points'));
  }
  if (pointsPerDay !== null && (!Number.isInteger(pointsPerDay) || pointsPerDay < 1 || pointsPerDay > MERIT_PER_DAY_MAX)) {
    out.push(err('MERIT_PER_DAY', `포상휴가 1일당 가점은 1~${MERIT_PER_DAY_MAX} 사이의 정수이거나 비워 두어야 합니다.`, 'pointsPerDay'));
  }
  if (stored && out.length === 0 && pointsPerDay !== null && points >= pointsPerDay) {
    out.push(err('MERIT_UNCONVERTED', '아직 휴가로 바꾸지 않은 가점이 기준 이상입니다.', 'points'));
  }
  return out;
}

/* ---------------- 정기휴가 자동 지급 기록 ---------------- */

/**
 * managed = 진급일 연동 중(휴가 kind가 계급과 같아야 함), fixed = 연동 멈춤(사용자가 종류를 바꿨을 수 있음),
 * suppressed = 사용자가 지움(grantId null). 문구에 식별자를 넣지 않는다.
 * @returns {Issue[]}
 */
export function validatePromotionGrants(pg, grants) {
  if (!exactKeys(pg, PROMOTION_KINDS)) return [err('PROMO_SHAPE', '정기휴가 자동 지급 기록 형식이 올바르지 않습니다.')];
  const out = [];
  const seen = new Set();
  for (const kind of PROMOTION_KINDS) {
    const e = pg[kind];
    if (e === null) continue;
    if (!exactKeys(e, ['grantId', 'status']) || !PROMOTION_STATUSES.includes(e.status) || !(e.grantId === null || typeof e.grantId === 'string')) {
      out.push(err('PROMO_SHAPE', '정기휴가 자동 지급 기록 형식이 올바르지 않습니다.'));
      continue;
    }
    if (e.status === 'suppressed') {
      if (e.grantId !== null) out.push(err('PROMO_REF', '지운 자동 정기휴가 기록이 올바르지 않습니다.'));
      continue;
    }
    // 휴가 항목이 망가진 기록(null 등)이어도 예외 없이 오류로 돌려준다
    const g = e.grantId === null ? null : grants.find((x) => x && typeof x === 'object' && x.id === e.grantId);
    if (!g) { out.push(err('PROMO_REF', '자동으로 넣은 정기휴가를 찾을 수 없습니다.')); continue; }
    if (seen.has(e.grantId)) out.push(err('PROMO_REF', '자동 정기휴가 기록이 같은 휴가를 두 번 가리킵니다.'));
    seen.add(e.grantId);
    if (e.status === 'managed' && g.kind !== kind) out.push(err('PROMO_REF', '진급일 연동 휴가의 종류가 계급과 다릅니다.'));
  }
  return out;
}

/* ---------------- 전체 상태 (저장·복원) ---------------- */

const STATE_KEYS_BY_VERSION = {
  1: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings'],
  2: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service'],
  3: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service', 'merit'],
  4: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service', 'merit', 'promotionGrants'],
  5: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service', 'merit', 'promotionGrants', 'received'],
  6: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service', 'merit', 'promotionGrants', 'received'],
  7: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service', 'merit', 'promotionGrants', 'received'],
};

const KEYS = {
  grant: ['id', 'kind', 'label', 'amount', 'balanceAsOf', 'availableFrom', 'expiresOn'],
  trip: ['id', 'title', 'status', 'segments', 'transport'],
  segment: ['id', 'kind', 'start', 'end', 'grantId'],
  transport: ['assessment', 'issued', 'validFrom', 'validTo', 'note'],
  settings: ['visitBaselineCount', 'visitBaselineAsOf'],
  received: ['senderId', 'nickname', 'color', 'receivedOn', 'issuedOn', 'items'],
  receivedItem: ['start', 'end', 'confirmed'],
};
/** 5판부터 일정에 shareConfirmed, 설정에 shareId·viewOnly가 있다. 이전 판 원본은 그 판의 키로 검증한다. */
const tripKeys = (version) => [...KEYS.trip, ...(version >= 5 ? ['shareConfirmed'] : []), ...(version >= 6 ? ['preparation'] : []), ...(version >= 7 ? ['performanceSource'] : [])];
const settingsKeys = (version) => (version >= 5 ? [...KEYS.settings, 'shareId', 'viewOnly'] : KEYS.settings);

/* ---------------- 받은 일정 (5판) ---------------- */

/**
 * 받은 일정 목록 검사. 잔여·겹침 계산과 무관한 표시용 기록이라 구조·한도만 본다.
 * @param {unknown} received
 * @param {{shareId?: string|null}} settings
 * @returns {Issue[]}
 */
export function validateReceived(received, settings) {
  if (!Array.isArray(received)) return [err('RECEIVED_SHAPE', '받은 일정 형식이 올바르지 않습니다.')];
  const out = [];
  if (received.length > RECEIVED_LIMIT) out.push(err('RECEIVED_LIMIT', `받은 일정은 ${RECEIVED_LIMIT}명까지 보관할 수 있습니다.`));
  const seen = new Set();
  for (const e of received) {
    if (!exactKeys(e, KEYS.received) || !Array.isArray(e.items) || !e.items.every((it) => exactKeys(it, KEYS.receivedItem))) {
      out.push(err('RECEIVED_SHAPE', '받은 일정 형식이 올바르지 않습니다.'));
      continue;
    }
    if (typeof e.senderId !== 'string' || !SHARE_ID_RE.test(e.senderId)) out.push(err('RECEIVED_SENDER', '받은 일정의 상대 번호가 올바르지 않습니다.'));
    else {
      if (settings?.shareId && e.senderId === settings.shareId) out.push(err('RECEIVED_SELF', '내 번호로 받은 일정이 들어 있습니다.'));
      if (seen.has(e.senderId)) out.push(err('DUPLICATE_ID', '같은 사람의 일정이 두 번 들어 있습니다.'));
      seen.add(e.senderId);
    }
    if (!isNonEmptyString(e.nickname, NICKNAME_LIMIT)) out.push(err('RECEIVED_NICKNAME', `별명을 1~${NICKNAME_LIMIT}자로 입력해 주세요.`, 'nickname'));
    if (!Number.isInteger(e.color) || e.color < 0 || e.color >= COLOR_SLOTS) out.push(err('RECEIVED_COLOR', '받은 일정의 색 값이 올바르지 않습니다.'));
    if (!isDateOnly(e.receivedOn) || !isDateOnly(e.issuedOn)) out.push(err('RECEIVED_DATE', '받은 일정의 날짜가 올바르지 않습니다.'));
    if (e.items.length < 1 || e.items.length > SHARE_ITEMS_LIMIT) {
      out.push(err('RECEIVED_ITEMS', `받은 일정은 한 사람당 1~${SHARE_ITEMS_LIMIT}건이어야 합니다.`));
      continue;
    }
    let bad = false;
    for (let i = 0; i < e.items.length; i += 1) {
      const it = e.items[i];
      if (!isDateOnly(it.start) || !isDateOnly(it.end) || typeof it.confirmed !== 'boolean' || compareDates(it.start, it.end) > 0) { bad = true; break; }
      if (i > 0 && compareDates(e.items[i - 1].end, it.start) >= 0) { bad = true; break; }
    }
    if (bad) out.push(err('RECEIVED_ITEMS', '받은 일정의 날짜 구간이 올바르지 않습니다.'));
  }
  return out;
}

function exactKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

/**
 * 외부 입력(unknown)을 전체 상태로 검증한다. error가 하나라도 있으면 사용하지 않는다.
 * version은 검증할 기록 판(1~7). 이행기는 1판 원본을 1판 규칙으로 먼저 검증한다.
 * @param {unknown} input
 * @param {{version?: 1|2|3|4|5|6|7}} [opts]
 * @returns {Issue[]}
 */
export function validateState(input, { version = 7 } = {}) {
  const stateKeys = STATE_KEYS_BY_VERSION[version];
  if (!stateKeys) throw new RangeError(`unsupported validation version: ${String(version)}`);
  if (!exactKeys(input, stateKeys)) return [err('STATE_SHAPE', '앱 기록 형식이 아닙니다.')];
  const s = /** @type {any} */ (input);
  if (s.schemaVersion !== version) return [err('SCHEMA_VERSION', '지원하지 않는 기록 버전입니다.')];
  if (typeof s.ruleVersion !== 'string' || s.ruleVersion.length > LIMITS.id) return [err('STATE_SHAPE', '규칙 버전 형식이 올바르지 않습니다.')];
  if (!Array.isArray(s.grants) || !Array.isArray(s.trips) || !exactKeys(s.settings, settingsKeys(version))) {
    return [err('STATE_SHAPE', '앱 기록 형식이 아닙니다.')];
  }

  const out = [];
  const grantIds = new Set();
  for (const g of s.grants) {
    if (!exactKeys(g, KEYS.grant)) { out.push(err('GRANT_SHAPE', '지급 건 형식이 올바르지 않습니다.')); continue; }
    out.push(...grantFieldIssues(g));
    if (grantIds.has(g.id)) out.push(err('DUPLICATE_ID', '같은 휴가 항목이 두 번 들어 있습니다.'));
    grantIds.add(g.id);
  }
  const tripIds = new Set();
  const segIds = new Set();
  for (const t of s.trips) {
    if (!exactKeys(t, tripKeys(version)) || !Array.isArray(t.segments) || !exactKeys(t.transport, KEYS.transport)
      || !t.segments.every((seg) => exactKeys(seg, KEYS.segment))) {
      out.push(err('TRIP_SHAPE', '일정 형식이 올바르지 않습니다.'));
      continue;
    }
    out.push(...tripFieldIssues(t, { version }));
    if (tripIds.has(t.id)) out.push(err('DUPLICATE_ID', '같은 일정이 두 번 들어 있습니다.'));
    tripIds.add(t.id);
    for (const seg of t.segments) {
      if (segIds.has(seg.id)) out.push(err('DUPLICATE_ID', '같은 일정 구간이 두 번 들어 있습니다.'));
    }
    for (const seg of t.segments) {
      segIds.add(seg.id);
      if (seg.kind === 'leave' && !grantIds.has(seg.grantId)) out.push(err('GRANT_MISSING', `없는 휴가를 참조하는 일정이 있습니다${typeof t.title === 'string' && t.title ? `: ${t.title}` : ''}`));
    }
  }
  out.push(...validateSettings(s, s.settings, { version }));
  if (version >= 5) out.push(...validateReceived(s.received, s.settings));
  if (version >= 2) out.push(...validateService(s.service));
  if (version >= 3) out.push(...validateMerit(s.merit));
  if (version >= 4 && Array.isArray(s.grants)) out.push(...validatePromotionGrants(s.promotionGrants, s.grants));
  if (out.some((i) => i.severity === 'error')) return dedupe(out);

  // 구조가 유효할 때만 상호 불변식 검사
  const active = s.trips.filter(isActiveTrip);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (tripsOverlap(active[i], active[j])) out.push(err('TRIP_CONFLICT', `날짜가 겹치는 일정이 있습니다: ${active[i].title} / ${active[j].title}`));
    }
  }
  out.push(...grantAllocationIssues(s, [...grantIds]));
  const v = visitCounts(s);
  if (v.total > VISIT_PRINCIPLE_LIMIT) {
    out.push(issue('warning', 'VISIT_OVER_PRINCIPLE', `면회외출이 복무 중 총 ${VISIT_PRINCIPLE_LIMIT}회 한도를 넘습니다 (합계 ${v.total}회).`));
  }
  const outingMonths = new Set(active.flatMap((t) => t.segments.filter((x) => x.kind === 'outing').map((x) => x.start.slice(0, 7))));
  for (const m of outingMonths) {
    const n = outingsInMonth(s.trips, m);
    if (n > OUTING_MONTHLY_LIMIT) out.push(issue('warning', 'OUTING_OVER_MONTHLY', `${m.slice(0, 4)}년 ${Number(m.slice(5))}월 외출이 ${n}회로 한 달 ${OUTING_MONTHLY_LIMIT}회를 넘습니다.`));
  }
  return dedupe(out);
}
