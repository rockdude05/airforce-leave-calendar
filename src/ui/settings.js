import { h, fill, issueList } from './dom.js';
import { RULE_VERSION } from '../domain/model.js';
import { dotDate, SERVICE_DATE_LABELS } from './service.js';
import { computeSchedule } from '../domain/service.js';
import { RULE_TOPICS } from '../feedback.js';

/**
 * 설정 화면: 백업·복원, 홈 화면 추가 안내, 적용 규칙
 * @param {HTMLElement} root
 */
export function renderSettings(root, { state, today, onEditService, onExport, onImportFile, importIssues, install, offline, update, appVersion, onAsk }) {
  const fileInput = h('input', {
    type: 'file', id: 'restore-file', accept: 'application/json,.json', class: 'sr-only',
    onChange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportFile(f); },
  });
  fill(root, 
    h('h1', { class: 'view-title' }, '설정'),
    update.waiting ? h('section', { class: 'notice notice--update', role: 'status' },
      h('p', null, '새 버전이 준비되었습니다. 작성 중인 내용이 없을 때 적용하세요.'),
      h('button', { type: 'button', class: 'btn btn--primary btn--small', onClick: update.apply }, '새 버전 적용')) : null,
    serviceSection(state.service, today, onEditService),
    h('section', { 'aria-labelledby': 'backup-title' },
      h('h2', { id: 'backup-title', class: 'section-title' }, '기록 백업과 복원'),
      h('p', { class: 'small' }, '기록은 이 휴대폰의 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우거나 휴대폰을 바꾸면 사라지니 가끔 백업 파일을 받아 두세요.'),
      h('p', { class: 'muted small' }, `현재 기록: 휴가 ${state.grants.length}건, 일정 ${state.trips.length}건`),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'export', onClick: onExport }, '백업 파일 받기'),
        h('label', { for: 'restore-file', class: 'btn btn--ghost', 'data-testid': 'import-label', tabindex: '0',
          onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, '백업에서 복원'),
        fileInput),
      importIssues?.length ? h('div', { class: 'issue-box' }, h('p', { class: 'form-error' }, '이 파일로는 복원하지 않았습니다. 기존 기록은 그대로입니다.'), issueList(importIssues)) : null),
    h('section', { 'aria-labelledby': 'install-title' },
      h('h2', { id: 'install-title', class: 'section-title' }, '홈 화면에 추가'),
      offlineNote(offline),
      installGuide(install)),
    h('section', { 'aria-labelledby': 'rules-title' },
      h('h2', { id: 'rules-title', class: 'section-title' }, '적용 규칙'),
      h('p', { class: 'muted small' }, `작근단 수송대대 병 기준 · 규칙 버전 ${RULE_VERSION}`),
      h('h3', { class: 'sub-title' }, '앱이 계산하는 것'),
      h('ul', { class: 'rules' }, ruleItems(RULE_TOPICS.calculated, onAsk)),
      h('h3', { class: 'sub-title' }, '부대 확인이 필요해 판정하지 않는 것'),
      h('ul', { class: 'rules rules--open' }, ruleItems(RULE_TOPICS.unconfirmed, onAsk, { emphasize: true }))),
    h('section', { 'aria-labelledby': 'feedback-title' },
      h('h2', { id: 'feedback-title', class: 'section-title' }, '의견 보내기'),
      h('p', { class: 'small' }, '위 규칙에 없는 내용이나 그 외 의견은 아래로 보내 주세요. 앱은 휴가 기록·이름·연락처를 보내지 않습니다. 군번·실명·작전 정보·실제 출타 일정은 적지 마세요.'),
      h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'feedback-general',
        onClick: () => onAsk?.('일반 의견', '기타') }, '일반 의견 보내기')),
    h('p', { class: 'muted small app-version' }, `출타 장부 ${appVersion} · 개인 기록은 서버로 전송되지 않습니다. 공식 휴가 승인·판정 도구가 아니며, 최종 판단은 부대 행정 기준을 따릅니다.`));
}

function ruleItems(topics, onAsk, { emphasize = false } = {}) {
  return topics.map((text) => h('li', { class: emphasize ? 'rule--open' : null },
    h('span', { class: 'rule__text' }, text),
    h('button', { type: 'button', class: `btn btn--ghost btn--small rule__ask${emphasize ? ' rule__ask--emphasize' : ''}`,
      onClick: () => onAsk?.(text, '질문') }, '문의하기')));
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
export function renderRestoreConfirm(root, { current, incoming, issues, exportedAt, onBackupCurrent, onConfirm, onClose }) {
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
  const count = (s) => `휴가 ${s.grants.length}건 · 일정 ${s.trips.length}건 (취소 ${s.trips.filter((t) => t.status === 'cancelled').length}) · 면회외출 시작 ${s.settings.visitBaselineCount}회`;
  fill(root, 
    h('header', { class: 'sheet__head' }, h('h2', null, '백업에서 복원'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    h('div', { class: 'sheet__body' },
      h('dl', { class: 'compare' },
        h('dt', null, '백업 파일'), h('dd', null, count(incoming), exportedAt ? h('span', { class: 'muted small' }, ` (${exportedAt.slice(0, 10)} 저장)`) : null),
        h('dt', null, '지금 기록'), h('dd', null, count(current))),
      issues.length ? issueList(issues) : null,
      lost ? h('p', { class: 'issue issue--warning', 'data-testid': 'restore-service-warning' },
        `이 백업에는 복무 정보가 없어 지금 복무 정보(입대일 ${lost.enlistDate}, ${lost.performanceCycleWeeks}주 주기)가 지워집니다`) : null,
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
