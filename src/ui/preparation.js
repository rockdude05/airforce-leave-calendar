import { h, fill, formatDate } from './dom.js';
import { OJT_NOTICE, OJT_REVIEWED_ON, guidanceForTrip } from '../domain/ojt-guidance.js';
import { applicationWindow } from '../domain/application-window.js';
import { preparationContext, preparationItems } from '../domain/preparation.js';

export const APPLICATION_PHASE_TEXT = Object.freeze({
  before: '접수 시작 전', open: '접수 기간', 'closing-day': '마감일 · 오전까지 접수, 부대 공지를 확인하세요',
  closed: '접수 기간이 지났습니다 · 변경 신청은 부대에 확인하세요',
});

/** 체크 초안은 편집기가 소유한다. 날짜 갱신으로 폼·포커스·접힘 상태를 다시 만들지 않는다. */
export function createPreparationPanel({ trip, grants, getToday, onToggle, onAsk }) {
  const phase = h('p', { class: 'application-window__phase', 'aria-live': 'polite' });
  const dates = h('p', { class: 'small' });
  const application = h('section', { class: 'application-window', 'data-testid': 'application-window', 'aria-label': '신청 기간' },
    h('h3', null, '신청 기간'), phase, dates,
    h('p', { class: 'small muted' }, '출타 첫날이 속한 월요일~일요일 주 기준입니다. 정확한 마감 시각·휴일 조정은 부대 공지를 확인하세요.'));
  const summary = h('summary', { 'data-testid': 'preparation-summary' });
  const notice = h('p', { class: 'issue issue--info', 'data-testid': 'preparation-reset', hidden: true }, '일정 날짜나 휴가 구성이 바뀌어 준비 체크를 비웠습니다. 바뀐 일정으로 다시 확인해 주세요.');
  const invalid = h('p', { class: 'small muted', hidden: true }, '날짜와 구간을 올바르게 입력하면 준비 체크를 할 수 있습니다.');
  const list = h('div', { class: 'preparation-items' });
  const details = h('details', { class: 'preparation-panel', 'data-testid': 'preparation-panel' }, summary, notice, invalid, list,
    h('p', { class: 'small muted' }, '체크는 이 일정의 저장 버튼을 눌러야 보관됩니다. 확정 표시나 사용완료 상태는 자동으로 바뀌지 않습니다.'));
  const guidanceContent = h('div');
  const guidance = h('details', { class: 'ojt-guidance', 'data-testid': 'ojt-guidance' }, h('summary', null, '관련 OJT 안내'), guidanceContent);
  let guidanceKey = null;
  const element = h('div', { class: 'trip-preparation' }, application, details, guidance);
  let items = [];
  let itemKey = null;
  function refreshDate() {
    const window = applicationWindow(trip.segments, getToday());
    phase.textContent = window ? APPLICATION_PHASE_TEXT[window.phase] : '날짜와 구간을 올바르게 입력하면 신청 기간을 확인할 수 있습니다.';
    dates.textContent = window ? `${formatDate(window.startsOn, { year: true })}부터 / ${formatDate(window.closesOn, { year: true })} 오전까지` : '';
  }
  function refresh({ resetNotice = false } = {}) {
    const valid = Boolean(preparationContext(trip.segments));
    if (valid) items = preparationItems(trip.segments);
    const key = items.map(i => i.id).join(',');
    if (key !== itemKey) {
      itemKey = key;
      fill(list, ...['application', 'departure', 'return'].map(stage => h('fieldset', null,
        h('legend', null, { application: '신청', departure: '출발', return: '복귀' }[stage]),
        items.filter(i => i.stage === stage).map(i => h('label', { class: 'preparation-choice', for: `prep-${i.id}` },
          h('input', { type: 'checkbox', id: `prep-${i.id}`, onChange: e => onToggle(i.id, e.target.checked) }), h('span', null, i.label))),
        stage === 'departure' ? h('p', { class: 'small muted' }, '전날 휴대폰 반납과 출발 전 불출도 확인하세요.') : null)));
    }
    for (const i of items) {
      const input = list.querySelector(`#prep-${i.id}`);
      input.checked = trip.preparation.includes(i.id);
      input.disabled = !valid;
    }
    summary.textContent = `출타 준비 ${items.filter(i => trip.preparation.includes(i.id)).length}/${items.length}`;
    invalid.hidden = valid;
    if (resetNotice) { notice.hidden = false; details.open = true; }
    const notes = guidanceForTrip(trip, grants);
    const nextGuidanceKey = notes.map(n => n.id).join(',');
    if (guidanceKey !== nextGuidanceKey) { guidanceKey = nextGuidanceKey; fill(guidanceContent, renderOjtNotes(notes, onAsk)); }
    guidance.hidden = !valid;
    refreshDate();
  }
  refresh();
  return { element, refresh, refreshDate };
}

/** 항목명만 문의 콜백으로 넘기며 일정·체크·휴가 정보는 전달하지 않는다. */
export function renderOjtNotes(notes, onAsk) {
  return h('div', { class: 'ojt-notes' },
    h('p', { class: 'small muted' }, OJT_NOTICE),
    h('p', { class: 'small muted' }, `자료 검토일: ${formatDate(OJT_REVIEWED_ON, { year: true, weekday: false })} (시행일 아님)`),
    notes.map(n => h('section', { class: 'ojt-note' },
      h('h4', null, n.title), h('p', { class: 'small' }, n.text),
      h('p', { class: 'small muted' }, `출처: 수송대대 외출외박휴가 OJT ${n.pages.join('·')}쪽`),
      onAsk ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': `문의하기: OJT ${n.title}`, onClick: () => onAsk(`OJT: ${n.title}`, '질문') }, '이 안내 문의하기') : null)));
}
