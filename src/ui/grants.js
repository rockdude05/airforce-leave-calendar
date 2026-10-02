import { h, fill, formatDate, issueList } from './dom.js';
import { compareDates } from '../domain/dates.js';
import { GRANT_KINDS, GRANT_KIND_LABELS, REGULAR_GUIDE, VISIT_PRINCIPLE_LIMIT, newId } from '../domain/model.js';
import { LIMITS, VISIT_BASELINE_MAX } from '../domain/validation.js';
import { tripCard } from './calendar.js';
import { serviceCard, missingPromotionGrants, promoButtons } from './service.js';

const STATUS_LABEL = { active: '사용 가능', pending: '개시 전', expired: '만료' };

/**
 * 내 휴가 화면
 * @param {HTMLElement} root
 */
export function renderGrants(root, { state, balances, today, schedule = null, onEditGrant, onAddGrant, onEditVisits, onOpenTrip, onEditService, onPromoGrant }) {
  const v = balances.visits;
  const grantById = new Map(state.grants.map((g) => [g.id, g]));
  const sorted = [...state.grants].sort((a, b) => {
    const order = { active: 0, pending: 1, expired: 2 };
    // 같은 상태 안에서는 만료가 빠른 휴가부터 (기한 없는 휴가는 뒤로)
    return order[balances.byGrant[a.id].status] - order[balances.byGrant[b.id].status]
      || (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.balanceAsOf.localeCompare(b.balanceAsOf);
  });
  const kindTotals = kindSummary(state.grants, balances);

  const summary = h('section', { class: 'totals', 'aria-label': '휴가 합계' },
    h('div', { class: 'totals__item totals__item--main' },
      h('span', null, '오늘 기준 계획 후 잔여'), h('strong', null, `${balances.availableTodayAfterPlans}일`)),
    h('div', { class: 'totals__item' },
      h('span', null, '장부 잔여 (사용 후)'), h('strong', null, `${balances.ledgerRemaining}일`)),
    h('div', { class: 'totals__item' },
      h('span', null, '장부 잔여 (계획 후)'), h('strong', null, `${balances.ledgerAfterPlans}일`)),
    kindTotals.length ? h('p', { class: 'small totals__kinds', 'data-testid': 'kind-totals' },
      h('b', null, '종류별 계획 후 잔여 '), kindTotals.join(' · ')) : null,
    h('p', { class: 'muted small totals__note' }, '장부 잔여에는 아직 개시 전이거나 만료된 휴가도 포함됩니다. 달력 위 숫자는 오늘 쓸 수 있는 휴가만 더합니다.'));

  const list = state.grants.length
    ? h('ul', { class: 'grant-list' }, sorted.map((g) => {
      const b = balances.byGrant[g.id];
      return h('li', null, h('button', { type: 'button', class: `grant grant--${b.status}`, onClick: () => onEditGrant(g.id) },
        h('span', { class: 'grant__top' },
          h('strong', { class: 'grant__label' }, g.label),
          h('span', { class: 'grant__chips' }, expiryChip(b, today), h('span', { class: `chip chip--${b.status}` }, STATUS_LABEL[b.status]))),
        h('span', { class: 'grant__kind muted small' }, g.label === GRANT_KIND_LABELS[g.kind] ? '' : `${GRANT_KIND_LABELS[g.kind]} · `, windowText(b)),
        h('span', { class: 'grant__nums' },
          num('등록', g.amount), num('사용', b.used), num('사용 후', b.remaining), num('계획', b.planned), num('계획 후', b.afterPlans, true))));
    }))
    : h('div', { class: 'empty' },
      h('p', null, '아직 입력한 휴가가 없습니다.'),
      h('p', { class: 'muted small' }, '지금 실제로 쓸 수 있는 휴가부터 하나씩 입력하세요. 정기휴가 기준은 일병 10일, 상병 8일, 병장 10일이지만 아직 받지 않았거나 이미 쓴 몫은 넣지 않습니다.'));

  const cancelled = state.trips.filter((t) => t.status === 'cancelled');
  fill(root, 
    h('h1', { class: 'view-title' }, '내 휴가'),
    promoButtons(missingPromotionGrants(schedule, state.grants, today), schedule, (kind) => onPromoGrant?.(kind)),
    summary,
    serviceCard({ schedule, today, onEdit: onEditService }),
    h('section', { 'aria-labelledby': 'grants-title' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'grants-title', class: 'section-title' }, '보유 휴가'),
        h('button', { type: 'button', class: 'btn btn--primary btn--small', 'data-testid': 'add-grant', onClick: onAddGrant }, '휴가 추가')),
      list),
    h('section', { class: 'visits', 'aria-labelledby': 'visits-title' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'visits-title', class: 'section-title' }, '면회외출'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: onEditVisits }, '시작 횟수 수정')),
      h('div', { class: 'visit-meter', role: 'img', 'aria-label': `복무 중 ${VISIT_PRINCIPLE_LIMIT}회 중 사용 ${v.baseline + v.used}회, 계획 ${v.planned}회` },
        Array.from({ length: Math.max(VISIT_PRINCIPLE_LIMIT, v.total) }, (_, i) => {
          const used = i < v.baseline + v.used;
          const planned = !used && i < v.total;
          return h('span', { class: `visit-dot${used ? ' is-used' : ''}${planned ? ' is-planned' : ''}${i >= VISIT_PRINCIPLE_LIMIT ? ' is-over' : ''}` });
        })),
      h('p', { class: 'small' },
        `앱 시작 전 ${v.baseline}회 (${formatDate(state.settings.visitBaselineAsOf, { weekday: false, year: true })} 기준) + 사용완료 ${v.used}회 + 계획 ${v.planned}회 = ${v.total}회 / 원칙 ${VISIT_PRINCIPLE_LIMIT}회`),
      h('p', { class: 'muted small' }, '3개월에 1회가 원칙이지만 3개월을 세는 기준일은 부대 확인이 필요해 앱이 다음 가능일을 계산하지 않습니다. 방문자 정보는 기록하지 않습니다.')),
    cancelled.length ? h('section', { 'aria-labelledby': 'cancelled-title' },
      h('h2', { id: 'cancelled-title', class: 'section-title' }, '취소한 일정'),
      h('ul', { class: 'trip-list' }, cancelled.map((t) => tripCard(t, grantById, onOpenTrip)))) : null);
}

function windowText(b) {
  if (b.windowEnd) return `${formatDate(b.windowStart, { weekday: false })}~${formatDate(b.windowEnd, { weekday: false })} 사용`;
  return `${formatDate(b.windowStart, { weekday: false })}부터 사용`;
}

function num(label, value, strong = false) {
  return h('span', { class: `num${strong ? ' num--strong' : ''}${value < 0 ? ' num--neg' : ''}` }, h('small', null, label), h('b', null, `${value}`));
}

/**
 * 지급 건 입력 시트
 * @param {HTMLElement} root
 */
export function renderGrantForm(root, { grant, today, usage, initialKind, onSave, onDelete, onClose }) {
  const isNew = !grant;
  const startKind = initialKind && GRANT_KINDS.includes(initialKind) ? initialKind : 'regular-private-first';
  const draft = grant ? { ...grant } : { id: newId('g'), kind: startKind, label: GRANT_KIND_LABELS[startKind], amount: '', balanceAsOf: today, availableFrom: null, expiresOn: null };
  const pristine = JSON.stringify(draft);
  let labelTouched = !isNew;
  let error = '';
  let issues = [];
  const out = h('div', { class: 'issue-box' });
  const guide = h('p', { class: 'muted small', 'aria-live': 'polite' });

  const refresh = () => {
    const g = REGULAR_GUIDE[draft.kind];
    if (!isNew) guide.textContent = '';
    else if (g) guide.textContent = `부대 기준: ${GRANT_KIND_LABELS[draft.kind]} ${g}일. 이미 쓴 날을 뺀, 지금 남은 일수만 입력하세요. 진급해서 새로 받은 정기휴가는 기존 휴가를 고치지 말고 이렇게 새로 추가합니다.`;
    else guide.textContent = '포상·위로 등은 받은 휴가증 한 건마다 따로 입력하면 기한을 놓치지 않습니다.';
    fill(out, ...[issueList(issues, { id: 'grant-issues' }), error ? h('p', { class: 'form-error', role: 'alert' }, error) : null].filter(Boolean));
  };

  const form = h('form', { class: 'sheet__body', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const candidate = { ...draft, label: String(draft.label).trim(), amount: Number(draft.amount) };
    if (draft.amount === '' || !Number.isFinite(candidate.amount)) candidate.amount = NaN;
    const r = onSave(candidate, isNew ? null : grant.id);
    if (r.ok) return;
    issues = r.issues ?? [];
    error = r.error ?? '';
    refresh();
    out.querySelector('#grant-issues, .form-error')?.setAttribute('tabindex', '-1');
    out.querySelector('#grant-issues, .form-error')?.focus();
  } },
  h('div', { class: 'field' }, h('label', { for: 'g-kind' }, '종류'),
    h('select', { id: 'g-kind', onChange: (e) => {
      draft.kind = e.target.value;
      if (!labelTouched) { draft.label = GRANT_KIND_LABELS[draft.kind]; form.querySelector('#g-label').value = draft.label; }
      refresh();
    } }, GRANT_KINDS.map((k) => h('option', { value: k, selected: k === draft.kind }, GRANT_KIND_LABELS[k])))),
  guide,
  h('div', { class: 'field' }, h('label', { for: 'g-label' }, '이름'),
    h('input', { id: 'g-label', type: 'text', value: draft.label, maxlength: LIMITS.label, autocomplete: 'off', onInput: (e) => { draft.label = e.target.value; labelTouched = true; } })),
  // 수정 화면의 숫자는 '기준일 당시 일수'다. 지금 잔여를 넣으면 그 뒤 사용분이 두 번 빠지므로 분명히 구분한다.
  !isNew && usage ? h('div', { class: 'usage-box', 'data-testid': 'grant-usage' },
    h('p', { class: 'small' }, h('b', null, '지금 이 휴가: '),
      `기준일 이후 사용 ${usage.used}일 · 계획 ${usage.planned}일 → 사용 후 잔여 ${usage.remaining}일, 계획 후 ${usage.afterPlans}일`),
    h('p', { class: 'muted small' }, '아래 일수는 기준일 당시 일수입니다. 지금 남은 일수로 바꾸면 이미 쓴 날이 두 번 빠집니다. 일수가 잘못 입력됐을 때만 고치세요.')) : null,
  h('div', { class: 'field' }, h('label', { for: 'g-amount' }, isNew ? '남은 일수' : '기준일 당시 일수'),
    h('input', { id: 'g-amount', type: 'number', inputmode: 'numeric', min: 1, max: LIMITS.amount, step: 1, value: draft.amount, onInput: (e) => { draft.amount = e.target.value; } })),
  h('div', { class: 'field' }, h('label', { for: 'g-asof' }, '이 일수의 기준일'),
    h('input', { id: 'g-asof', type: 'date', value: draft.balanceAsOf, onInput: (e) => { draft.balanceAsOf = e.target.value || null; } }),
    h('p', { class: 'muted small' }, '그날 아침 기준으로 남아 있던 일수입니다. 오늘 이미 휴가를 썼다면 내일 날짜로 입력하세요. 이 날 이전 날짜에는 이 휴가를 배정할 수 없습니다.')),
  h('div', { class: 'field-row' },
    h('div', { class: 'field' }, h('label', { for: 'g-from' }, '사용 시작일 (선택)'),
      h('input', { id: 'g-from', type: 'date', value: draft.availableFrom ?? '', onInput: (e) => { draft.availableFrom = e.target.value || null; } })),
    h('div', { class: 'field' }, h('label', { for: 'g-exp' }, '만료일 (선택)'),
      h('input', { id: 'g-exp', type: 'date', value: draft.expiresOn ?? '', onInput: (e) => { draft.expiresOn = e.target.value || null; } }))),
  out,
  h('div', { class: 'sheet__actions' },
    h('button', { type: 'submit', class: 'btn btn--primary', 'data-testid': 'save-grant' }, isNew ? '휴가 추가' : '변경 저장'),
    h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기')),
  isNew ? null : h('div', { class: 'quick-actions' },
    h('button', { type: 'button', class: 'btn btn--danger-quiet', onClick: () => {
      if (!window.confirm(`'${grant.label}' 휴가를 삭제할까요?`)) return;
      const r = onDelete(grant.id);
      if (!r.ok) { issues = r.issues ?? []; error = r.error ?? ''; refresh(); }
    } }, '이 휴가 삭제')));

  fill(root, 
    h('header', { class: 'sheet__head' }, h('h2', null, isNew ? '보유 휴가 추가' : '휴가 수정'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    form);
  refresh();
  form.querySelector('#g-kind').focus();
  return { isDirty: () => JSON.stringify(draft) !== pristine };
}

/** 면회외출 시작 전 횟수 시트 */
export function renderVisitForm(root, { settings, onSave, onClose }) {
  const draft = { ...settings };
  const pristine = JSON.stringify(draft);
  const out = h('div', { class: 'issue-box' });
  const form = h('form', { class: 'sheet__body', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const r = onSave({ visitBaselineCount: draft.visitBaselineCount === '' ? NaN : Number(draft.visitBaselineCount), visitBaselineAsOf: draft.visitBaselineAsOf });
    if (!r.ok) fill(out, ...[issueList(r.issues ?? []), r.error ? h('p', { class: 'form-error', role: 'alert' }, r.error) : null].filter(Boolean));
  } },
  h('p', { class: 'small' }, '앱을 쓰기 전에 이미 다녀온 면회외출 횟수를 입력하세요. 기준일 이전 면회외출은 이 숫자에만 포함되고, 기준일부터는 달력 기록으로 셉니다.'),
  h('div', { class: 'field' }, h('label', { for: 'v-count' }, '이미 다녀온 횟수'),
    h('input', { id: 'v-count', type: 'number', inputmode: 'numeric', min: 0, max: VISIT_BASELINE_MAX, step: 1, value: draft.visitBaselineCount, onInput: (e) => { draft.visitBaselineCount = e.target.value; } })),
  h('div', { class: 'field' }, h('label', { for: 'v-asof' }, '기준일'),
    h('input', { id: 'v-asof', type: 'date', value: draft.visitBaselineAsOf, onInput: (e) => { draft.visitBaselineAsOf = e.target.value; } })),
  out,
  h('div', { class: 'sheet__actions' },
    h('button', { type: 'submit', class: 'btn btn--primary' }, '저장'),
    h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기')));
  fill(root, 
    h('header', { class: 'sheet__head' }, h('h2', null, '면회외출 시작 횟수'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    form);
  form.querySelector('#v-count').focus();
  return { isDirty: () => JSON.stringify(draft) !== pristine };
}

/** 쓸 수 있는데 남은 휴가에 만료가 다가오면 D-n 표시 (30일 이내는 강조) */
function expiryChip(b, today) {
  if (b.status !== 'active' || !b.windowEnd || b.afterPlans <= 0) return null;
  const days = compareDates(b.windowEnd, today);
  return h('span', { class: `chip chip--expiry${days <= 30 ? ' is-soon' : ''}`, 'data-testid': 'expiry-chip' }, days === 0 ? '오늘 만료' : `만료 D-${days}`);
}

/** 종류별(정기는 계급 합산) 계획 후 잔여 — 만료된 휴가 제외 */
function kindSummary(grants, balances) {
  const totals = new Map();
  for (const g of grants) {
    const b = balances.byGrant[g.id];
    if (b.status === 'expired') continue;
    const key = g.kind.startsWith('regular') ? '정기' : GRANT_KIND_LABELS[g.kind];
    totals.set(key, (totals.get(key) ?? 0) + b.afterPlans);
  }
  return [...totals].map(([k, n]) => `${k} ${n}일`);
}
