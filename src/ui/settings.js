import { h, fill, issueList, formatDate } from './dom.js';
import { ruleVersionLabel } from '../domain/model.js';
import { dotDate, SERVICE_DATE_LABELS } from './service.js';
import { computeSchedule } from '../domain/service.js';
import { RULE_TOPICS } from '../feedback.js';
import { NICKNAME_LIMIT } from '../domain/model.js';

/**
 * 설정 화면: 백업·복원, 홈 화면 추가 안내, 적용 규칙
 * @param {HTMLElement} root
 */
export function renderSettings(root, { state, today, onEditService, onExport, onImportFile, importIssues, install, offline, update, appVersion, onAsk, onRenameReceived, onRemoveReceived, viewOnly = false, onToggleViewOnly }) {
  const fileInput = h('input', {
    type: 'file', id: 'restore-file', accept: 'application/json,.json', class: 'sr-only',
    onChange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportFile(f); },
  });
  fill(root, 
    h('h1', { class: 'view-title' }, '설정'),
    update.waiting ? h('section', { class: 'notice notice--update', role: 'status' },
      h('p', null, '새 버전이 준비되었습니다. 작성 중인 내용이 없을 때 적용하세요.'),
      h('button', { type: 'button', class: 'btn btn--primary btn--small', onClick: update.apply }, '새 버전 적용')) : null,
    viewOnly ? null : serviceSection(state.service, today, onEditService),
    h('section', { 'aria-labelledby': 'backup-title' },
      h('h2', { id: 'backup-title', class: 'section-title' }, '기록 백업과 복원'),
      h('p', { class: 'small' }, '기록은 이 휴대폰의 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우거나 휴대폰을 바꾸면 사라지니 가끔 백업 파일을 받아 두세요.'),
      h('p', { class: 'muted small' }, viewOnly
        ? `현재 기록: 받은 일정 ${(state.received ?? []).length}명 (숨긴 내 기록도 백업 파일에 그대로 들어갑니다)`
        : `현재 기록: 휴가 ${state.grants.length}건, 일정 ${state.trips.length}건, 받은 일정 ${(state.received ?? []).length}명`),
      h('div', { class: 'btn-row btn-row--split' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'export', onClick: onExport }, '백업 파일 받기'),
        h('label', { for: 'restore-file', class: 'btn btn--ghost', 'data-testid': 'import-label', tabindex: '0',
          onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, '백업에서 복원'),
        fileInput),
      importIssues?.length ? h('div', { class: 'issue-box' }, h('p', { class: 'form-error' }, '이 파일로는 복원하지 않았습니다. 기존 기록은 그대로입니다.'), issueList(importIssues)) : null),
    receivedSection(state.received ?? [], { onRenameReceived, onRemoveReceived, viewOnly, onToggleViewOnly }),
    h('section', { 'aria-labelledby': 'install-title' },
      h('h2', { id: 'install-title', class: 'section-title' }, '홈 화면에 추가'),
      offlineNote(offline),
      installGuide(install)),
    h('section', { 'aria-labelledby': 'rules-title' },
      h('h2', { id: 'rules-title', class: 'section-title' }, '적용 규칙'),
      h('p', { class: 'muted small' }, `작근단 수송대대 병 기준 · 적용 규칙 ${ruleVersionLabel()}`),
      h('h3', { class: 'sub-title rule-group__title' }, '앱이 계산하는 것',
        h('span', { class: 'rule-group__count' }, `${RULE_TOPICS.calculated.length}`)),
      h('ul', { class: 'rule-list' }, ruleItems(RULE_TOPICS.calculated, onAsk)),
      h('h3', { class: 'sub-title rule-group__title' }, '부대 확인이 필요해 판정하지 않는 것',
        h('span', { class: 'rule-group__badge' }, '확인 필요')),
      h('p', { class: 'muted small rule-group__hint' }, '부대에서 들은 답이 있으면 문의로 알려 주세요. 확인되면 계산 규칙에 넣습니다.'),
      h('ul', { class: 'rule-list rule-list--open' }, ruleItems(RULE_TOPICS.unconfirmed, onAsk, { open: true }))),
    h('section', { 'aria-labelledby': 'feedback-title' },
      h('h2', { id: 'feedback-title', class: 'section-title' }, '의견 보내기'),
      h('div', { class: 'feedback-card' },
        h('p', { class: 'small' }, '위 규칙에 없는 내용이나 그 외 의견은 여기로 보내 주세요.'),
        h('p', { class: 'muted small feedback-card__note' }, '앱은 휴가 기록·이름·연락처를 보내지 않습니다. 군번·실명·작전 정보·실제 출타 일정은 적지 마세요.'),
        h('p', { class: 'muted small feedback-card__note', 'data-testid': 'share-privacy-note' }, '일정 공유 코드에는 날짜, 계획·확정 표시, 내 공유 번호, 만든 날짜가 담깁니다. 공유 번호로 같은 사람이 보낸 코드들을 이어 볼 수 있습니다. 휴가 종류·이름·부대 정보는 담기지 않습니다.'),
        h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-testid': 'feedback-general',
          onClick: () => onAsk?.('일반 의견', '기타') }, '일반 의견 보내기'))),
    h('p', { class: 'muted small app-version' }, `출타 장부 ${appVersion} · 앱이 개인 기록을 자동으로 서버에 보내지 않습니다. 공유는 직접 보낼 때만 이루어집니다. 공식 휴가 승인·판정 도구가 아니며, 최종 판단은 부대 행정 기준을 따릅니다.`));
}

/** 규칙 한 줄 = 표식 · 설명 · 문의 버튼. 버튼은 항목 첫 줄 오른쪽에 붙고 이름에 항목을 담는다. */
function ruleItems(topics, onAsk, { open = false } = {}) {
  return topics.map((text) => h('li', { class: 'rule-row' },
    h('span', { class: `rule__mark${open ? ' rule__mark--open' : ''}`, 'aria-hidden': 'true' }, open ? '?' : ''),
    h('span', { class: 'rule__text' }, text),
    h('button', { type: 'button', class: 'rule__ask', 'aria-label': `문의하기: ${text}`, onClick: () => onAsk?.(text, '질문') },
      h('span', { class: 'rule__pill' }, '문의', h('span', { class: 'rule__chev', 'aria-hidden': 'true' }, '›')))));
}

function installGuide(install) {
  if (install.standalone) return h('p', { class: 'small' }, '지금 홈 화면 앱으로 실행 중입니다.');
  if (install.inApp) {
    return h('div', { class: 'notice' },
      h('p', null, `${install.inApp} 안의 브라우저에서는 홈 화면 추가와 기록 보관이 불안정합니다.`),
      h('p', { class: 'small' }, '오른쪽 위 메뉴(⋮ 또는 ···)에서 "다른 브라우저로 열기"를 눌러 아이폰은 Safari, 안드로이드는 Chrome으로 여세요. 기록은 브라우저마다 따로 저장됩니다.'));
  }
  const items = [];
  if (install.platform === 'ios' || install.platform === 'other') {
    items.push(h('li', null, h('b', null, '아이폰 (Safari): '), '아래쪽 공유 버튼 → "홈 화면에 추가" → 추가. Apple 개발자 계정이나 앱스토어가 필요 없습니다.'));
  }
  if (install.platform === 'android' || install.platform === 'other') {
    items.push(h('li', null, h('b', null, '안드로이드 (Chrome): '), '오른쪽 위 ⋮ → "앱 설치" 또는 "홈 화면에 추가".'));
  }
  return h('div', null,
    install.canPrompt ? h('button', { type: 'button', class: 'btn btn--primary', onClick: install.prompt }, '이 기기에 앱 설치') : null,
    h('ul', { class: 'rules' }, items));
}

/** 복원 확인 시트 */
export function renderRestoreConfirm(root, { current, incoming, fromVersion, issues, exportedAt, onBackupCurrent, onConfirm, onClose }) {
  let understood = false;
  const errorBox = h('div', { class: 'issue-box' });
  const btn = h('button', { type: 'button', class: 'btn btn--danger', disabled: true, 'data-testid': 'confirm-restore', onClick: () => {
    const r = onConfirm();
    if (r && !r.ok) {
      fill(errorBox, h('p', { class: 'form-error', role: 'alert', tabindex: '-1' }, `복원하지 못했습니다. 기존 기록은 그대로입니다. ${r.error ?? ''}`));
      errorBox.firstChild.focus();
    }
  } }, '이 파일로 덮어쓰기');
  const lost = current.service && !incoming.service ? current.service : null;
  const lostReceived = (current.received ?? []).length && !(incoming.received ?? []).length ? (current.received ?? []).length : 0;
  const count = (s) => `휴가 ${s.grants.length}건 · 일정 ${s.trips.length}건 (취소 ${s.trips.filter((t) => t.status === 'cancelled').length}) · 면회외출 시작 ${s.settings.visitBaselineCount}회 · 가점 ${s.merit.points}점 · 받은 일정 ${(s.received ?? []).length}명`;
  fill(root, 
    h('header', { class: 'sheet__head' }, h('h2', null, '백업에서 복원'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    h('div', { class: 'sheet__body' },
      h('dl', { class: 'compare' },
        h('dt', null, '백업 파일'), h('dd', null, count(incoming), exportedAt ? h('span', { class: 'muted small' }, ` (${formatDate(exportedAt.slice(0, 10), { weekday: false, year: true })} 저장)`) : null),
        h('dt', null, '지금 기록'), h('dd', null, count(current))),
      issues.length ? issueList(issues) : null,
      lost ? h('p', { class: 'issue issue--warning', 'data-testid': 'restore-service-warning' },
        `이 백업에는 복무 정보가 없어 지금 복무 정보(입대일 ${formatDate(lost.enlistDate, { weekday: false, year: true })}, ${lost.performanceCycleWeeks}주 주기)가 지워집니다`) : null,
      fromVersion < 3 ? h('p', { class: 'issue issue--warning', 'data-testid': 'restore-merit-warning' },
        '이 백업에는 가점 정보가 없어 가점 0점·기준 없음으로 복원됩니다') : null,
      lostReceived ? h('p', { class: 'issue issue--warning', 'data-testid': 'restore-received-warning' },
        `이 백업에는 받은 일정이 없어 지금 받은 일정 ${lostReceived}명이 지워집니다. 필요하면 나중에 다시 받으세요`) : null,
      h('p', { class: 'small' }, '복원하면 지금 기록이 백업 파일 내용으로 바뀝니다. 먼저 지금 기록을 받아 두세요.'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: onBackupCurrent }, '지금 기록 백업 받기'),
      h('label', { class: 'choice choice--confirm' },
        h('input', { type: 'checkbox', 'data-testid': 'restore-understood', onChange: (e) => { understood = e.target.checked; btn.disabled = !understood; } }),
        h('span', null, '지금 기록이 대체된다는 것을 확인했습니다')),
      errorBox,
      h('div', { class: 'sheet__actions' }, btn, h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '취소'))));
}

const OFFLINE_TEXT = {
  ready: ['ok', '오프라인 준비 완료 — 인터넷 없이도 열립니다.'],
  pending: ['wait', '오프라인 준비 중 — 인터넷이 연결된 상태로 잠시 열어 두세요.'],
  insecure: ['warn', '이 주소는 https가 아니어서 오프라인 실행과 홈 화면 설치가 동작하지 않습니다. 배포된 https 주소로 열어 주세요.'],
  unsupported: ['warn', '이 브라우저는 오프라인 실행을 지원하지 않습니다. Safari 또는 Chrome으로 열어 주세요.'],
  failed: ['warn', '오프라인 준비에 실패했습니다. 인터넷이 연결된 상태에서 다시 열어 주세요.'],
};

function offlineNote(offline) {
  const [tone, text] = OFFLINE_TEXT[offline] ?? OFFLINE_TEXT.pending;
  return h('p', { class: `offline-note offline-note--${tone}`, 'data-testid': 'offline-state', 'data-state': offline }, text);
}

/** 설정 → 받은 일정: 사람별 별명·받은 날짜·건수, 별명 바꾸기, 삭제 */
function receivedSection(received, { onRenameReceived, onRemoveReceived, viewOnly = false, onToggleViewOnly }) {
  const toggle = h('input', { type: 'checkbox', 'data-testid': 'view-only-toggle', checked: viewOnly, onChange: (e) => {
    const r = onToggleViewOnly?.(e.target.checked);
    if (r && !r.ok) e.target.checked = !e.target.checked; // 저장 실패: 체크 상태 복구
  } });
  const row = (e) => {
    const line = h('div', { class: 'received__row' },
      h('i', { class: `person-dot person-bar--c${e.color}`, 'aria-hidden': 'true' }),
      h('span', { class: 'received__name', 'data-testid': `received-name-${e.senderId}` }, e.nickname),
      h('span', { class: 'muted small received__meta' }, `${formatDate(e.receivedOn, { weekday: false })} 받음 · ${e.items.length}건`));
    const actions = h('div', { class: 'btn-row received__actions' });
    const errorBox = h('div', { class: 'issue-box' });
    const showList = () => { errorBox.replaceChildren(); fill(actions,
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'data-testid': `received-rename-${e.senderId}`, onClick: showEdit }, '별명 바꾸기'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'data-testid': `received-remove-${e.senderId}`, onClick: () => {
        if (!window.confirm(`${e.nickname}의 받은 일정 ${e.items.length}건을 지울까요? 다시 받으면 복구됩니다.`)) return;
        const r = onRemoveReceived?.(e.senderId);
        if (r && !r.ok) fill(errorBox, h('p', { class: 'form-error', role: 'alert' }, r.error ?? '지우지 못했습니다.'));
      } }, '삭제')); };
    const showEdit = () => {
      errorBox.replaceChildren();
      const input = h('input', { type: 'text', value: e.nickname, maxlength: NICKNAME_LIMIT, 'aria-label': '새 별명', 'data-testid': `received-nickname-${e.senderId}` });
      fill(actions, input,
        h('button', { type: 'button', class: 'btn btn--primary btn--small', 'data-testid': `received-rename-save-${e.senderId}`, onClick: () => {
          const r = onRenameReceived?.(e.senderId, input.value);
          if (r && !r.ok) fill(errorBox, h('p', { class: 'form-error', role: 'alert' }, r.error ?? '저장하지 못했습니다.'));
        } }, '저장'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onClick: showList }, '취소'));
      input.focus();
    };
    showList();
    return h('li', { class: 'received' }, line, actions, errorBox);
  };
  return h('section', { 'aria-labelledby': 'received-title', 'data-testid': 'received-section' },
    h('h2', { id: 'received-title', class: 'section-title' }, '받은 일정'),
    h('label', { class: 'choice choice--confirm view-only-switch' }, toggle,
      h('span', null, viewOnly ? '받은 일정만 보기 (가족·지인용) — 끄면 내 기록 쓰기 시작' : '받은 일정만 보기 (가족·지인용)')),
    h('p', { class: 'muted small' }, '켜면 내 휴가·일정 화면을 숨기고 받은 일정만 달력에 보여 줍니다. 내 기록은 지워지지 않고, 끄면 다시 보입니다.'),
    received.length
      ? [h('p', { class: 'small' }, '동기에게 받은 날짜입니다. 달력에 사람마다 다른 색 막대로 보이고, 내 휴가 계산에는 들어가지 않습니다. 바뀐 일정은 다시 받아야 합니다.'),
        h('ul', { class: 'received-list' }, received.map(row))]
      : h('p', { class: 'small' }, '받은 일정이 없습니다. 달력의 "일정 받기"에서 코드나 링크를 붙여넣으세요.'));
}

/** 설정 → 내 복무 정보 요약 */
function serviceSection(service, today, onEditService) {
  const schedule = service ? computeSchedule(service, today) : null;
  return h('section', { 'aria-labelledby': 'service-title' },
    h('div', { class: 'section-head' },
      h('h2', { id: 'service-title', class: 'section-title' }, '내 복무 정보'),
      h('button', { type: 'button', class: 'btn btn--primary btn--small', 'data-testid': 'edit-service', onClick: onEditService }, service ? '수정' : '입력')),
    schedule
      ? h('dl', { class: 'compare svc-summary' },
        h('dt', null, '입대일'), h('dd', null, dotDate(service.enlistDate)),
        h('dt', null, '성과제 주기'), h('dd', null, `${service.performanceCycleWeeks}주`),
        Object.entries(SERVICE_DATE_LABELS).flatMap(([k, label]) => [
          h('dt', null, label), h('dd', null, dotDate(schedule[k]), schedule.overridden[k] ? h('span', { class: 'chip chip--override' }, '직접 수정함') : null)]))
      : h('p', { class: 'small' }, '입대일을 넣으면 진급일·전역일·성과제외박 날짜를 계산해 달력과 내 휴가 화면에 보여 줍니다.'));
}
