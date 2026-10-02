import { h, fill, formatDate, formatRange, shortDate, weekdayName } from './dom.js';
import { monthGrid, weekday, compareDates, inclusiveDays, shiftMonth, addDays } from '../domain/dates.js';
import { SEGMENT_KIND_LABELS, TRIP_STATUS_LABELS } from '../domain/model.js';
import { isActiveTrip } from '../domain/balances.js';
import { serviceMarks } from './service.js';

const KIND_MARK = { leave: '휴', performance: '성', outing: '외', visit: '면' };
/** 좁은 달력 칸에 들어가는 짧은 이름 (글자 중간에서 잘리지 않게) */
const KIND_SHORT = { leave: '휴가', performance: '성과', outing: '외출', visit: '면회' };

/** 날짜별 활성 일정 구간 */
function segmentsByDate(trips, cells) {
  const map = new Map();
  const first = cells[0].date;
  const last = cells.at(-1).date;
  for (const t of trips) {
    if (!isActiveTrip(t)) continue;
    for (const s of t.segments) {
      if (compareDates(s.end, first) < 0 || compareDates(s.start, last) > 0) continue;
      for (const c of cells) {
        if (compareDates(c.date, s.start) >= 0 && compareDates(c.date, s.end) <= 0) {
          if (!map.has(c.date)) map.set(c.date, []);
          map.get(c.date).push({ trip: t, seg: s });
        }
      }
    }
  }
  return map;
}

function nextTrip(state, today) {
  return state.trips
    .filter((t) => t.status === 'planned' && t.segments.length)
    .map((t) => ({ t, start: minStart(t), end: maxEnd(t) }))
    .filter((x) => compareDates(x.end, today) >= 0)
    .sort((a, b) => compareDates(a.start, b.start))[0] ?? null;
}

const minStart = (t) => t.segments.reduce((m, s) => (compareDates(s.start, m) < 0 ? s.start : m), t.segments[0].start);
const maxEnd = (t) => t.segments.reduce((m, s) => (compareDates(s.end, m) > 0 ? s.end : m), t.segments[0].end);

function pass({ state, balances, today, onOpenTrip, onAddTrip }) {
  const next = nextTrip(state, today);
  const days = balances.availableTodayAfterPlans;
  let body;
  if (next) {
    const dday = compareDates(next.start, today);
    body = h('button', { type: 'button', class: 'pass__main', onClick: () => onOpenTrip(next.t.id) },
      h('span', { class: 'pass__label' }, '다음 출타'),
      h('strong', { class: 'pass__title' }, next.t.title),
      h('span', { class: 'pass__route' },
        h('span', null, shortDate(next.start)), h('span', { class: 'pass__plane', 'aria-hidden': 'true' }, '✈'), h('span', null, shortDate(next.end))),
      h('span', { class: 'pass__dday' }, dday > 0 ? `D-${dday}` : '출타 중'));
  } else {
    body = h('div', { class: 'pass__main' },
      h('span', { class: 'pass__label' }, '다음 출타'),
      h('strong', { class: 'pass__title pass__title--empty' }, state.grants.length ? '계획한 출타가 없습니다' : '보유 휴가부터 입력하세요'),
      h('button', { type: 'button', class: 'btn btn--small btn--ghost', onClick: onAddTrip }, state.grants.length ? '일정 추가' : '내 휴가 입력'));
  }
  return h('section', { class: 'pass', 'aria-label': '출타증 요약' },
    body,
    h('div', { class: 'pass__perf', 'aria-hidden': 'true' }),
    h('div', { class: 'pass__stub' },
      h('span', { class: 'pass__label' }, '남은 휴가'),
      h('strong', { class: 'pass__days', 'data-testid': 'available-today' }, String(days), h('small', null, '일')),
      h('span', { class: 'pass__note' }, '오늘 기준 계획 후 잔여')));
}

/**
 * @param {HTMLElement} root
 * @param {{month:string,state:any,balances:any,today:string,selected:string,onSelectDate:(d:string)=>void,onMonthChange:(m:string)=>void,onOpenTrip:(id:string)=>void,onAddTrip:(date?:string)=>void}} opts
 */
export function renderCalendar(root, opts) {
  const { month, state, today, selected } = opts;
  const cells = monthGrid(month);
  const byDate = segmentsByDate(state.trips, cells);
  const grantById = new Map(state.grants.map((g) => [g.id, g]));
  const marks = serviceMarks(opts.schedule ?? null);
  const [y, m] = month.split('-').map(Number);

  const head = h('div', { class: 'cal-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '이전 달', onClick: () => opts.onMonthChange(shiftMonth(month, -1)) }, '‹'),
    h('h2', { class: 'cal-head__title', 'aria-live': 'polite' }, `${y}년 ${m}월`),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '다음 달', onClick: () => opts.onMonthChange(shiftMonth(month, 1)) }, '›'),
    month !== today.slice(0, 7) ? h('button', { type: 'button', class: 'btn btn--small btn--ghost cal-head__today', onClick: () => { opts.onMonthChange(today.slice(0, 7)); opts.onSelectDate(today); } }, '오늘') : null);

  const grid = h('div', { class: 'cal', role: 'grid', 'aria-label': `${y}년 ${m}월 달력` },
    h('div', { class: 'cal__row cal__row--head', role: 'row' },
      [0, 1, 2, 3, 4, 5, 6].map((i) => h('span', { class: `cal__wd${i === 0 ? ' is-sun' : ''}${i === 6 ? ' is-sat' : ''}`, role: 'columnheader' }, weekdayName(i)))));

  for (let w = 0; w < cells.length; w += 7) {
    const row = h('div', { class: 'cal__row', role: 'row' });
    for (const c of cells.slice(w, w + 7)) {
      const items = byDate.get(c.date) ?? [];
      const wd = weekday(c.date);
      const labelParts = [formatDate(c.date)];
      const bars = items.map(({ trip, seg }) => {
        // 한 출타는 하나의 막대로 이어 보이게: 둥근 끝은 출타 시작·끝(또는 주 경계)에만.
        const segStart = seg.start === c.date;
        const startsHere = minStart(trip) === c.date || wd === 0;
        const endsHere = maxEnd(trip) === c.date || wd === 6;
        const showLabel = startsHere || segStart;
        labelParts.push(`${SEGMENT_KIND_LABELS[seg.kind]} ${TRIP_STATUS_LABELS[trip.status]}: ${trip.title}`);
        const grant = seg.grantId ? grantById.get(seg.grantId) : null;
        const text = showLabel ? (seg.kind === 'leave' && grant ? shortGrant(grant) : KIND_SHORT[seg.kind]) : '';
        return h('span', {
          class: `bar bar--${seg.kind} bar--${trip.status}${startsHere ? ' bar--start' : ''}${endsHere ? ' bar--end' : ''}${segStart && !startsHere ? ' bar--seg' : ''}`,
          'aria-hidden': 'true',
        }, showLabel ? h('b', { class: 'bar__mark' }, KIND_MARK[seg.kind]) : null, text ? h('span', { class: 'bar__text' }, text) : null);
      });
      const classes = ['day'];
      if (!c.inMonth) classes.push('is-out');
      if (c.date === today) classes.push('is-today');
      if (c.date === selected) classes.push('is-selected');
      if (wd === 0) classes.push('is-sun');
      if (wd === 6) classes.push('is-sat');
      if (c.date === today) labelParts.push('오늘');
      const dayMarks = marks.get(c.date) ?? [];
      for (const mk of dayMarks) labelParts.push(mk.label);
      row.append(h('button', {
        type: 'button', role: 'gridcell', class: classes.join(' '), 'data-date': c.date,
        'aria-selected': c.date === selected ? 'true' : 'false', 'aria-label': labelParts.join(', '),
        onClick: () => opts.onSelectDate(c.date),
      }, h('span', { class: 'day__marks', 'aria-hidden': 'true' },
        dayMarks.map((mk) => h('b', { class: `svc-mark svc-mark--${mk.kind}`, 'data-testid': 'service-mark' }, mk.mark))),
      h('span', { class: 'day__num' }, String(Number(c.date.slice(8)))), h('span', { class: 'day__bars' }, bars)));
    }
    grid.append(row);
  }

  fill(root,
    pass(opts),
    opts.welcome ? welcome(opts) : null,
    h('section', { class: 'cal-wrap', 'aria-label': '월간 달력' }, head, grid, legend(Boolean(opts.schedule))),
    dayDetail(opts, grantById, marks.get(selected) ?? []),
  );
}

function shortGrant(g) {
  return { reward: '포상', consolation: '위로', compensation: '보상', petition: '청원', other: '기타' }[g.kind] ?? '정기';
}

function legend(hasSchedule) {
  return h('p', { class: 'legend' },
    h('span', { class: 'legend__item' }, h('i', { class: 'swatch swatch--planned', 'aria-hidden': 'true' }), '계획'),
    h('span', { class: 'legend__item' }, h('i', { class: 'swatch swatch--completed', 'aria-hidden': 'true' }), '사용완료'),
    h('span', { class: 'legend__item' }, '휴 휴가 · 성 성과제외박 · 외 외출 · 면 면회외출'),
    hasSchedule ? h('span', { class: 'legend__item' }, '날짜 위: 진 진급 · 전 전역 · 성 성과제 생기는 날') : null);
}

function dayDetail({ state, selected, schedule, onOpenTrip, onAddTrip, onPerformanceTrip }, grantById, dayMarks) {
  const trips = state.trips.filter((t) => t.segments.some((s) => compareDates(selected, s.start) >= 0 && compareDates(selected, s.end) <= 0));
  trips.sort((a, b) => Number(isActiveTrip(b)) - Number(isActiveTrip(a)));
  return h('section', { class: 'day-detail', 'aria-labelledby': 'day-detail-title' },
    h('h2', { id: 'day-detail-title', class: 'section-title' }, formatDate(selected)),
    serviceDetail(dayMarks, schedule, selected, onPerformanceTrip),
    trips.length
      ? h('ul', { class: 'trip-list' }, trips.map((t) => tripCard(t, grantById, onOpenTrip)))
      : h('p', { class: 'muted' }, '이 날 일정이 없습니다.'),
    h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-testid': 'add-trip', onClick: () => onAddTrip(selected) }, '이 날부터 일정 추가'));
}

export function tripCard(t, grantById, onOpenTrip) {
  const start = minStart(t);
  const end = maxEnd(t);
  const leaveDays = t.segments.filter((s) => s.kind === 'leave').reduce((n, s) => n + inclusiveDays(s.start, s.end), 0);
  const parts = t.segments.map((s) => {
    const n = inclusiveDays(s.start, s.end);
    if (s.kind === 'leave') return `${grantById.get(s.grantId)?.label ?? '삭제된 휴가'} ${n}일`;
    return `${SEGMENT_KIND_LABELS[s.kind]}${n > 1 ? ` ${n}일` : ''}`;
  });
  return h('li', null,
    h('button', { type: 'button', class: `trip-card trip-card--${t.status}`, onClick: () => onOpenTrip(t.id) },
      h('span', { class: 'trip-card__top' },
        h('strong', { class: 'trip-card__title' }, t.title),
        h('span', { class: `chip chip--${t.status}` }, TRIP_STATUS_LABELS[t.status])),
      h('span', { class: 'trip-card__dates' }, formatRange(start, end)),
      h('span', { class: 'trip-card__parts' }, parts.join(' + '), leaveDays ? ` · 휴가 ${leaveDays}일 차감` : '')));
}


/** 첫 실행 안내: 기록을 넣기 전에 브라우저·복원 경로부터 알려 준다 */
function welcome({ welcome: w, onHelp, onRestore }) {
  return h('section', { class: 'welcome', 'aria-labelledby': 'welcome-title', 'data-testid': 'welcome' },
    h('h2', { id: 'welcome-title', class: 'section-title' }, '처음이세요?'),
    w.inApp ? h('p', { class: 'notice' }, `${w.inApp} 안에서 열었습니다. 여기 입력한 기록은 Safari·Chrome으로 옮기면 보이지 않습니다. 먼저 메뉴에서 "다른 브라우저로 열기"를 눌러 주세요.`) : null,
    h('ol', { class: 'rules' },
      h('li', null, '아이폰은 Safari, 안드로이드는 Chrome으로 열고 홈 화면에 추가하세요.'),
      h('li', null, '아래 "내 휴가" 탭에서 지금 남은 휴가를 입력하세요.'),
      h('li', null, '다른 휴대폰에서 쓰던 기록이 있으면 백업 파일로 복원하세요.')),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: onHelp }, '사용법 보기'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: onRestore }, '백업에서 복원')));
}

/** 선택한 날의 복무 일정(진급·전역·성과제)과 성과제 일정 만들기 */
function serviceDetail(dayMarks, schedule, selected, onPerformanceTrip) {
  const items = dayMarks.filter((mk) => !mk.lastPartial);
  const last = schedule?.lastPartial && schedule.lastPartial.end === selected ? schedule.lastPartial : null;
  if (!items.length && !last) return null;
  const perfButton = (label, perf, disabledReason) => h('div', { class: 'svc-day__action' },
    h('button', { type: 'button', class: 'btn btn--ghost btn--block', 'data-testid': 'perf-trip', disabled: Boolean(disabledReason),
      'aria-describedby': disabledReason ? 'perf-trip-why' : null, onClick: () => onPerformanceTrip?.(perf) }, label),
    disabledReason ? h('p', { id: 'perf-trip-why', class: 'muted small' }, disabledReason) : null);
  return h('ul', { class: 'svc-day', 'aria-label': '복무 일정' },
    items.map((mk) => h('li', { class: `svc-day__item svc-day__item--${mk.kind}` },
      h('span', null, h('b', { class: `svc-mark svc-mark--${mk.kind}`, 'aria-hidden': 'true' }, mk.mark), mk.label),
      mk.perf ? perfButton('이 성과제로 일정 만들기', { n: mk.perf.n, start: mk.perf.date, days: mk.perf.days }, null) : null)),
    last ? h('li', { class: 'svc-day__item svc-day__item--perf' },
      h('span', null, h('b', { class: 'svc-mark svc-mark--perf', 'aria-hidden': 'true' }, '성'),
        `마지막 성과제 (${shortDate(last.start)}~${shortDate(last.end)}) · ${last.days === null ? '일수 확인 필요' : last.days === 0 ? '지급 없음' : `${last.days}일`}`),
      perfButton('이 성과제로 일정 만들기',
        { n: schedule.performances.length + 1, start: last.days ? addDays(last.end, 1 - last.days) : last.end, days: last.days },
        last.days === null ? '설정 → 내 복무 정보에서 일수를 확인해 입력하면 만들 수 있습니다.' : last.days === 0 ? '지급 없음으로 입력되어 있습니다.' : null)) : null);
}
