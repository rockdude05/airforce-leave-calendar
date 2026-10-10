import { h, fill, add, formatDate, issueList, shortDate } from './dom.js';
import { addDays, inclusiveDays, isDateOnly, compareDates, seoulToday } from '../domain/dates.js';
import { SEGMENT_KIND_LABELS, TRIP_STATUS_LABELS, emptyTransport, newId } from '../domain/model.js';
import { validateTrip, LIMITS, transportRule, TRANSPORT_RULE_TEXT } from '../domain/validation.js';
import { calculateBalances, inGrantWindow } from '../domain/balances.js';
import { preparationContext, normalizePreparation } from '../domain/preparation.js';
import { createPreparationPanel } from './preparation.js';
import { planLabel, planSummaryText } from './plan.js';
import { ISSUE_TOPIC } from '../feedback.js';

/**
 * 일정 편집 시트. 저장은 컨트롤러(onSave)가 검증·저장 성공을 확인한 뒤에만 닫힌다.
 * @param {HTMLElement} root
 * @param {{state:any,today:string,trip:any|null,startDate?:string,
 *   draft?:{kind:string,grantId:string|null,start:string,end:string,title?:string},
 *   onSave:(trip:any, replaceId:string|null, opts:{confirmed:boolean})=>{ok:boolean,issues?:any[],error?:string},
 *   onDelete:(id:string)=>{ok:boolean,error?:string}, onClose:()=>void}} opts
 * @returns {{isDirty:()=>boolean,refreshDate:()=>void}}
 */
export function renderTripEditor(root, opts) {
  const { state, today } = opts;
  const isNew = !opts.trip;
  const original = opts.trip ? structuredClone(opts.trip) : null;
  const draft = opts.trip ? structuredClone(opts.trip) : opts.draft ? tripFromDraft(opts.draft) : newTrip(state, today, opts.startDate ?? today);
  const pristine = JSON.stringify(draft);
  let preparationBasis = preparationContext(draft.segments)?.basis ?? null;
  let attempted = false;
  let confirmWarnings = false;
  let saveError = '';
  /** 빠른 동작(사용완료·취소·되돌리기)이 거부됐을 때 그 결과. 다음 입력에서 지운다. */
  let quickIssues = null;
  // 후급 확인은 그 당시 일정 구성에 대한 것이다. 날짜·휴가 구성이 바뀌면 '확인 필요'로 되돌린다.
  const originalSegments = original ? JSON.stringify(original.segments) : null;
  let transportReset = false;

  const titleId = 'trip-editor-title';
  const form = h('form', { class: 'sheet__body', novalidate: true, 'aria-labelledby': titleId });
  const segBox = h('div', { class: 'segments' });
  const summaryBox = h('div', { class: 'trip-summary', 'aria-live': 'polite' });
  const issueBox = h('div', { class: 'issue-box' });
  const transportBox = h('div');
  const preparation = createPreparationPanel({ trip: draft, grants: state.grants, getToday: seoulToday, onAsk: opts.onAsk,
    onToggle: (id, checked) => {
      draft.preparation = checked ? [...draft.preparation, id] : draft.preparation.filter(key => key !== id);
      update();
    },
  });
  function syncPreparation() {
    const basis = preparationContext(draft.segments)?.basis;
    const reset = Boolean(basis && preparationBasis && basis !== preparationBasis);
    if (reset) draft.preparation = [];
    if (basis) preparationBasis = basis;
    preparation.refresh({ resetNotice: reset });
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  function balancesExcludingSelf() {
    const others = { ...state, trips: state.trips.filter((t) => t.id !== original?.id) };
    return calculateBalances(others, today).byGrant;
  }

  /** 휴가 선택지: 오늘이 아니라 이 구간 날짜 기준으로 쓸 수 있는지·이유를 보여 준다 */
  function grantOptions(selected, seg) {
    const byGrant = balancesExcludingSelf();
    const date = isDateOnly(seg.start) ? seg.start : today;
    // 이름이 같은 휴가(예: 가점 전환 포상 여러 건)는 기준일·순번으로 구별한다
    const twinNo = new Map();
    const byLabel = new Map();
    for (const g of state.grants) byLabel.set(g.label, [...(byLabel.get(g.label) ?? []), g]);
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      [...group].sort((a, b) => a.balanceAsOf.localeCompare(b.balanceAsOf) || a.id.localeCompare(b.id))
        .forEach((g, i) => twinNo.set(g.id, i + 1));
    }
    return [
      h('option', { value: '' }, '휴가 선택'),
      ...sortForDate(state.grants, date).map((g) => {
        const b = byGrant[g.id];
        const twin = twinNo.get(g.id);
        let note = '';
        if (compareDates(date, b.windowStart) < 0) note = ` · ${shortDate(b.windowStart)}부터 사용`;
        else if (b.windowEnd && compareDates(date, b.windowEnd) > 0) note = ' · 이 날짜엔 만료';
        else if (b.windowEnd) note = ` · ${shortDate(b.windowEnd)}까지`;
        const name = twin ? `${g.label} ${twin} · ${shortDate(g.balanceAsOf)} 기준` : g.label;
        return h('option', { value: g.id, selected: g.id === selected }, `${name} (계획 후 ${b.afterPlans}일${note})`);
      }),
    ];
  }

  function renderSegments(focusKey) {
    const rows = draft.segments.map((s, idx) => {
      const single = s.kind === 'visit' || s.kind === 'outing';
      const days = isDateOnly(s.start) && isDateOnly(s.end) && compareDates(s.end, s.start) >= 0 ? inclusiveDays(s.start, s.end) : null;
      const fid = (k) => `seg-${s.id}-${k}`;
      return h('fieldset', { class: `segment segment--${s.kind}`, 'data-seg': s.id },
        h('legend', null, `구간 ${idx + 1}`, days ? h('span', { class: 'segment__days' }, ` · ${days}일`) : null),
        h('div', { class: 'field' },
          h('label', { for: fid('kind') }, '종류'),
          h('select', { id: fid('kind'), 'data-focus': `${s.id}-kind`, onChange: (e) => {
            s.kind = e.target.value;
            if (s.kind === 'leave') s.grantId = s.grantId ?? defaultGrantId(state, s.start);
            else s.grantId = null;
            if (s.kind === 'visit' || s.kind === 'outing') s.end = s.start;
            renderSegments(`${s.id}-kind`);
            update();
          } }, Object.entries(SEGMENT_KIND_LABELS).map(([v, label]) => h('option', { value: v, selected: v === s.kind }, label)))),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' },
            h('label', { for: fid('start') }, single ? '날짜' : '시작'),
            h('input', { id: fid('start'), type: 'date', value: s.start, required: true, onInput: (e) => {
              s.start = e.target.value;
              // 날짜가 바뀌면 휴가 선택지의 '사용 가능 여부' 설명도 그 날짜 기준으로 다시 쓴다
              const grantSel = form.querySelector(`#${CSS.escape(fid('grant'))}`);
              if (grantSel) fill(grantSel, ...grantOptions(s.grantId, s));
              if (single || (isDateOnly(s.end) && isDateOnly(s.start) && compareDates(s.end, s.start) < 0)) {
                s.end = s.start;
                const endEl = form.querySelector(`#${CSS.escape(fid('end'))}`);
                if (endEl) endEl.value = s.end;
              }
              update();
            } })),
          single ? null : h('div', { class: 'field' },
            h('label', { for: fid('end') }, '끝 (포함)'),
            h('input', { id: fid('end'), type: 'date', value: s.end, required: true, onInput: (e) => { s.end = e.target.value; update(); } }))),
        s.kind === 'leave'
          ? h('div', { class: 'field' },
            h('label', { for: fid('grant') }, '사용할 휴가'),
            state.grants.length
              ? h('select', { id: fid('grant'), onChange: (e) => { s.grantId = e.target.value || null; update(); } }, grantOptions(s.grantId, s))
              : h('p', { class: 'muted' }, '먼저 내 휴가 화면에서 보유 휴가를 입력해 주세요.'))
          : h('p', { class: 'segment__note' }, s.kind === 'performance' ? '성과제외박은 휴가 일수를 차감하지 않고 기록만 합니다.' : `${SEGMENT_KIND_LABELS[s.kind]}은 하루 단위 단독 일정입니다. 휴가 일수를 차감하지 않습니다.`),
        draft.segments.length > 1
          ? h('button', { type: 'button', class: 'btn btn--small btn--quiet', onClick: () => {
            draft.segments.splice(idx, 1);
            renderSegments();
            update();
          } }, `구간 ${idx + 1} 빼기`)
          : null);
    });
    const last = draft.segments.at(-1);
    const canChain = last && isDateOnly(last.end) && !draft.segments.some((s) => s.kind === 'visit' || s.kind === 'outing');
    fill(segBox, ...rows,
      canChain ? h('button', { type: 'button', class: 'btn btn--ghost btn--block', 'data-testid': 'chain-segment', onClick: () => {
        const start = addDays(last.end, 1);
        const seg = { id: newId('s'), kind: 'leave', start, end: start, grantId: otherGrantId(state, start, last.grantId) };
        draft.segments.push(seg);
        renderSegments(`${seg.id}-kind`);
        update();
      } }, `${formatDate(addDays(last.end, 1))}부터 이어서 구간 추가`) : null);
    if (focusKey) form.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function renderTransport() {
    const show = draft.segments.some((s) => s.kind === 'leave' || s.kind === 'performance');
    if (!show) { transportBox.replaceChildren(); return; }
    const tr = draft.transport;
    const radio = (value, label) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'assessment', value, checked: tr.assessment === value, onChange: () => { tr.assessment = value; update(); } }),
      h('span', null, label));
    fill(transportBox, h('fieldset', { class: 'transport' },
      h('legend', null, '후급(교통비) 기록'),
      h('p', { class: `small transport-rule transport-rule--${transportRule(state, draft) ?? 'none'}`, 'data-testid': 'transport-rule' }, TRANSPORT_RULE_TEXT[transportRule(state, draft)] ?? ''),
      transportReset ? h('p', { class: 'issue issue--warning', 'data-testid': 'transport-reset' }, '일정 날짜나 휴가 구성이 바뀌어 후급 확인을 "확인 필요"로 되돌렸습니다. 발급 기록과 메모는 그대로 두었습니다. 바뀐 일정으로 다시 확인해 주세요.') : null,
      h('div', { class: 'choices' },
        radio('unknown', '확인 필요'), radio('confirmed-eligible', '직접 확인: 해당'), radio('confirmed-ineligible', '직접 확인: 해당 없음')),
      h('label', { class: 'choice' },
        h('input', { type: 'checkbox', checked: tr.issued, onChange: (e) => { tr.issued = e.target.checked; update(); } }),
        h('span', null, '후급증을 실제로 받았음')),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'tr-from' }, '사용 가능 시작'),
          h('input', { id: 'tr-from', type: 'date', value: tr.validFrom ?? '', onInput: (e) => { tr.validFrom = e.target.value || null; update(); } })),
        h('div', { class: 'field' }, h('label', { for: 'tr-to' }, '사용 가능 끝'),
          h('input', { id: 'tr-to', type: 'date', value: tr.validTo ?? '', onInput: (e) => { tr.validTo = e.target.value || null; update(); } }))),
      h('div', { class: 'field' }, h('label', { for: 'tr-note' }, '메모'),
        h('textarea', { id: 'tr-note', rows: 2, maxlength: LIMITS.note, onInput: (e) => { tr.note = e.target.value; update(); } }, tr.note))));
  }

  function currentIssues() {
    const candidate = normalized();
    let issues = validateTrip(state, candidate, original?.id ?? null);
    if (!attempted) issues = issues.filter((i) => i.code !== 'TITLE_REQUIRED');
    return issues;
  }

  function normalized() {
    return { ...draft, title: draft.title.trim(), performanceSource: draft.segments.some(s => s.kind === 'performance') ? draft.performanceSource ?? null : null, shareConfirmed: draft.shareConfirmed ?? false, preparation: preparationContext(draft.segments) ? normalizePreparation(draft.preparation, draft.segments) : [...draft.preparation] };
  }

  function update(keepQuick = false) {
    opts.onRefreshDate?.();
    syncPreparation();
    if (!keepQuick) quickIssues = null;
    if (!transportReset && originalSegments && original.transport.assessment !== 'unknown'
      && JSON.stringify(draft.segments) !== originalSegments) {
      transportReset = true;
      draft.transport.assessment = 'unknown';
      lastTransportVisible = null; // 후급 영역을 다시 그린다
    }
    const leaveDays = draft.segments
      .filter((s) => s.kind === 'leave' && isDateOnly(s.start) && isDateOnly(s.end) && compareDates(s.end, s.start) >= 0)
      .reduce((n, s) => n + inclusiveDays(s.start, s.end), 0);
    fill(summaryBox, 
      h('span', null, '휴가 차감'), h('strong', { 'data-testid': 'trip-leave-days' }, `${leaveDays}일`),
      h('span', { class: 'muted small' }, draft.status === 'planned' ? '계획으로 저장하면 계획 후 잔여에서 빠집니다.' : draft.status === 'completed' ? '사용완료로 저장하면 사용 후 잔여에서 빠집니다.' : '취소된 일정은 차감하지 않습니다.'));
    const issues = quickIssues ?? currentIssues();
    const warnings = issues.filter((i) => i.severity === 'warning');
    if (!warnings.length) confirmWarnings = false;
    fill(issueBox,
      ...[issueList(issues, { id: 'trip-issues', onAsk: (code) => {
        const rule = ISSUE_TOPIC[code];
        return rule ? () => opts.onAsk?.(rule, '질문') : null;
      } }),
        warnings.length ? h('label', { class: 'choice choice--confirm' },
          h('input', { type: 'checkbox', 'data-testid': 'confirm-warning', checked: confirmWarnings, onChange: (e) => { confirmWarnings = e.target.checked; } }),
          h('span', null, '위 확인 필요 내용을 읽었고 그래도 저장합니다')) : null,
        saveError ? h('p', { class: 'form-error', role: 'alert' }, saveError) : null].filter(Boolean));
    renderTransportIfNeeded();
  }

  let lastTransportVisible = null;
  function renderTransportIfNeeded() {
    const visible = draft.segments.some((s) => s.kind === 'leave' || s.kind === 'performance');
    if (visible !== lastTransportVisible) { lastTransportVisible = visible; renderTransport(); }
    // 후급 판정 문구는 휴가 종류·구간이 바뀔 때마다 갱신한다
    const ruleEl = transportBox.querySelector('[data-testid="transport-rule"]');
    if (ruleEl) {
      const rule = transportRule(state, draft);
      ruleEl.textContent = TRANSPORT_RULE_TEXT[rule] ?? '';
      ruleEl.className = `small transport-rule transport-rule--${rule ?? 'none'}`;
    }
  }

  function save(statusOverride) {
    saveError = '';
    syncPreparation();
    // 빠른 동작은 편집 중인 내용이 아니라 저장된 일정의 상태만 바꾼다. 편집 중이면 먼저 확인한다.
    if (statusOverride && JSON.stringify(draft) !== pristine
      && !window.confirm('수정 중인 내용은 저장되지 않고 상태만 바뀝니다. 계속할까요? (수정 내용까지 저장하려면 위 상태를 고른 뒤 \'변경 저장\'을 누르세요)')) return;
    if (!statusOverride) attempted = true;
    const candidate = statusOverride ? { ...original, status: statusOverride } : normalized();
    const result = opts.onSave(candidate, original?.id ?? null, { confirmed: confirmWarnings });
    if (result.ok) return;
    if (result.error) saveError = result.error;
    // 빠른 동작의 오류·경고는 편집 초안이 아니라 실제로 검사한 후보 기준으로 보여준다.
    quickIssues = statusOverride ? (result.issues ?? []) : null;
    update(Boolean(statusOverride));
    if (result.issues) {
      const list = issueBox.querySelector('#trip-issues');
      list?.setAttribute('tabindex', '-1');
      list?.focus();
    }
  }

  const statusRadio = (value) => h('label', { class: 'seg-ctrl__opt' },
    h('input', { type: 'radio', name: 'status', value, checked: draft.status === value, onChange: () => { draft.status = value; update(); } }),
    h('span', null, TRIP_STATUS_LABELS[value]));

  const quick = original ? h('div', { class: 'quick-actions' },
    original.status === 'planned' ? h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'mark-completed', onClick: () => save('completed') }, '사용완료로 표시') : null,
    original.status !== 'cancelled' ? h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'cancel-trip', onClick: () => save('cancelled') }, '일정 취소') : null,
    original.status === 'cancelled' ? h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'restore-trip', onClick: () => save('planned') }, '계획으로 되돌리기') : null,
    h('button', { type: 'button', class: 'btn btn--danger-quiet', onClick: () => {
      if (!window.confirm(`'${original.title}' 일정을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;
      const r = opts.onDelete(original.id);
      if (!r.ok) { saveError = r.error ?? '삭제하지 못했습니다.'; update(); }
    } }, '삭제')) : null;

  add(form,
    h('div', { class: 'field' },
      h('label', { for: 'trip-title' }, '제목'),
      h('input', { id: 'trip-title', type: 'text', value: draft.title, maxlength: LIMITS.title, placeholder: '예: 첫 정기휴가', autocomplete: 'off', onInput: (e) => { draft.title = e.target.value; update(); } })),
    h('fieldset', { class: 'seg-ctrl' }, h('legend', null, '상태'),
      statusRadio('planned'), statusRadio('completed'), original ? statusRadio('cancelled') : null),
    segBox, summaryBox, preparation.element, planEntry(), transportBox, issueBox,
    h('div', { class: 'sheet__actions' },
      h('button', { type: 'submit', class: 'btn btn--primary', 'data-testid': 'save-trip' }, isNew ? '일정 저장' : '변경 저장'),
      h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => opts.onClose() }, '닫기')),
    quick);

  /** 휴가 계획서 입구. 계획서는 저장된 일정에만 붙는다 — 이동하면 이 편집 시트는 닫힌다(작성 중이면 확인). */
  function planEntry() {
    if (!opts.onOpenPlan) return null;
    if (!original) return h('p', { class: 'small muted trip-plan-entry trip-plan-entry--new' }, '일정을 저장하면 날짜별 할 일을 적는 휴가 계획서를 쓸 수 있습니다.');
    return h('section', { class: 'trip-plan-entry', 'aria-labelledby': 'trip-plan-entry-title' },
      h('div', { class: 'trip-plan-entry__text' },
        h('h3', { id: 'trip-plan-entry-title' }, planLabel(original)),
        h('p', { class: 'small muted' }, original.plan ? planSummaryText(original) : '출타 동안 할 일을 날짜별로 정리합니다.')),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'data-testid': 'open-plan', onClick: () => opts.onOpenPlan(original.id) }, original.plan ? '계획서 열기' : '계획서 쓰기'));
  }

  fill(root, 
    h('header', { class: 'sheet__head' },
      h('h2', { id: titleId }, isNew ? '새 일정' : '일정 수정'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: () => opts.onClose() }, '✕')),
    form);
  renderSegments();
  update();

  return { isDirty: () => JSON.stringify(draft) !== pristine, refreshDate: preparation.refreshDate };
}

/** 그 날짜에 쓸 수 있는 휴가를 앞에, 그 안에서는 만료가 빠른 순으로 */
function sortForDate(grants, date) {
  const usable = (g) => (inGrantWindow(g, date, date) ? 0 : 1);
  return [...grants].sort((a, b) => usable(a) - usable(b) || (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'));
}

/** 출타 날짜 기준으로 쓸 수 있고 남은 휴가 중 만료가 가장 빠른 것을 제안 */
function defaultGrantId(state, date) {
  const byGrant = calculateBalances(state, date).byGrant;
  const usable = sortForDate(state.grants, date).filter((g) => inGrantWindow(g, date, date) && byGrant[g.id].afterPlans > 0);
  return usable[0]?.id ?? null;
}

/** 이어 붙이는 구간: 앞 구간과 다른 휴가 중 그 날짜에 쓸 수 있는 것을 우선 */
function otherGrantId(state, date, current) {
  const byGrant = calculateBalances(state, date).byGrant;
  const other = sortForDate(state.grants, date).find((g) => g.id !== current && inGrantWindow(g, date, date) && byGrant[g.id].afterPlans > 0);
  return other?.id ?? current ?? defaultGrantId(state, date);
}

function newTrip(state, today, start) {
  return {
    id: newId('t'),
    title: '',
    status: 'planned',
    segments: [{ id: newId('s'), kind: 'leave', start, end: start, grantId: defaultGrantId(state, start) }],
    transport: emptyTransport(),
    shareConfirmed: false,
    preparation: [],
    performanceSource: null,
    plan: null,
  };
}

/** 초기값이 정해진 새 일정 (예: 성과제 초안 {kind:'performance', grantId:null, start, end, title}) */
function tripFromDraft(d) {
  return {
    id: newId('t'),
    title: d.title ?? '',
    status: 'planned',
    segments: [{ id: newId('s'), kind: d.kind, start: d.start, end: d.end, grantId: d.grantId ?? null }],
    transport: emptyTransport(),
    shareConfirmed: false,
    preparation: [],
    performanceSource: d.kind === 'performance' ? d.performanceSource ?? null : null,
    plan: null,
  };
}
