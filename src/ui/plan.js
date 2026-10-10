import { h, fill, formatDate, shortDate } from './dom.js';
import { compareDates } from '../domain/dates.js';
import { tripDates, newId } from '../domain/model.js';
import {
  PLAN_LIMITS, emptyPlan, normalizePlan, validatePlan, groupPlanItems, planDays, planSummary, planText, isPlanTime,
} from '../domain/vacation-plan.js';

/** 휴가·성과제외박이 있으면 휴가 계획서, 외출·면회외출 단독이면 외출 계획서 */
export function planLabel(trip) {
  return trip.segments.some((s) => s.kind === 'leave' || s.kind === 'performance') ? '휴가 계획서' : '외출 계획서';
}

/** 카드·편집기 한 줄 요약 */
export function planSummaryText(trip) {
  const s = planSummary(trip);
  if (!s.written) return '아직 쓰지 않았습니다';
  const parts = [`할 일 ${s.items}개`];
  if (s.totalDays > 1) parts.push(`${s.totalDays}일 중 ${s.plannedDays}일 계획`);
  if (s.done) parts.push(`완료 ${s.done}`);
  if (trip.plan.destination) parts.push(trip.plan.destination);
  return parts.join(' · ');
}

/** 오늘 날짜의 할 일 (출타 중일 때 달력 첫 화면에 띄운다) */
export function todayItems(trip, today) {
  if (!trip.plan) return [];
  return groupPlanItems(trip, trip.plan.items).days.find((d) => d.date === today)?.items ?? [];
}

function ddayText(trip, today) {
  const { start, end } = tripDates(trip);
  if (!start || !end) return '';
  if (compareDates(today, start) < 0) return `D-${compareDates(start, today)}`;
  if (compareDates(today, end) <= 0) return `출타 중 · ${compareDates(today, start) + 1}일차`;
  return '지난 일정';
}

/**
 * 휴가 계획서 시트. 초안은 시트가 소유하고 '계획서 저장'에서만 onSave로 넘긴다. 저장해도 시트는 열려 있다.
 * @param {HTMLElement} root
 * @param {{trip:any, getToday:()=>string, onSave:(plan:any)=>{ok:boolean,error?:string},
 *   onCopy:(text:string)=>Promise<string>, onEditTrip?:()=>void, onClose:()=>void}} opts
 * @returns {{isDirty:()=>boolean, refreshDate:()=>void}}
 */
export function renderPlanSheet(root, opts) {
  const { trip } = opts;
  const label = planLabel(trip);
  let savedKey = JSON.stringify(normalizePlan(trip.plan));
  let draft = structuredClone(trip.plan ?? emptyPlan());
  /** 열린 할 일 입력 칸: 새 할 일이면 id:null + 날짜(미정은 null), 수정이면 항목 id */
  let editing = null;
  let composerHasChanges = () => false;

  const titleId = 'plan-sheet-title';
  const hero = h('section', { class: 'plan-hero', 'aria-label': '계획 요약' });
  const nav = h('nav', { class: 'plan-nav', 'aria-label': '날짜로 이동' });
  const daysBox = h('div', { class: 'plan-days' });
  const status = h('p', { class: 'plan-status small', 'aria-live': 'polite', 'data-testid': 'plan-status' });
  const body = h('div', { class: 'sheet__body plan', 'aria-labelledby': titleId });

  const textField = (key, labelText, placeholder) => {
    const id = `plan-${key}`;
    return h('div', { class: 'field' },
      h('label', { for: id }, labelText),
      h('input', { id, type: 'text', value: draft[key], maxlength: PLAN_LIMITS[key], placeholder, autocomplete: 'off',
        onInput: (e) => { draft[key] = e.target.value; renderHero(); } }));
  };

  function renderHero() {
    const { start, end } = tripDates(trip);
    const today = opts.getToday();
    const days = planDays(trip);
    const groups = groupPlanItems(trip, draft.items);
    const planned = groups.days.filter((d) => d.items.length).length;
    const done = draft.items.filter((it) => it.done).length;
    const dest = draft.destination.trim();
    fill(hero,
      h('div', { class: 'plan-hero__top' },
        h('span', { class: 'plan-hero__label' }, label),
        h('span', { class: 'plan-hero__dday', 'data-testid': 'plan-dday' }, ddayText(trip, today))),
      h('strong', { class: 'plan-hero__title' }, trip.title),
      start && start === end ? h('p', { class: 'plan-hero__route' }, formatDate(start)) : null,
      start && start !== end ? h('p', { class: 'plan-hero__route' },
        h('span', { 'aria-hidden': 'true' }, shortDate(start)), h('span', { class: 'plan-hero__plane', 'aria-hidden': 'true' }, '✈'),
        h('span', { 'aria-hidden': 'true' }, shortDate(end)),
        h('span', { class: 'sr-only' }, `${formatDate(start)}부터 ${formatDate(end)}까지`)) : null,
      dest ? h('p', { class: 'plan-hero__dest' }, h('span', { class: 'plan-hero__dest-label' }, '행선지'), dest) : null,
      days.length > 1 ? h('div', { class: 'plan-meter', role: 'img', 'aria-label': `${days.length}일 중 ${planned}일 계획함` },
        groups.days.map((d) => h('i', { class: `plan-meter__day${d.items.length ? ' is-on' : ''}${d.date === today ? ' is-today' : ''}` }))) : null,
      h('dl', { class: 'plan-hero__stats' },
        h('div', null, h('dt', null, '할 일'), h('dd', { 'data-testid': 'plan-count' }, String(draft.items.length))),
        h('div', null, h('dt', null, '완료'), h('dd', null, String(done))),
        h('div', null, h('dt', null, '계획한 날'), h('dd', null, `${planned}/${days.length}`))));
  }

  function renderNav() {
    const today = opts.getToday();
    const groups = groupPlanItems(trip, draft.items);
    const jump = (id) => {
      const target = body.querySelector(`#${CSS.escape(id)}`);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    };
    if (groups.days.length < 2) { nav.hidden = true; nav.replaceChildren(); return; }
    nav.hidden = false;
    fill(nav,
      groups.days.map((d, i) => h('button', { type: 'button', class: `plan-nav__chip${d.date === today ? ' is-today' : ''}${d.items.length ? ' has-items' : ''}`,
        'aria-label': `${i + 1}일차 ${formatDate(d.date)}${d.items.length ? `, 할 일 ${d.items.length}개` : ''}${d.date === today ? ', 오늘' : ''}`,
        onClick: () => jump(`plan-day-${d.date}`) },
      h('span', { class: 'plan-nav__no' }, `${i + 1}일차`),
      h('span', { class: 'plan-nav__date' }, formatDate(d.date, { weekday: true }).replace(/^\d+월 /, '')),
      h('i', { class: 'plan-nav__dot', 'aria-hidden': 'true' }))),
      h('button', { type: 'button', class: 'plan-nav__chip plan-nav__chip--wish', onClick: () => jump('plan-undated') },
        h('span', { class: 'plan-nav__no' }, '미정'), h('span', { class: 'plan-nav__date' }, `${groups.undated.length}개`)));
  }

  function itemRow(it, { showDate = false } = {}) {
    if (editing && editing.id === it.id) return h('li', { class: 'plan-item plan-item--editing' }, composer(it));
    return h('li', { class: `plan-item${it.done ? ' is-done' : ''}`, 'data-testid': 'plan-item' },
      h('label', { class: 'plan-item__check' },
        h('input', { type: 'checkbox', checked: it.done, 'aria-label': `완료: ${it.text}`, onChange: (e) => {
          it.done = e.target.checked;
          // 다른 항목을 작성 중일 수 있으므로 입력 칸은 다시 만들지 않는다.
          e.target.closest('.plan-item').classList.toggle('is-done', it.done);
          renderHero();
        } })),
      h('span', { class: `plan-item__time${it.time ? '' : ' is-empty'}` }, showDate && it.date ? shortDate(it.date) : it.time ?? '—'),
      h('button', { type: 'button', class: 'plan-item__body', 'aria-label': `수정: ${it.text}`, onClick: () => startEditing({ id: it.id }) },
        h('span', { class: 'plan-item__text' }, it.text),
        it.place || (showDate && it.time) ? h('span', { class: 'plan-item__place' }, [showDate && it.time ? it.time : null, it.place].filter(Boolean).join(' · ')) : null));
  }

  function addButton(date, text = '할 일 추가') {
    return h('button', { type: 'button', class: 'plan-add', 'data-testid': 'plan-add', onClick: () => startEditing({ id: null, date }) },
      h('span', { class: 'plan-add__plus', 'aria-hidden': 'true' }, '+'), text);
  }

  function startEditing(next) {
    if (blockPendingItem()) return;
    editing = next;
    renderDays();
    focusComposer();
  }

  /** 할 일 입력 칸. 새 할 일은 추가 뒤에도 열어 둬 이어서 적을 수 있다. */
  function composer(item = null) {
    const days = planDays(trip);
    const time = h('input', { type: 'time', class: 'plan-composer__time', value: item?.time ?? '', 'aria-label': '시간 (선택)' });
    const text = h('input', { type: 'text', class: 'plan-composer__text', value: item?.text ?? '', maxlength: PLAN_LIMITS.text, placeholder: '할 일 (예: 가족과 저녁 식사)', 'aria-label': '할 일', autocomplete: 'off', 'data-testid': 'plan-text' });
    const place = h('input', { type: 'text', value: item?.place ?? '', maxlength: PLAN_LIMITS.place, placeholder: '장소 (선택)', 'aria-label': '장소', autocomplete: 'off', 'data-testid': 'plan-place' });
    const dateOptions = [
      ...days.map((d, i) => h('option', { value: d, selected: item?.date === d }, `${i + 1}일차 · ${formatDate(d)}`)),
      h('option', { value: '', selected: item && item.date === null }, '날짜 미정'),
      item?.date && !days.includes(item.date) ? h('option', { value: item.date, selected: true }, `기간 밖 · ${formatDate(item.date)}`) : null,
    ];
    const date = item ? h('select', { 'aria-label': '날짜', 'data-testid': 'plan-date' }, dateOptions) : null;
    const error = h('p', { class: 'form-error small', role: 'alert', hidden: true });
    composerHasChanges = () => text.value.trim() !== (item?.text ?? '') || place.value.trim() !== (item?.place ?? '')
      || (time.value || null) !== (item?.time ?? null) || (item !== null && (date.value || null) !== item.date);
    const close = () => { editing = null; composerHasChanges = () => false; renderDays(); };
    const form = h('form', { class: 'plan-composer', novalidate: true, 'data-testid': 'plan-composer', onSubmit: (e) => {
      e.preventDefault();
      const value = text.value.trim();
      if (!value) { error.textContent = '할 일을 적어 주세요.'; error.hidden = false; text.focus(); return; }
      if (time.value && !isPlanTime(time.value)) { error.textContent = '시간을 다시 골라 주세요.'; error.hidden = false; return; }
      if (item) {
        Object.assign(item, { text: value, place: place.value.trim(), time: time.value || null, date: date.value || null });
        close();
      } else {
        if (draft.items.length >= PLAN_LIMITS.items) { error.textContent = `할 일은 ${PLAN_LIMITS.items}개까지 적을 수 있습니다.`; error.hidden = false; return; }
        draft.items.push({ id: newId('p'), date: editing.date, time: time.value || null, text: value, place: place.value.trim(), done: false });
        renderAll({ keepInfo: true });
        focusComposer();
      }
    } },
    h('div', { class: 'plan-composer__row' }, time, text),
    place,
    date,
    error,
    h('div', { class: 'plan-composer__actions' },
      h('button', { type: 'submit', class: 'btn btn--primary btn--small', 'data-testid': 'plan-item-submit' }, item ? '수정 완료' : '추가'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: close }, item ? '취소' : '닫기'),
      item ? h('button', { type: 'button', class: 'btn btn--danger-quiet btn--small', 'data-testid': 'plan-item-delete', onClick: () => {
        draft.items = draft.items.filter((x) => x.id !== item.id);
        editing = null; composerHasChanges = () => false;
        renderAll({ keepInfo: true });
      } }, '삭제') : null));
    return form;
  }

  function focusComposer() {
    daysBox.querySelector('.plan-composer__text')?.focus();
  }

  function renderDays() {
    const today = opts.getToday();
    const groups = groupPlanItems(trip, draft.items);
    composerHasChanges = () => false;
    const newHere = (date) => editing && editing.id === null && editing.date === date;
    fill(daysBox,
      groups.days.map((d, i) => h('section', { class: `plan-day${d.date === today ? ' is-today' : ''}`, id: `plan-day-${d.date}`, 'aria-labelledby': `plan-day-${d.date}-title`, 'data-testid': 'plan-day' },
        h('header', { class: 'plan-day__head' },
          h('span', { class: 'plan-day__no' }, `${i + 1}일차`),
          h('h3', { id: `plan-day-${d.date}-title`, class: 'plan-day__date' }, formatDate(d.date)),
          d.date === today ? h('span', { class: 'plan-day__today' }, '오늘') : null,
          d.items.length ? h('span', { class: 'plan-day__count' }, `${d.items.length}개`) : null),
        d.items.length ? h('ol', { class: 'plan-timeline' }, d.items.map((it) => itemRow(it))) : null,
        newHere(d.date) ? composer() : addButton(d.date, d.items.length ? '할 일 추가' : '이 날 할 일 적기'))),
      h('section', { class: 'plan-day plan-day--wish', id: 'plan-undated', 'aria-labelledby': 'plan-undated-title' },
        h('header', { class: 'plan-day__head' },
          h('h3', { id: 'plan-undated-title', class: 'plan-day__date' }, '하고 싶은 것 · 날짜 미정'),
          groups.undated.length ? h('span', { class: 'plan-day__count' }, `${groups.undated.length}개`) : null),
        groups.undated.length ? null : h('p', { class: 'small muted' }, '날짜를 정하지 않은 할 일·가고 싶은 곳을 모아 두고, 수정에서 날짜를 정하세요.'),
        groups.undated.length ? h('ol', { class: 'plan-timeline' }, groups.undated.map((it) => itemRow(it))) : null,
        newHere(null) ? composer() : addButton(null, '하고 싶은 것 추가')),
      groups.outside.length ? h('section', { class: 'plan-day plan-day--outside', 'aria-labelledby': 'plan-outside-title', 'data-testid': 'plan-outside' },
        h('header', { class: 'plan-day__head' }, h('h3', { id: 'plan-outside-title', class: 'plan-day__date' }, '일정 기간 밖')),
        h('p', { class: 'issue issue--warning' }, '일정 날짜가 바뀌어 기간 밖에 남은 할 일입니다. 눌러서 날짜를 옮기거나 지워 주세요.'),
        h('ol', { class: 'plan-timeline' }, groups.outside.map((it) => itemRow(it, { showDate: true })))) : null);
  }

  const info = h('details', { class: 'plan-info', open: !draft.destination && !draft.contact && !draft.companions && !draft.route },
    h('summary', null, h('span', null, '기본 정보'), h('span', { class: 'plan-info__hint small' }, '행선지 · 연락처 · 동행 · 이동')),
    h('div', { class: 'plan-info__grid' },
      textField('destination', '행선지', '예: 부산 본가'),
      textField('contact', '비상 연락처', '예: 어머니 010-0000-0000'),
      textField('companions', '동행', '예: 가족, 동기 김OO'),
      textField('route', '이동 계획', '예: 10.12 08:30 KTX 대전→부산')));
  const memo = h('div', { class: 'field plan-memo' },
    h('label', { for: 'plan-memo' }, '메모 · 챙길 것'),
    h('textarea', { id: 'plan-memo', rows: 3, maxlength: PLAN_LIMITS.memo, placeholder: '예: 휴가증·군번줄 챙기기, 복귀 전날 이발', onInput: (e) => { draft.memo = e.target.value; } }, draft.memo));

  function setStatus(message, { error = false } = {}) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  function blockPendingItem() {
    if (!editing || !composerHasChanges()) return false;
    setStatus('작성 중인 할 일을 먼저 추가·수정 완료하거나 닫아 주세요.', { error: true });
    focusComposer();
    return true;
  }

  function save() {
    if (blockPendingItem()) return;
    const plan = normalizePlan(draft);
    const issues = validatePlan(plan);
    if (issues.length) { setStatus(issues[0].message, { error: true }); return; }
    const r = opts.onSave(plan);
    if (!r.ok) { setStatus(r.error ?? '저장하지 못했습니다.', { error: true }); return; }
    savedKey = JSON.stringify(plan);
    draft = structuredClone(plan ?? emptyPlan());
    editing = null;
    renderAll();
    setStatus(plan ? '계획서를 저장했습니다.' : '빈 계획서로 저장했습니다.');
  }

  async function copy() {
    const text = planText(trip, normalizePlan(draft));
    const r = await opts.onCopy(text);
    if (r === 'copied') setStatus('계획서를 글로 복사했습니다. 메모·메시지에 붙여넣을 수 있습니다.');
  }

  const actions = h('div', { class: 'plan-actions' },
    status,
    h('div', { class: 'plan-actions__row' },
      h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'save-plan', onClick: save }, '계획서 저장'),
      h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'copy-plan', onClick: copy }, '글로 복사')));
  const more = h('div', { class: 'plan-more' },
    opts.onEditTrip ? h('button', { type: 'button', class: 'btn btn--quiet btn--small', 'data-testid': 'plan-edit-trip', onClick: opts.onEditTrip }, '일정 날짜·상태 수정') : null,
    h('button', { type: 'button', class: 'btn btn--danger-quiet btn--small', 'data-testid': 'clear-plan', onClick: () => {
      if (!window.confirm('이 계획서의 할 일과 기본 정보를 모두 비울까요? 저장을 눌러야 반영됩니다.')) return;
      draft = emptyPlan(); editing = null; renderAll();
      setStatus('계획서를 비웠습니다. 저장을 눌러야 반영됩니다.');
    } }, '계획서 비우기'));

  function renderAll({ keepInfo = false } = {}) {
    renderHero();
    renderNav();
    renderDays();
    if (keepInfo) return;
    for (const key of ['destination', 'contact', 'companions', 'route']) body.querySelector(`#plan-${key}`).value = draft[key];
    body.querySelector('#plan-memo').value = draft.memo;
  }

  fill(body, hero, nav, info, daysBox, memo, h('p', { class: 'small muted plan-private' }, '계획서는 이 기기에만 저장되며 일정 공유(QR·링크·가족 문장)에 들어가지 않습니다.'), more);
  fill(root,
    h('header', { class: 'sheet__head' },
      h('h2', { id: titleId }, label),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: () => opts.onClose() }, '✕')),
    body, actions);
  renderAll();

  return {
    isDirty: () => (editing !== null && composerHasChanges()) || JSON.stringify(normalizePlan(draft)) !== savedKey,
    refreshDate: () => { renderHero(); renderNav(); if (!editing) renderDays(); },
  };
}
