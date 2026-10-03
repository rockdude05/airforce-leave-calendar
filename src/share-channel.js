// 글 한 덩이를 밖으로 내보내는 공통 체인: 기기 공유 시트 → 클립보드 → 수동 복사 상자.
// 규칙 문의(feedback.js)와 일정 공유(ui/share.js)가 함께 쓴다. 무엇을 담을지는 호출자가 정한다.
import { h, fill } from './ui/dom.js';

/** navigator는 늦게 읽는다 — Node 테스트·오래된 브라우저에서 없을 수 있다. */
function defaultShare() {
  const n = globalThis.navigator;
  return typeof n?.share === 'function' ? n.share.bind(n) : null;
}
function defaultClipboard() {
  return globalThis.navigator?.clipboard ?? null;
}

/**
 * 클립보드 전용. 공유 시트를 열지 않는다 (아이폰 '홈 화면 앱으로 가져오기'처럼 복사만 필요할 때).
 * @returns {Promise<'copied'|'manual'>}
 */
export async function copyText(text, { clipboard = defaultClipboard() } = {}) {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return 'copied';
    } catch {
      // 클립보드 거부 — 수동 상자로
    }
  }
  return 'manual';
}

/**
 * 공유 시트 → 클립보드 → 수동. 사용자가 공유 시트를 닫은 것(AbortError)은 실패가 아니라 'cancelled'로 끝낸다.
 * @returns {Promise<'shared'|'cancelled'|'copied'|'manual'>}
 */
export async function shareText(text, { share = defaultShare(), clipboard = defaultClipboard() } = {}) {
  if (typeof share === 'function') {
    try {
      await share({ text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // 공유 실패 — 클립보드로
    }
  }
  return copyText(text, { clipboard });
}

/** 복사·공유가 모두 안 될 때 보여주는 선택 가능한 글 상자 시트 */
export function renderManualText(root, { title, note, text, testId = 'manual-text', onClose }) {
  const textarea = h('textarea', {
    // 읽기 전용이라 키보드가 뜨지 않으므로 autofocus 허용 — 시트를 연 뒤(showModal) 이 칸에 초점이 간다
    readonly: true, autofocus: true, rows: 7, class: 'feedback-manual-text', 'data-testid': testId,
    onFocus: (e) => e.target.select(),
  }, text);
  fill(root,
    h('header', { class: 'sheet__head' }, h('h2', null, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕')),
    h('div', { class: 'sheet__body' },
      h('p', { class: 'small' }, note),
      textarea,
      h('div', { class: 'sheet__actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기'))));
}
