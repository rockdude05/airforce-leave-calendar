// 규칙 문의: 미리 채운 구글 폼을 새 창으로 열거나, 폼이 없으면 공유/복사/수동 텍스트로 대체한다.
// 휴가 기록·이름·연락처는 이 모듈에서 전송하지 않는다 — 규칙 항목 이름, 문의 유형, 앱 버전, 규칙 버전만 담는다.
import { APP_VERSION } from './version.js';
import { RULE_VERSION } from './domain/model.js';
import { h, fill } from './ui/dom.js';

/**
 * 구글 폼 설정. url이 비어 있으면 공유/복사로 대체한다.
 * fields의 entry.* 값은 자리표시자 — 실제 폼을 만든 뒤 받은 미리 채우기 링크의 항목 ID로 바꾼다.
 * (docs/feedback/google-form-setup.md 참고)
 */
// 개발자의 '출타 장부 규칙 문의' 폼 (2026-10-02 게시, 이메일 미수집·로그인 없이 응답).
// 항목 번호는 공개 폼의 FB_PUBLIC_LOAD_DATA_에서 확인한 값이다. 폼 문항을 바꾸면 docs/feedback/google-form-setup.md대로 다시 확인한다.
export const FEEDBACK_FORM = {
  url: 'https://docs.google.com/forms/d/e/1FAIpQLScF3fBDJAddg3AWzILfIt7gbpZFt0yPSpRsm3vBrCao8yWOaQ/viewform?usp=pp_url',
  fields: {
    rule: 'entry.56584976',
    type: 'entry.796468957',
    appVersion: 'entry.300406107',
    ruleVersion: 'entry.255218677',
  },
};

/** 설정 → 적용 규칙 화면에 쓰는 규칙 항목 이름 목록 */
export const RULE_TOPICS = {
  calculated: [
    '휴가 일수는 시작일과 끝나는 날을 모두 셉니다. 주말도 포함합니다.',
    '정기휴가 기준: 일병 10일, 상병 8일, 병장 10일. 안내값이며 자동으로 지급하지 않습니다.',
    '휴가끼리는 이어서 쓸 수 있습니다. 한 일정 안에서 휴가 종류별로 구간을 나눕니다.',
    '면회외출은 복무 중 총 7번입니다(3개월 주기 없음). 7번을 넘기면 경고합니다. 방문자는 묻지 않습니다.',
    '외출은 한 달에 2번이고, 쓰지 않은 횟수는 다음 달로 넘어가지 않습니다. 같은 달 3번째부터 경고합니다.',
    '후급: 성과제외박만 쓴 출타와 정기휴가(연가)가 하루라도 들어간 출타는 후급이 나오지 않습니다.',
    '만료일이 있는 휴가는 만료일 당일까지 배정할 수 있습니다.',
    '수료일: 입대한 주를 1주째로 세어 5주째 금요일. 진급: 1일 입대면 입대월, 아니면 다음 달 1일부터 2·8·14개월 뒤 1일. 전역일: 21개월 뒤 같은 날의 전날.',
    '성과제외박: 사용자가 고른 주기로 생기는 날을 계산, 사용 기한·분할은 판정하지 않음. 전역 전에 다 차지 않는 마지막 회차 일수는 직접 입력합니다.',
    '부대에서 받은 날짜가 계산과 다르면 내 복무 정보에서 그 날짜만 직접 고칠 수 있습니다. 고쳐도 이미 저장한 일정은 바뀌지 않습니다.',
  ],
  unconfirmed: [
    '후급 대상 여부 — 정기휴가 없이 쓰는 출타(포상·위로·보상·청원 등)',
    '진급 누락, 외출 시간, 정기휴가 이월·소멸, 연속 출타 상한',
    '외출과 휴가를 바로 이어 쓰는 조건',
  ],
};

/** 검증 안내 코드 -> 문의할 규칙 항목 이름. 매핑이 없는 코드는 "문의하기"를 붙이지 않는다. */
export const ISSUE_TOPIC = {
  TRANSPORT_UNCONFIRMED: '후급 대상 여부',
  TRANSPORT_NONE_REGULAR: '후급 기준 (정기휴가 포함·성과제 단독)',
  TRANSPORT_NONE_PERFORMANCE: '후급 기준 (정기휴가 포함·성과제 단독)',
  COMBINATION_UNCONFIRMED: '휴가와 성과제외박 연결',
};

export const FEEDBACK_TYPES = ['질문', '규칙이 틀림', '부대에서 확인한 답', '기타'];

/** 폼 URL + 미리 채우기 쿼리. 폼이 없으면 null. */
export function buildFormUrl(form, { rule, type }, versions = {}) {
  if (!form?.url) return null;
  const { appVersion = APP_VERSION, ruleVersion = RULE_VERSION } = versions;
  const pairs = [
    [form.fields.rule, rule],
    [form.fields.type, type],
    [form.fields.appVersion, appVersion],
    [form.fields.ruleVersion, ruleVersion],
  ];
  const query = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`).join('&');
  return `${form.url}${form.url.includes('?') ? '&' : '?'}${query}`;
}

/** 공유/복사/수동 대체에 쓰는 글. 휴가 기록·이름·연락처는 담지 않는다. */
export function buildShareText({ rule, type }, versions = {}) {
  const { appVersion = APP_VERSION, ruleVersion = RULE_VERSION } = versions;
  return [
    '[출타 장부 규칙 문의]',
    `규칙 항목: ${rule}`,
    `문의 유형: ${type}`,
    `앱 버전: ${appVersion}`,
    `규칙 버전: ${ruleVersion}`,
    '',
    '(아래에 내용을 적어 보내 주세요. 군번·실명·작전 정보·실제 출타 일정은 적지 마세요)',
  ].join('\n');
}

/**
 * 규칙 문의 보내기.
 * 폼 주소가 있고 온라인이면 새 창으로 열고 'opened'. 폼이 없거나 오프라인이면
 * navigator.share -> 클립보드 -> 수동 순으로 대체한다 (spec 3.2).
 * @param {{online?: boolean}} [opts] online은 테스트에서 주입할 수 있다. 기본값은 navigator.onLine.
 * @returns {Promise<'opened'|'shared'|'cancelled'|'copied'|'manual'>}
 */
export async function sendFeedback({ rule, type }, { online = navigator.onLine } = {}) {
  const versions = { appVersion: APP_VERSION, ruleVersion: RULE_VERSION };
  const url = online ? buildFormUrl(FEEDBACK_FORM, { rule, type }, versions) : null;
  if (url) {
    window.open(url, '_blank', 'noopener');
    return 'opened';
  }
  const text = buildShareText({ rule, type }, versions);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // 공유 실패 — 클립보드로 대체
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      // 클립보드 거부 — 수동 텍스트 상자로 대체
    }
  }
  return 'manual';
}

/** 복사·공유가 모두 안 될 때 보여주는 선택 가능한 텍스트 상자 시트 */
export function renderManualFeedback(root, { rule, type, onClose }) {
  const text = buildShareText({ rule, type }, { appVersion: APP_VERSION, ruleVersion: RULE_VERSION });
  const textarea = h('textarea', {
    // 읽기 전용이라 키보드가 뜨지 않으므로 autofocus 허용 — 시트를 연 뒤(showModal) 이 칸에 초점이 간다
    readonly: true, autofocus: true, rows: 7, class: 'feedback-manual-text', 'data-testid': 'feedback-manual-text',
    onFocus: (e) => e.target.select(),
  }, text);
  fill(root,
    h('header', { class: 'sheet__head' }, h('h2', null, '문의 내용'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    h('div', { class: 'sheet__body' },
      h('p', { class: 'small' }, '자동으로 보내거나 복사하지 못했습니다. 아래 내용을 길게 눌러 복사한 뒤 메모·메시지로 보내 주세요.'),
      textarea,
      h('div', { class: 'sheet__actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기'))));
}
