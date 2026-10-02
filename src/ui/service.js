// 복무 일정 화면: 설정의 '내 복무 정보' 입력 시트, 내 휴가의 복무 일정 카드, 진급 정기휴가 안내.
import { h, fill, issueList, shortDate, weekdayName } from './dom.js';
import { compareDates, isDateOnly, weekday } from '../domain/dates.js';
import { computeSchedule, validateService, PERFORMANCE_DAYS } from '../domain/service.js';

export const SERVICE_DATE_LABELS = Object.freeze({
  graduation: '수료일', privateFirst: '일병 진급일', corporal: '상병 진급일', sergeant: '병장 진급일', discharge: '전역일',
});
const DATE_KEYS = Object.keys(SERVICE_DATE_LABELS);
/** 진급 키 → 계급 이름과 정기휴가 종류 */
export const PROMOTIONS = Object.freeze([
  { key: 'privateFirst', rank: '일병', kind: 'regular-private-first' },
  { key: 'corporal', rank: '상병', kind: 'regular-corporal' },
  { key: 'sergeant', rank: '병장', kind: 'regular-sergeant' },
]);
const NIGHTS = { 3: '2박3일', 4: '3박4일', 6: '5박6일' };

/** '2026-04-10' → '2026.4.10 (금)' */
export function dotDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}.${m}.${d} (${weekdayName(weekday(date))})`;
}

function emptyService() {
  return { enlistDate: '', performanceCycleWeeks: 8, overrides: { graduation: null, privateFirst: null, corporal: null, sergeant: null, discharge: null }, lastPerformanceDays: null };
}

/** 계산 가능한(형식 오류 없는) 초안이면 일정, 아니면 null. 순서 오류는 계산은 하되 저장에서 막는다. */
function previewSchedule(draft, today) {
  if (!isDateOnly(draft.enlistDate)) return null;
  if (DATE_KEYS.some((k) => draft.overrides[k] !== null && !isDateOnly(draft.overrides[k]))) return null;
  try { return computeSchedule(draft, today); } catch { return null; }
}

/**
 * 내 복무 정보 입력 시트
 * @param {HTMLElement} root
 * @param {{service:any|null, today:string, onSave:(service:any, meta:{lastDaysSpan:string|null})=>{ok:boolean,issues?:any[],error?:string}, onClose:()=>void}} opts
 */
export function renderServiceForm(root, { service, today, onSave, onClose }) {
  const draft = service ? structuredClone(service) : emptyService();
  const pristine = JSON.stringify(draft);
  /** 직접 수정 입력칸을 연 날짜 */
  const editing = new Set(DATE_KEYS.filter((k) => draft.overrides[k] !== null));
  let issues = [];
  let error = '';
  const spanOf = (sch) => (sch?.lastPartial ? `${sch.lastPartial.start}~${sch.lastPartial.end}` : null);
  /** 지금 화면에 보이는 마지막 덜 찬 회차 기간 */
  let currentSpan = spanOf(previewSchedule(draft, today));
  /** 일수 값이 입력(또는 저장)될 때의 기간 — 컨트롤러가 기간이 달라졌는지 다시 확인한다. */
  let daysSpan = currentSpan;
  /** 기간이 바뀌어 일수를 비웠음 */
  let daysCleared = false;

  const datesBox = h('div', { class: 'svc-dates', 'aria-live': 'polite' });
  const out = h('div', { class: 'issue-box' });

  function renderDates(focusId) {
    const s = previewSchedule(draft, today);
    if (s) {
      const span = spanOf(s);
      if (span !== currentSpan) {
        currentSpan = span;
        if (draft.lastPerformanceDays !== null) { draft.lastPerformanceDays = null; daysCleared = true; }
      }
    }
    if (!s) {
      fill(datesBox, h('p', { class: 'muted small' }, '입대일을 넣으면 수료일·진급일·전역일·성과제 날짜를 계산해 보여 줍니다.'));
      return;
    }
    const rows = DATE_KEYS.map((key) => {
      const overridden = draft.overrides[key] !== null;
      const inputId = `svc-ov-${key}`;
      return h('li', { class: `svc-row${overridden ? ' is-overridden' : ''}`, 'data-testid': `svc-row-${key}` },
        h('div', { class: 'svc-row__main' },
          h('span', { class: 'svc-row__label' }, SERVICE_DATE_LABELS[key]),
          h('strong', { class: 'svc-row__date' }, dotDate(s[key])),
          overridden ? h('span', { class: 'chip chip--override' }, '직접 수정함') : null),
        overridden ? h('p', { class: 'muted small svc-row__calc' }, `계산값 ${dotDate(s.computed[key])}`) : null,
        editing.has(key)
          ? h('div', { class: 'svc-row__edit' },
            h('label', { for: inputId, class: 'sr-only' }, `${SERVICE_DATE_LABELS[key]} 직접 입력`),
            h('input', { id: inputId, type: 'date', value: draft.overrides[key] ?? s[key], onChange: (e) => {
              draft.overrides[key] = e.target.value || null;
              renderDates(inputId);
            } }),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'data-testid': `svc-reset-${key}`, onClick: () => {
              draft.overrides[key] = null;
              editing.delete(key);
              renderDates(`svc-edit-${key}`);
            } }, '계산값으로 되돌리기'))
          : h('button', { type: 'button', id: `svc-edit-${key}`, class: 'btn btn--ghost btn--small', 'data-testid': `svc-edit-${key}`, onClick: () => {
            editing.add(key);
            renderDates(inputId);
          } }, '직접 수정'));
    });
    const perfs = s.performances;
    const upcoming = perfs.filter((p) => compareDates(p.date, today) >= 0);
    const last = s.lastPartial;
    fill(datesBox,
      h('ul', { class: 'svc-list' }, rows),
      h('div', { class: 'svc-perf' },
        h('h3', { class: 'sub-title' }, `성과제외박 (${draft.performanceCycleWeeks}주마다 ${NIGHTS[PERFORMANCE_DAYS[draft.performanceCycleWeeks]]})`),
        h('p', { class: 'small' }, perfs.length
          ? `전역 전까지 ${perfs.length}회 생깁니다. ${upcoming.length ? `앞으로: ${upcoming.slice(0, 4).map((p) => shortDate(p.date)).join(', ')}${upcoming.length > 4 ? ' …' : ''}` : '남은 회차가 없습니다.'}`
          : '전역 전에 다 차는 회차가 없습니다.'),
        last ? h('div', { class: 'svc-last', 'data-testid': 'svc-last' },
          h('p', { class: 'small' }, `마지막 회차는 전역 전에 다 차지 않습니다 (${shortDate(last.start)}~${shortDate(last.end)}). 받는 일수를 부대에 확인해 입력하세요. `,
            h('b', null, draft.lastPerformanceDays === null ? '지금: 확인 필요' : draft.lastPerformanceDays === 0 ? '지금: 지급 없음' : `지금: ${draft.lastPerformanceDays}일`)),
          daysCleared && draft.lastPerformanceDays === null
            ? h('p', { class: 'form-error', role: 'status', 'data-testid': 'svc-last-reenter' }, '기간이 바뀌어 일수를 다시 입력해 주세요') : null,
          h('div', { class: 'field' },
            h('label', { for: 'svc-last-days' }, '마지막 성과제 일수 (빈칸 = 확인 필요, 0 = 지급 없음)'),
            h('input', { id: 'svc-last-days', type: 'number', inputmode: 'numeric', min: 0, max: 7, step: 1,
              value: draft.lastPerformanceDays ?? '', onChange: (e) => {
                const v = e.target.value.trim();
                draft.lastPerformanceDays = v === '' ? null : Number(v);
                daysSpan = currentSpan;
                renderDates('svc-last-days');
              } }))) : null));
    if (focusId) datesBox.querySelector(`#${CSS.escape(focusId)}`)?.focus();
  }

  const refreshIssues = () => fill(out, ...[issueList(issues, { id: 'svc-issues' }), error ? h('p', { class: 'form-error', role: 'alert' }, error) : null].filter(Boolean));

  const form = h('form', { class: 'sheet__body', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const candidate = structuredClone(draft);
    if (candidate.lastPerformanceDays !== null && !Number.isFinite(candidate.lastPerformanceDays)) candidate.lastPerformanceDays = NaN;
    const r = onSave(candidate, { lastDaysSpan: daysSpan });
    if (r.ok) return;
    issues = r.issues ?? [];
    error = r.error ?? '';
    refreshIssues();
    const target = out.querySelector('#svc-issues, .form-error');
    target?.setAttribute('tabindex', '-1');
    /** @type {HTMLElement|null} */ (target)?.focus();
  } },
  h('p', { class: 'small' }, '입대일과 성과제 주기를 넣으면 날짜를 계산합니다. 부대에서 받은 날짜가 다르면 그 날짜만 직접 고치세요.'),
  h('div', { class: 'field-row' },
    h('div', { class: 'field' }, h('label', { for: 'svc-enlist' }, '입대일'),
      h('input', { id: 'svc-enlist', type: 'date', value: draft.enlistDate, onInput: (e) => { draft.enlistDate = e.target.value; renderDates(); } })),
    h('div', { class: 'field' }, h('label', { for: 'svc-cycle' }, '성과제 주기'),
      h('select', { id: 'svc-cycle', onChange: (e) => { draft.performanceCycleWeeks = Number(e.target.value); renderDates(); } },
        [6, 8, 12].map((w) => h('option', { value: String(w), selected: w === draft.performanceCycleWeeks }, `${w}주 (${NIGHTS[PERFORMANCE_DAYS[w]]})`))))),
  datesBox,
  out,
  h('div', { class: 'sheet__actions' },
    h('button', { type: 'submit', class: 'btn btn--primary', 'data-testid': 'save-service' }, '저장'),
    h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기')));

  fill(root,
    h('header', { class: 'sheet__head' }, h('h2', null, '내 복무 정보'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    form);
  renderDates();
  form.querySelector('#svc-enlist').focus();
  return { isDirty: () => JSON.stringify(draft) !== pristine };
}

/** 저장 전 검증 (컨트롤러용 재노출) */
export { validateService };

function dday(date, today) {
  const n = compareDates(date, today);
  return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`;
}

/**
 * 내 휴가 → 복무 일정 카드. schedule이 null이면 입력 안내.
 * @param {HTMLElement} root
 */
export function renderServiceCard(root, { schedule, today, onEdit }) {
  fill(root, serviceCard({ schedule, today, onEdit }));
}

export function serviceCard({ schedule, today, onEdit }) {
  if (!schedule) {
    return h('section', { class: 'svc-card svc-card--empty', 'data-testid': 'service-card', 'aria-labelledby': 'svc-card-title' },
      h('h2', { id: 'svc-card-title', class: 'section-title' }, '복무 일정'),
      h('p', { class: 'small' }, '입대일을 넣으면 진급일·전역일·성과제외박 날짜를 계산해 달력에 표시합니다.'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: onEdit }, '입대일 입력'));
  }
  const nextPromo = PROMOTIONS.find((p) => compareDates(schedule[p.key], today) > 0);
  const discharged = schedule.rank === '전역';
  const perf = schedule.nextPerformance;
  const lastP = schedule.nextLastPartial;
  const item = (label, value, sub) => h('div', { class: 'svc-card__item' },
    h('span', null, label), h('strong', null, value), sub ? h('small', null, sub) : null);
  return h('section', { class: 'svc-card', 'data-testid': 'service-card', 'aria-labelledby': 'svc-card-title' },
    h('div', { class: 'svc-card__head' },
      h('h2', { id: 'svc-card-title', class: 'section-title' }, '복무 일정'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: onEdit }, '수정')),
    h('div', { class: 'svc-card__grid' },
      item('지금 계급', schedule.rank),
      discharged ? item('전역', '전역했습니다', shortDate(schedule.discharge))
        : item('전역', dday(schedule.discharge, today), dotDate(schedule.discharge)),
      nextPromo ? item(`${nextPromo.rank} 진급`, dday(schedule[nextPromo.key], today), dotDate(schedule[nextPromo.key])) : item('다음 진급', '없음'),
      perf ? item('다음 성과제', `${shortDate(perf.date)} (${perf.days}일)`, `${perf.n}회차 · ${dday(perf.date, today)}`)
        : lastP ? item('전역 전 마지막 성과제', `${shortDate(lastP.end)} (${lastDaysText(lastP.days)})`, `${schedule.performances.length + 1}회차 · ${dday(lastP.end, today)}`)
          : item('다음 성과제', '없음')));
}

/** 마지막 덜 찬 회차 일수 표시 */
export function lastDaysText(days) {
  return days === null ? '일수 확인 필요' : days === 0 ? '지급 없음' : `${days}일`;
}

/** 진급일이 됐는데 그 계급 정기휴가 지급 건이 없는 진급 목록 */
export function missingPromotionGrants(schedule, grants, today) {
  if (!schedule) return [];
  return PROMOTIONS.filter((p) => compareDates(schedule[p.key], today) <= 0 && !grants.some((g) => g.kind === p.kind));
}

/** 정기휴가 추가 안내 버튼들 */
export function promoButtons(missing, schedule, onAdd) {
  if (!missing.length) return null;
  return h('div', { class: 'promo-list' }, missing.map((p) => h('button', {
    type: 'button', class: 'btn btn--promo btn--block', 'data-testid': 'promo-grant', onClick: () => onAdd(p.kind),
  }, `${p.rank}으로 진급했어요(${shortDate(schedule[p.key])}) — ${p.rank} 정기휴가 추가`)));
}

/** 날짜별 복무 표식: date → [{mark, label, perf?}] */
export function serviceMarks(schedule) {
  const map = new Map();
  if (!schedule) return map;
  const add = (date, v) => { if (!map.has(date)) map.set(date, []); map.get(date).push(v); };
  for (const p of PROMOTIONS) add(schedule[p.key], { mark: '진', label: `${p.rank} 진급일`, kind: 'promo' });
  add(schedule.discharge, { mark: '전', label: '전역일', kind: 'discharge' });
  for (const p of schedule.performances) add(p.date, { mark: '성', label: `성과제외박 ${p.n}회차 생김 (${p.days}일)`, kind: 'perf', perf: p });
  // 마지막 덜 찬 회차: 전역일에 표식. 상세 설명은 달력 상세(serviceDetail)가 따로 보여 준다.
  if (schedule.lastPartial) add(schedule.lastPartial.end, { mark: '성', label: '전역 전 마지막 성과제', kind: 'perf', lastPartial: true });
  return map;
}
