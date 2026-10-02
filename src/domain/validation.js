import { compareDates, isDateOnly, addDays } from './dates.js';
import {
  GRANT_KINDS, SEGMENT_KINDS, TRIP_STATUSES, TRANSPORT_ASSESSMENTS, SEGMENT_KIND_LABELS, VISIT_PRINCIPLE_LIMIT,
} from './model.js';
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

/** 일정 단독 구조 검사 (다른 일정·지급 건과 무관) */
export function tripFieldIssues(t) {
  if (!t || typeof t !== 'object') return [err('TRIP_SHAPE', '일정 형식이 올바르지 않습니다.')];
  const out = [];
  if (!isId(t.id)) out.push(err('ID_INVALID', '일정 식별자가 올바르지 않습니다.'));
  if (!isNonEmptyString(t.title, LIMITS.title)) out.push(err('TITLE_REQUIRED', `제목을 1~${LIMITS.title}자로 입력해 주세요.`, 'title'));
  if (!TRIP_STATUSES.includes(t.status)) out.push(err('TRIP_STATUS', '일정 상태가 올바르지 않습니다.'));
  out.push(...transportIssues(t.transport));
  if (!Array.isArray(t.segments) || t.segments.length === 0) {
    out.push(err('SEGMENTS_REQUIRED', '날짜 구간을 하나 이상 추가해 주세요.'));
    return out;
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

/** 후급·결합 등 확인 필요 안내 (자동 판정 아님) */
function tripInfos(state, t) {
  const out = [];
  const kinds = new Set(t.segments.map((s) => s.kind));
  if (kinds.has('visit')) {
    out.push(issue('info', 'VISIT_CYCLE_UNCONFIRMED', '면회외출 3개월 주기의 기준일은 부대 확인이 필요합니다. 앱은 다음 가능일을 계산하지 않습니다.'));
  }
  if (kinds.has('leave') && kinds.has('performance')) {
    out.push(issue('info', 'COMBINATION_UNCONFIRMED', '휴가와 성과제외박을 이어 쓰는 조건은 부대 확인이 필요합니다.'));
  }
  const grantKinds = new Set(
    t.segments.filter((s) => s.kind === 'leave').map((s) => state.grants.find((g) => g.id === s.grantId)?.kind).filter(Boolean),
  );
  if (grantKinds.size > 1) {
    out.push(issue('info', 'MIXED_LEAVE_UNCONFIRMED', '여러 종류 휴가를 이어 쓸 때의 후급 조건은 부대 확인이 필요합니다.'));
  }
  if ((kinds.has('leave') || kinds.has('performance')) && t.transport?.assessment === 'unknown') {
    out.push(issue('info', 'TRANSPORT_UNCONFIRMED', '후급 가능 여부: 확인 필요. 부대에 확인한 뒤 직접 기록해 주세요.'));
  }
  return out;
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
          out.push(err('GRANT_OUT_OF_WINDOW', `'${g.label}'은 ${w.start}${w.end ? `~${w.end}` : ' 이후'}에만 배정할 수 있습니다.`));
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
        out.push(err('VISIT_BEFORE_BASELINE', `면회외출 시작 전 횟수(${state.settings.visitBaselineAsOf} 기준)에 이미 포함된 기간입니다. 중복 집계를 막기 위해 기준일부터의 날짜만 기록할 수 있습니다.`));
      }
      const v = visitCounts(next);
      if (v.total > VISIT_PRINCIPLE_LIMIT) {
        out.push(issue('warning', 'VISIT_OVER_PRINCIPLE', `면회외출이 복무 중 ${VISIT_PRINCIPLE_LIMIT}회 원칙을 넘습니다 (합계 ${v.total}회). 확인 후 저장할 수 있습니다.`));
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
export function validateSettings(state, settings) {
  const out = [];
  if (!settings || typeof settings !== 'object') return [err('SETTINGS_SHAPE', '설정 형식이 올바르지 않습니다.')];
  if (!Number.isInteger(settings.visitBaselineCount) || settings.visitBaselineCount < 0 || settings.visitBaselineCount > VISIT_BASELINE_MAX) {
    out.push(err('VISIT_BASELINE_COUNT', `시작 전 면회외출 횟수는 0~${VISIT_BASELINE_MAX} 사이 정수여야 합니다.`, 'visitBaselineCount'));
  } else if (settings.visitBaselineCount > VISIT_PRINCIPLE_LIMIT) {
    // 7회는 원칙일 뿐이라 예외로 더 다녀온 사람도 기록할 수 있어야 한다 (일정의 7회 초과 허용과 일치)
    out.push(issue('warning', 'VISIT_OVER_PRINCIPLE', `시작 전 횟수가 복무 중 ${VISIT_PRINCIPLE_LIMIT}회 원칙을 넘습니다. 실제 다녀온 횟수가 맞으면 그대로 저장하세요.`, 'visitBaselineCount'));
  }
  if (!isDateOnly(settings.visitBaselineAsOf)) {
    out.push(err('VISIT_BASELINE_DATE', '기준일을 선택해 주세요.', 'visitBaselineAsOf'));
  } else {
    const early = state.trips.some((t) => isActiveTrip(t) && t.segments.some((s) => s.kind === 'visit' && compareDates(s.start, settings.visitBaselineAsOf) < 0));
    if (early) out.push(err('VISIT_BEFORE_BASELINE', '기준일 이전 날짜의 면회외출 기록이 있습니다. 기준일을 그보다 앞당기거나 해당 기록을 취소·정리해 주세요.', 'visitBaselineAsOf'));
  }
  return out;
}


/* ---------------- 전체 상태 (저장·복원) ---------------- */

const STATE_KEYS_BY_VERSION = {
  1: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings'],
  2: ['schemaVersion', 'ruleVersion', 'grants', 'trips', 'settings', 'service'],
};

const KEYS = {
  grant: ['id', 'kind', 'label', 'amount', 'balanceAsOf', 'availableFrom', 'expiresOn'],
  trip: ['id', 'title', 'status', 'segments', 'transport'],
  segment: ['id', 'kind', 'start', 'end', 'grantId'],
  transport: ['assessment', 'issued', 'validFrom', 'validTo', 'note'],
  settings: ['visitBaselineCount', 'visitBaselineAsOf'],
};

function exactKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

/**
 * 외부 입력(unknown)을 전체 상태로 검증한다. error가 하나라도 있으면 사용하지 않는다.
 * version은 검증할 기록 판(1 또는 2). 이행기는 1판 원본을 1판 규칙으로 먼저 검증한다.
 * @param {unknown} input
 * @param {{version?: 1|2}} [opts]
 * @returns {Issue[]}
 */
export function validateState(input, { version = 2 } = {}) {
  const stateKeys = STATE_KEYS_BY_VERSION[version];
  if (!stateKeys) throw new RangeError(`unsupported validation version: ${String(version)}`);
  if (!exactKeys(input, stateKeys)) return [err('STATE_SHAPE', '앱 기록 형식이 아닙니다.')];
  const s = /** @type {any} */ (input);
  if (s.schemaVersion !== version) return [err('SCHEMA_VERSION', `지원하지 않는 기록 버전입니다 (${String(s.schemaVersion)}).`)];
  if (typeof s.ruleVersion !== 'string' || s.ruleVersion.length > LIMITS.id) return [err('STATE_SHAPE', '규칙 버전 형식이 올바르지 않습니다.')];
  if (!Array.isArray(s.grants) || !Array.isArray(s.trips) || !exactKeys(s.settings, KEYS.settings)) {
    return [err('STATE_SHAPE', '앱 기록 형식이 아닙니다.')];
  }

  const out = [];
  const grantIds = new Set();
  for (const g of s.grants) {
    if (!exactKeys(g, KEYS.grant)) { out.push(err('GRANT_SHAPE', '지급 건 형식이 올바르지 않습니다.')); continue; }
    out.push(...grantFieldIssues(g));
    if (grantIds.has(g.id)) out.push(err('DUPLICATE_ID', `지급 건 식별자 중복: ${g.id}`));
    grantIds.add(g.id);
  }
  const tripIds = new Set();
  const segIds = new Set();
  for (const t of s.trips) {
    if (!exactKeys(t, KEYS.trip) || !Array.isArray(t.segments) || !exactKeys(t.transport, KEYS.transport)
      || !t.segments.every((seg) => exactKeys(seg, KEYS.segment))) {
      out.push(err('TRIP_SHAPE', '일정 형식이 올바르지 않습니다.'));
      continue;
    }
    out.push(...tripFieldIssues(t));
    if (tripIds.has(t.id)) out.push(err('DUPLICATE_ID', `일정 식별자 중복: ${t.id}`));
    tripIds.add(t.id);
    for (const seg of t.segments) {
      if (segIds.has(seg.id)) out.push(err('DUPLICATE_ID', `구간 식별자 중복: ${seg.id}`));
    }
    for (const seg of t.segments) {
      segIds.add(seg.id);
      if (seg.kind === 'leave' && !grantIds.has(seg.grantId)) out.push(err('GRANT_MISSING', `없는 휴가를 참조하는 일정이 있습니다: ${t.title}`));
    }
  }
  out.push(...validateSettings(s, s.settings));
  if (version >= 2) out.push(...validateService(s.service));
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
    out.push(issue('warning', 'VISIT_OVER_PRINCIPLE', `면회외출이 복무 중 ${VISIT_PRINCIPLE_LIMIT}회 원칙을 넘습니다 (합계 ${v.total}회).`));
  }
  return dedupe(out);
}
