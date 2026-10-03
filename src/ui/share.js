// 일정 공유 시트들: 고르기 → 방법(QR·링크·가족 문장) → 각 화면. 코드는 시트 안에서만 살고 저장하지 않는다.
import { h, fill, formatRange, formatDate, issueList } from './dom.js';
import { tripDates, SHARE_ITEMS_LIMIT, NICKNAME_LIMIT, RECEIVED_LIMIT } from '../domain/model.js';
import { compareDates } from '../domain/dates.js';
import { previewLines } from '../domain/share-text.js';
import { renderQrSvg } from './qr.js';

/** 공유 대상: 취소되지 않았고 아직 끝나지 않은 일정, 시작일순 */
export function shareableTrips(state, today) {
  return state.trips
    .filter((t) => t.status !== 'cancelled' && t.segments.length && compareDates(tripDates(t).end, today) >= 0)
    .sort((a, b) => compareDates(tripDates(a).start, tripDates(b).start));
}

/** 선택 화면에서 실제로 확인한 일정과 현재 기록을 비교한다. 선택 순서는 무관하다. */
export function shareSelectionKey(trips) {
  return JSON.stringify(trips.map((t) => ({ id: t.id, ...tripDates(t), confirmed: t.shareConfirmed === true }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

const OLD_APP_NOTE = '받기 창이 안 뜨면 상대가 설정에서 새 버전을 적용하고 링크를 다시 열면 됩니다.';
export const LINK_NOTICE = '날짜, 계획·확정 표시, 내 공유 번호, 만든 날짜만 담깁니다. 휴가 종류·이름·부대 정보는 없습니다. 메신저 대화방에 링크가 남습니다.';

function head(title, onClose) {
  return h('header', { class: 'sheet__head' }, h('h2', null, title),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onClick: onClose }, '✕'));
}

/**
 * 공유할 일정 고르기. 확정 표시는 즉시 저장(onToggleConfirmed)되고 실패하면 저장값으로 되돌린다.
 * 다음(onNext)은 고른 id 목록과 확인한 내용의 비교값을 넘긴다. {ok, error}이면 시트 안에 오류를 보여 준다.
 * @returns {{isDirty:()=>boolean}}
 */
export function renderSharePick(root, { state, today, onToggleConfirmed, onNext, onClose }) {
  let trips = shareableTrips(state, today);
  const selected = new Set(trips.map((t) => t.id));
  const errorBox = h('div', { class: 'issue-box' });
  const note = h('p', { class: 'muted small share-pick__count' });
  const showError = (msg) => fill(errorBox, h('p', { class: 'form-error', role: 'alert', 'data-testid': 'share-error' }, msg));
  const next = h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'share-next', onClick: () => {
    const r = onNext([...selected], shareSelectionKey(trips.filter((t) => selected.has(t.id))));
    if (r && !r.ok) showError(r.error ?? '공유를 시작하지 못했습니다.');
  } }, '다음');
  const update = () => {
    const n = selected.size;
    next.disabled = n === 0 || n > SHARE_ITEMS_LIMIT;
    note.textContent = n > SHARE_ITEMS_LIMIT ? `${SHARE_ITEMS_LIMIT}건까지 보낼 수 있습니다 (지금 ${n}건)` : n === 0 ? '보낼 일정을 하나 이상 고르세요' : `${n}건을 보냅니다`;
  };
  const row = (t) => {
    const { start, end } = tripDates(t);
    const saved = () => (t.shareConfirmed ? 'confirmed' : 'planned');
    const radios = {};
    const radio = (value, label) => h('label', { class: 'choice choice--inline' },
      radios[value] = h('input', { type: 'radio', name: `share-status-${t.id}`, value, checked: saved() === value,
        onChange: () => {
          const r = onToggleConfirmed(t.id, value === 'confirmed');
          if (r && !r.ok) {
            // 저장 실패: 화면이 확정인데 실제 전송은 계획이 되지 않도록 저장값으로 되돌린다
            radios[saved()].checked = true;
            showError(r.error ?? '확정 표시를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
          } else {
            t = { ...t, shareConfirmed: value === 'confirmed' };
            trips = trips.map((savedTrip) => savedTrip.id === t.id ? t : savedTrip);
            errorBox.replaceChildren();
          }
        } }),
      h('span', null, label));
    return h('li', { class: 'share-item' },
      h('label', { class: 'choice share-item__pick' },
        h('input', { type: 'checkbox', checked: true, 'data-testid': `share-pick-${t.id}`, onChange: (e) => { if (e.target.checked) selected.add(t.id); else selected.delete(t.id); update(); } }),
        h('span', { class: 'share-item__text' }, h('b', { class: 'share-item__title' }, t.title), h('span', { class: 'share-item__dates' }, formatRange(start, end)))),
      h('div', { class: 'share-item__status' }, radio('planned', '계획'), radio('confirmed', '확정')));
  };
  update();
  fill(root,
    head('일정 공유', onClose),
    h('div', { class: 'sheet__body' },
      trips.length
        ? [h('p', { class: 'small' }, '보낼 일정을 고르고, 동기와 맞춘 날이면 확정으로 표시하세요. 확정은 본인이 표시하는 것이고 승인과는 무관합니다.'),
          h('ul', { class: 'share-list' }, trips.map(row)), note, errorBox,
          h('div', { class: 'sheet__actions' }, next, h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '취소'))]
        : [h('p', { class: 'notice' }, '공유할 일정이 없습니다 — 아직 끝나지 않은 계획·사용완료 일정만 보낼 수 있습니다.'),
          h('div', { class: 'sheet__actions' }, h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: onClose }, '닫기'))]));
  return { isDirty: () => false };
}

/** 보내는 방법 셋 */
export function renderShareMethods(root, { count, onQr, onLink, onFamily, onClose }) {
  fill(root,
    head('보내는 방법', onClose),
    h('div', { class: 'sheet__body' },
      h('p', { class: 'small' }, `일정 ${count}건을 담은 코드를 만들었습니다. 코드는 저장되지 않고 이 창을 닫으면 사라집니다.`),
      h('div', { class: 'share-methods' },
        method('QR 보이기', '옆에 있는 동기가 휴대폰 카메라로 찍습니다. 서버를 거치지 않고 그 휴대폰에만 들어갑니다.', 'share-qr', onQr),
        method('링크 보내기', '멀리 있는 동기에게 메신저로 보냅니다. 대화방에 링크가 남습니다.', 'share-link', onLink),
        method('가족에게 문장 보내기', '앱이 없는 가족·지인에게 읽기 쉬운 글로 보냅니다.', 'share-family', onFamily)),
      h('div', { class: 'sheet__actions' }, h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: onClose }, '닫기'))));
  return { isDirty: () => false };
}

function method(title, desc, testId, onClick) {
  return h('button', { type: 'button', class: 'share-method', 'data-testid': testId, onClick },
    h('b', { class: 'share-method__title' }, title), h('span', { class: 'share-method__desc small' }, desc));
}

/** QR 화면. 그리기 실패는 안내 문구로. */
export function renderQrSheet(root, { link, onBack, onClose }) {
  let figure;
  try {
    const svg = renderQrSvg(link);
    figure = h('div', { class: 'share-qr' }, svg);
  } catch {
    figure = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'share-qr-error' }, 'QR을 만들 수 없습니다. 링크 보내기를 쓰세요.');
  }
  fill(root,
    head('QR 보이기', onClose),
    h('div', { class: 'sheet__body' },
      figure,
      h('p', { class: 'small' }, '동기가 휴대폰 카메라로 찍으면 앱이 열립니다.'),
      h('p', { class: 'muted small' }, OLD_APP_NOTE),
      h('div', { class: 'sheet__actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onClick: onBack }, '다른 방법'), h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기'))));
  return { isDirty: () => false };
}

/** 링크 보내기 전 안내. 확인 단추가 바로 공유를 호출해야 사용자 제스처가 유지된다. */
export function renderLinkNotice(root, { onConfirm, onBack, onClose }) {
  fill(root,
    head('링크 보내기', onClose),
    h('div', { class: 'sheet__body' },
      h('p', { class: 'notice' }, LINK_NOTICE),
      h('p', { class: 'muted small' }, OLD_APP_NOTE),
      h('div', { class: 'sheet__actions' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'share-link-confirm', onClick: onConfirm }, '보내기'),
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: onBack }, '다른 방법'))));
  return { isDirty: () => false };
}

/** 가족 문장 미리보기 */
export function renderFamilyPreview(root, { text, onSend, onBack, onClose }) {
  fill(root,
    head('가족에게 문장 보내기', onClose),
    h('div', { class: 'sheet__body' },
      h('p', { class: 'small' }, '아래 글을 그대로 보냅니다. 휴가 종류·부대 정보는 없고, 메신저에 글이 남습니다.'),
      h('pre', { class: 'share-preview', 'data-testid': 'share-family-preview' }, text),
      h('div', { class: 'sheet__actions' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'share-family-send', onClick: onSend }, '보내기'),
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: onBack }, '다른 방법'))));
  return { isDirty: () => false };
}

/* ---------------- 받기 ---------------- */

/** 코드·링크 읽기 오류 문구 (스펙 §오류 처리) */
export const RECEIVE_ERRORS = Object.freeze({
  'too-long': '코드가 손상되었거나 잘렸습니다. 링크나 코드를 다시 붙여넣어 주세요.',
  corrupt: '코드가 손상되었거나 잘렸습니다. 링크나 코드를 다시 붙여넣어 주세요.',
  'unknown-version': '새 버전 앱에서 만든 코드입니다. 앱을 업데이트해 주세요.',
  own: '내가 만든 코드입니다.',
  limit: `받은 일정은 ${RECEIVED_LIMIT}명까지 보관할 수 있습니다. 설정에서 정리해 주세요.`,
});

/** 코드·링크 붙여넣기. 오류 뒤에도 text로 입력을 보존한다. */
export function renderReceiveInput(root, { text = '', onSubmit, onClose, error = null }) {
  const area = h('textarea', { rows: 4, class: 'receive-text', 'data-testid': 'receive-text', placeholder: '받은 링크나 코드를 붙여넣으세요', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }, text);
  fill(root,
    head('일정 받기', onClose),
    h('div', { class: 'sheet__body' },
      h('p', { class: 'small' }, '동기가 보낸 링크나 코드를 붙여넣으세요. 카메라로 QR을 찍었다면 이 창이 자동으로 열립니다.'),
      area,
      error ? h('div', { class: 'issue-box' }, h('p', { class: 'form-error', role: 'alert', 'data-testid': 'receive-error' }, error)) : null,
      h('div', { class: 'sheet__actions' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'receive-submit', onClick: () => onSubmit(area.value) }, '확인'),
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '취소'))));
  return { isDirty: () => false };
}

/**
 * 받은 코드 확인·저장. classification은 classifyIncoming 결과.
 * own·duplicate·limit은 저장 없이 이유와 '다시 붙여넣기'. iOS Safari(비설치)·인앱 브라우저는 '홈 화면 앱으로 가져오기'(코드 복사)를 함께 보인다.
 */
export function renderReceiveSheet(root, { payload, classification, nickname = '', viewOnly: viewOnlyInitial = false, install, firstRun = false, notice = null, onSave, onCopyForApp, onRetry, onClose }) {
  const n = payload.items.length;
  const preview = h('div', { class: 'receive-preview' },
    h('p', { class: 'small' }, `${formatDate(payload.issuedOn, { weekday: false })}에 만든 일정 ${n}건`),
    h('ul', { class: 'receive-lines', 'data-testid': 'receive-preview' }, previewLines(payload.items).map((line) => h('li', null, line))));
  const kind = classification.kind;
  const needsCopy = (install.platform === 'ios' && !install.standalone) || Boolean(install.inApp);
  const copiedNote = h('p', { class: 'small receive-copied', 'data-testid': 'receive-copied-note', hidden: true }, '코드를 복사했습니다. 홈 화면의 출타 장부를 열어 달력 → 일정 받기에 붙여넣으세요.');
  const copyBtn = h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'receive-copy-app', onClick: async () => { const r = await onCopyForApp(); if (r === 'copied') copiedNote.hidden = false; } }, '홈 화면 앱으로 가져오기');
  const copyGuide = install.inApp
    ? h('p', { class: 'notice small' }, `${install.inApp} 안의 브라우저에서는 기록 보관이 불안정합니다. 코드를 복사해 Safari 또는 Chrome의 출타 장부에 붙여넣는 것이 안전합니다.`)
    : needsCopy && install.platform === 'ios'
      ? h('p', { class: 'small' }, '홈 화면 앱(출타 장부)과 이 브라우저는 기록이 따로 저장됩니다. 평소 홈 화면 앱을 쓴다면 아래에서 가져오기를 누르세요.') : null;
  if (kind === 'own' || kind === 'duplicate' || kind === 'limit') {
    // 이 브라우저의 중복 기록은 별도 저장소인 홈 화면 앱으로 복사하는 것을 막지 않는다.
    const canCopy = kind === 'duplicate' && needsCopy;
    const msg = kind === 'duplicate'
      ? `이미 받은 일정입니다 (${classification.entry.nickname}, ${formatDate(classification.entry.receivedOn, { weekday: false })} 받음)`
      : RECEIVE_ERRORS[kind];
    fill(root,
      head('일정 받기', onClose),
      h('div', { class: 'sheet__body' }, preview,
        h('div', { class: 'issue-box' }, h('p', { class: 'form-error', role: 'alert', 'data-testid': 'receive-error' }, msg)),
        canCopy ? [copyGuide, copiedNote] : null,
        h('div', { class: canCopy ? 'sheet__actions sheet__actions--stack' : 'sheet__actions' },
          canCopy ? copyBtn : null,
          h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'receive-retry', onClick: onRetry }, '다시 붙여넣기'),
          h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '닫기'))));
    return { isDirty: () => false };
  }
  const replace = kind === 'replace' ? classification : null;
  const prefill = nickname || replace?.entry.nickname || '';
  let name = prefill;
  let viewOnly = firstRun && viewOnlyInitial;
  const saveButtons = [];
  const mkSave = (label, testId, target) => {
    const b = h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': testId, disabled: !name.trim(), onClick: () => onSave({ nickname: name, viewOnly, target }) }, label);
    saveButtons.push(b);
    return b;
  };
  const input = h('input', { id: 'receive-nickname', type: 'text', value: name, maxlength: NICKNAME_LIMIT, placeholder: '예: 철수', autocomplete: 'off',
    onInput: (e) => { name = e.target.value; for (const b of saveButtons) b.disabled = !name.trim(); } });
  fill(root,
    head('일정 받기', onClose),
    h('div', { class: 'sheet__body' },
      notice ? h('p', { class: 'notice', role: 'status', 'data-testid': 'receive-notice' }, notice) : null,
      preview,
      replace ? h('p', { class: 'issue issue--warning', 'data-testid': 'receive-replace' },
        `${replace.entry.nickname}의 기존 일정 ${replace.entry.items.length}건을 이 일정 ${n}건으로 바꿉니다.`,
        replace.older ? h('b', { 'data-testid': 'receive-older' }, ' 저장된 것보다 더 오래된 일정으로 바꿉니다.') : null) : null,
      h('div', { class: 'field' }, h('label', { for: 'receive-nickname' }, '누구의 일정인가요? (별명)'), input,
        h('p', { class: 'muted small' }, '코드에는 이름이 없습니다. 내 달력에서 구분할 별명만 이 휴대폰에 저장됩니다.')),
      firstRun ? h('label', { class: 'choice' },
        h('input', { type: 'checkbox', 'data-testid': 'receive-view-only', checked: viewOnly, onChange: (e) => { viewOnly = e.target.checked; } }),
        h('span', null, '내 기록 없이 받은 일정만 볼게요 (가족·지인용)')) : null,
      copyGuide,
      copiedNote,
      h('div', { class: needsCopy ? 'sheet__actions sheet__actions--stack' : 'sheet__actions' },
        needsCopy ? [mkSave('이 브라우저에 저장', 'receive-save-here', 'here'), copyBtn] : mkSave('저장', 'receive-save', 'here'),
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: onClose }, '취소'))));
  return { isDirty: () => Boolean(name.trim()) && name.trim() !== prefill.trim() };
}

export { issueList };
