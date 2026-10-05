// 컨트롤러: 모든 변경 후보를 검증하고, 저장에 성공한 뒤에만 화면 상태를 바꾼다.
import { seoulToday } from './domain/dates.js';
import { createEmptyState, STORAGE_KEY, RULE_VERSION, newId } from './domain/model.js';
import { calculateBalances } from './domain/balances.js';
import { validateTrip, validateGrantChange, validateGrantDelete, validateSettings } from './domain/validation.js';
import { convertMerit } from './domain/merit.js';
import { planPromotionGrants, promotionEntryAfterEdit, promotionGrantsAfterDelete, entryForGrant } from './domain/promotion.js';
import { snapshotGrantKinds, hasChangedGrantKinds, resetPreparationForGrant } from './domain/preparation.js';
import { loadState, saveState, serializeBackup, parseBackup, MAX_BACKUP_BYTES } from './storage.js';
import { h, fill } from './ui/dom.js';
import { renderCalendar } from './ui/calendar.js';
import { renderGrants, renderGrantForm, renderVisitForm, renderMeritForm } from './ui/grants.js';
import { renderTripEditor } from './ui/trip-editor.js';
import { renderSettings, renderRestoreConfirm } from './ui/settings.js';
import { renderGuide } from './ui/guide.js';
import { renderServiceForm, plainDot, autoGrantPlanKey } from './ui/service.js';
import { computeSchedule, validateService } from './domain/service.js';
import { addDays } from './domain/dates.js';
import { APP_VERSION } from './version.js';
import { sendFeedback, renderManualFeedback } from './feedback.js';
import { shareText, copyText, renderManualText } from './share-channel.js';
import { encodeShare, buildShareLink, extractCode, decodeShare } from './domain/share-codec.js';
import { familyText } from './domain/share-text.js';
import { newShareId, tripDates } from './domain/model.js';
import { classifyIncoming, applyIncoming, renameReceived, removeReceived } from './domain/received.js';
import { shareableTrips, shareSelectionKey, renderSharePick, renderShareMethods, renderQrSheet, renderLinkNotice, renderFamilyPreview, renderReceiveInput, renderReceiveSheet, RECEIVE_ERRORS } from './ui/share.js';

export { APP_VERSION };

const storage = {
  getItem: (k) => window.localStorage.getItem(k),
  setItem: (k, v) => window.localStorage.setItem(k, v),
};

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
const sheet = /** @type {HTMLDialogElement} */ (document.getElementById('sheet'));
const tabs = /** @type {HTMLElement} */ (document.getElementById('tabs'));

let today = seoulToday();
/** @type {any} */
let state = null;
let month = today.slice(0, 7);
let selected = today;
/** 링크(#s=코드)로 열렸을 때 받으려는 코드. 주소에서는 바로 지우고 메모리에만 둔다. 기록 복구 중에도 잃지 않는다. */
let pendingShareCode = readShareHash();
let view = viewFromHash();
/** @type {{isDirty:()=>boolean}|null} */
let sheetHandle = null;
let importIssues = [];
/** @type {ServiceWorker|null} */
let waitingWorker = null;
let updateRequested = false;
/** 다른 창이 새 서비스 워커를 이미 켰다 — 이 창은 새로고침만 하면 새 버전이 된다 */
let controllerChanged = false;
/** @type {any} */
let installPrompt = null;
let persistAsked = false;
/** 오프라인 준비 상태: unsupported | insecure | pending | ready | failed */
let offlineState = 'pending';
/** 마지막으로 읽거나 쓴 저장 원문. 다른 창이 바꿨는지 비교하는 데 쓴다. */
let lastRaw = /** @type {string|null|undefined} */ (undefined);

/* ---------------- 공통 ---------------- */

function viewFromHash() {
  const v = location.hash.replace('#', '');
  if (v === 'grants' && viewOnly()) return 'calendar';
  return ['calendar', 'grants', 'settings'].includes(v) ? v : 'calendar';
}

/** 받은 일정만 보기(가족·지인용). 내 기록은 숨길 뿐 지우지 않는다. */
function viewOnly() {
  return state?.settings?.viewOnly === true;
}

/** 주소의 '#s=코드'를 읽고 주소에서 지운다(새로고침·뒤로 가기로 다시 뜨지 않게). 없으면 null. */
function readShareHash() {
  if (!location.hash.startsWith('#s=')) return null;
  let raw = location.hash;
  try { raw = decodeURIComponent(raw); } catch { /* 이상한 % 조합이면 원문 그대로 */ }
  history.replaceState(null, '', '#calendar');
  return extractCode(raw);
}

function toast(message, { error = false } = {}) {
  const region = document.getElementById(error ? 'alert' : 'toast');
  const el = h('p', { class: `toast${error ? ' toast--error' : ''}` }, message);
  fill(region, el);
  setTimeout(() => { if (el.isConnected) el.remove(); }, error ? 7000 : 3200);
}

/** 검증된 상태를 저장하고 성공 시에만 반영 */
function commit(next, message) {
  // 다른 창이 '받은 일정만 보기'를 켠 뒤에도 남아 있는 편집·공유 시트에서는 내 기록을 저장하지 않는다
  if (viewOnly() && isOpen(sheet) && sheetKind === 'edit') {
    const error = '받은 일정만 보기로 바뀌어 저장하지 않았습니다. 설정에서 모드를 끄면 다시 편집할 수 있습니다.';
    toast(error, { error: true });
    return { ok: false, error, conflict: false, reloaded: false };
  }
  const r = saveState(storage, next, { expectedRaw: lastRaw });
  if (!r.ok) {
    const reloaded = r.conflict ? reloadFromStorage() : false;
    toast(r.error, { error: true });
    return { ok: false, error: r.error, conflict: Boolean(r.conflict), reloaded };
  }
  lastRaw = r.raw;
  state = next;
  document.getElementById('alert').replaceChildren();
  if (!persistAsked) { persistAsked = true; navigator.storage?.persist?.().catch(() => {}); }
  render();
  if (message) toast(message);
  return { ok: true };
}

function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename, class: 'sr-only' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/** 기록을 읽지 못했을 때의 마지막 결과. 복구 화면을 다시 그릴 때(예: 새 공유 링크 진입) 쓴다. */
let lastLoadFailure = null;
/** 마지막 다시 읽기에서 보기 전용 전환 때문에 편집 시트를 닫았는지 (storage 안내 문구 선택용) */
let lastReloadClosedEdit = false;

/** 다른 창(홈 화면 앱·브라우저 탭)이 바꾼 기록을 다시 읽는다. 쓸 수 있는 기록을 읽었으면 true. */
function reloadFromStorage() {
  const result = loadState(storage, today);
  if (result.kind === 'ok' || result.kind === 'empty') {
    state = result.state;
    lastRaw = result.raw;
    lastLoadFailure = null;
    tabs.hidden = false;
    // 열린 편집 시트는 옛 기록 기준이므로 닫지 않고 두되, 저장 시 다시 검증·비교된다.
    // 단, 다른 창이 '받은 일정만 보기'를 켰으면 내 기록 편집·공유 시트는 닫는다.
    lastReloadClosedEdit = false;
    if (viewOnly() && isOpen(sheet) && sheetKind === 'edit') {
      closeSheet(); // 작성 중이면 묻는다(닫히면 시트 번호가 올라가 늦은 공유 결과도 무시된다). 남겨 두면 commit이 저장을 막는다.
      lastReloadClosedEdit = !isOpen(sheet);
    }
    render();
    return true;
  }
  if (result.kind === 'corrupt' || result.kind === 'future') {
    lastLoadFailure = result;
    closeSheet({ force: true });
    renderRecovery(result);
  }
  return false;
}

window.addEventListener('storage', (e) => {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  if (e.newValue === lastRaw) return;
  reloadFromStorage();
  toast(lastReloadClosedEdit ? '다른 창에서 받은 일정만 보기로 바꿔 편집 창을 닫았습니다.'
    : viewOnly() && isOpen(sheet) && sheetKind === 'edit' ? '다른 창에서 받은 일정만 보기로 바꿨습니다. 이 창의 편집은 저장되지 않습니다. 설정에서 모드를 끄면 다시 편집할 수 있습니다.'
    : '다른 창에서 바뀐 기록을 불러왔습니다.');
});

/* ---------------- 시트 ---------------- */

// iOS Safari에서 dialog가 열린 직후 내용을 그리면(+자동 입력 포커스·dialog 애니메이션·dialog 자체 스크롤)
// 흰 화면만 보이는 문제가 있었다(2026-10-02). 내용을 먼저 그린 뒤 열고, 입력 칸에 자동 포커스하지 않는다.
/** 열림 여부 — 대체 시트에서도 동작하도록 open 속성으로 판단 */
const isOpen = (d) => d.hasAttribute('open');
const HAS_DIALOG = typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';

/** dialog 열기 — iOS 15.4 미만처럼 showModal이 없으면 고정 위치 시트로 대신 연다 */
function showDialog(d) {
  if (HAS_DIALOG) { if (!isOpen(d)) d.showModal(); return; }
  d.setAttribute('open', ''); d.classList.add('sheet--fallback'); document.body.classList.add('has-fallback-sheet');
  d.querySelector('button, [href], input, select, textarea')?.focus?.();
}
function hideDialog(d) {
  if (HAS_DIALOG) { if (isOpen(d)) d.close(); return; }
  d.removeAttribute('open'); d.classList.remove('sheet--fallback');
  if (!document.querySelector('.sheet--fallback')) document.body.classList.remove('has-fallback-sheet');
}

/** 키보드가 올라오면 시트 높이를 실제 보이는 화면(visualViewport)에 맞춘다 */
function fitSheetToViewport() {
  const vv = window.visualViewport;
  if (vv) document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
}
window.visualViewport?.addEventListener('resize', fitSheetToViewport);
fitSheetToViewport();

/** 열린 시트 종류: 'edit'(내 기록 편집·공유) | 'view'(받기·안내·복사 상자). 보기 전용으로 바뀌면 edit만 닫는다. */
let sheetKind = null;
/**
 * 시트 일련번호. 열거나 닫을 때마다 올라간다. 공유·복사처럼 기다렸다 끝나는 작업은 시작할 때 번호를 적어 두고,
 * 끝났을 때 번호가 다르면(그사이 사용자가 닫거나 다른 시트를 열었으면) 화면을 건드리지 않는다.
 */
let sheetSerial = 0;

function openSheet(renderFn, { kind = 'edit' } = {}) {
  sheetSerial += 1;
  sheetHandle = null;
  sheet.replaceChildren();
  sheetKind = kind;
  sheetHandle = renderFn(sheet) ?? null;
  showDialog(sheet);
  sheet.querySelector('.sheet__body')?.scrollTo?.(0, 0);
}

function closeSheet({ force = false } = {}) {
  if (!force && sheetHandle?.isDirty() && !window.confirm('저장하지 않은 내용을 버리고 닫을까요?')) return;
  sheetHandle = null;
  sheetSerial += 1;
  hideDialog(sheet);
  sheet.replaceChildren();
}

// 대체 시트(dialog 미지원)에서도 Esc로 닫기
document.addEventListener('keydown', (e) => {
  if (HAS_DIALOG || e.key !== 'Escape') return;
  const top = [...document.querySelectorAll('.sheet--fallback')].pop();
  if (top === sheet) closeSheet();
  else if (top) top.dispatchEvent(new Event('cancel', { cancelable: true }));
});

sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });

/* ---------------- 동작 ---------------- */

const STALE_EDIT = '다른 창에서 이 항목이 바뀌어 저장하지 않았습니다. 지금 입력은 그대로 있습니다. 닫고 다시 열어 최신 내용을 확인해 주세요.';
const GONE_EDIT = '다른 창에서 삭제된 항목이라 저장하지 않았습니다. 지금 입력은 그대로 있습니다.';

/** 편집을 시작한 뒤 다른 창이 같은 항목을 바꾸거나 지웠는지 확인한다. */
function staleCheck(list, id, base) {
  if (!id) return null;
  const cur = list.find((x) => x.id === id);
  if (!cur) return GONE_EDIT;
  if (base !== null && JSON.stringify(cur) !== base) return STALE_EDIT;
  return null;
}

/** 규칙 문의: 폼이 있으면 새 창, 없으면 공유/복사/수동 대체. 시트가 열려 있으면 바꾸지 않는다. */
async function askRule(rule, type) {
  const result = await sendFeedback({ rule, type });
  if (result === 'copied') {
    toast('문의 내용을 복사했습니다. 메모·메시지 앱에 붙여넣어 보내 주세요.');
  } else if (result === 'manual') {
    openManualFeedback(rule, type);
  }
  // 'opened'·'shared'·'cancelled'는 안내 없이 끝낸다.
}

/**
 * 수동 복사 상자. 시트(예: 작성 중인 일정 편집)가 열려 있으면 그 위에 겹친 대화상자로 띄워
 * 편집 내용을 지우지 않고, 닫으면 원래 시트로 돌아간다.
 */
function openManualFeedback(rule, type) {
  if (!isOpen(sheet)) {
    openSheet((root) => { renderManualFeedback(root, { rule, type, onClose: () => closeSheet({ force: true }) }); return null; }, { kind: 'view' });
    return;
  }
  const back = document.activeElement;
  const over = document.createElement('dialog');
  over.className = 'sheet sheet--over';
  over.setAttribute('aria-modal', 'true');
  over.dataset.testid = 'feedback-over';
  const close = () => {
    hideDialog(over);
    over.remove();
    /** @type {HTMLElement|null} */ (back)?.focus?.();
  };
  over.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(over);
  renderManualFeedback(over, { rule, type, onClose: close });
  showDialog(over);
}

/* ---------------- 일정 공유 ---------------- */

/** 내 공유 번호가 없으면 만들어 저장한다. 저장에 실패하면 코드를 만들지 않는다(번호가 다음에 바뀌지 않게). */
function ensureShareId() {
  if (state.settings.shareId) return true;
  const r = commit({ ...state, settings: { ...state.settings, shareId: newShareId() } });
  return r.ok;
}

function setShareConfirmed(tripId, confirmed) {
  const trips = state.trips.map((t) => (t.id === tripId ? { ...t, shareConfirmed: confirmed } : t));
  return commit({ ...state, trips });
}

function openShare() {
  if (isOpen(sheet) || viewOnly()) return;
  openSheet((root) => renderSharePick(root, {
    state, today, onToggleConfirmed: setShareConfirmed, onNext: openShareMethods, onClose: () => closeSheet({ force: true }),
  }));
}

/** 지금 기록에서 고른 일정의 코드·링크·가족 문장을 만든다. 일정이 없어졌거나 날짜가 바뀌면 그때의 내용으로 만든다. */
function buildShare(tripIds) {
  const chosen = state.trips.filter((t) => tripIds.includes(t.id) && t.status !== 'cancelled' && t.segments.length);
  if (!chosen.length) return { ok: false, error: '보낼 일정이 없습니다.' };
  const items = chosen.map((t) => ({ ...tripDates(t), confirmed: t.shareConfirmed === true })).sort((a, b) => (a.start < b.start ? -1 : 1));
  try {
    const link = buildShareLink(encodeShare({ senderId: state.settings.shareId, issuedOn: today, items }), new URL('./', location.href).href);
    return { ok: true, link, text: familyText(items, today), count: items.length, signature: JSON.stringify(items) };
  } catch {
    return { ok: false, error: '공유 코드를 만들지 못했습니다. 일정 날짜를 확인해 주세요.' };
  }
}

/**
 * 고른 일정으로 방법 시트를 연다. 코드는 저장하지 않고 보내기 직전마다 지금 기록에서 다시 만든다 —
 * 그사이 다른 창이 일정을 바꿨으면 옛 코드를 보내지 않고 고르기로 돌아간다.
 * @returns {{ok: boolean, error?: string}} 고르기 시트가 오류를 표시할 수 있게
 */
function openShareMethods(tripIds, pickedKey) {
  const chosen = shareableTrips(state, today).filter((t) => tripIds.includes(t.id));
  if (shareSelectionKey(chosen) !== pickedKey) {
    closeSheet({ force: true });
    toast('일정이 바뀌어 공유를 다시 시작합니다. 보낼 일정을 다시 골라 주세요.', { error: true });
    openShare();
    return { ok: false };
  }
  if (!ensureShareId()) return { ok: false, error: '공유 번호를 저장하지 못해 코드를 만들 수 없습니다. 잠시 뒤 다시 시도해 주세요.' };
  const first = buildShare(tripIds);
  if (!first.ok) return first;
  const close = () => closeSheet({ force: true });
  /** 보내기 직전 재생성. 내용이 바뀌었으면 null을 돌려주고 고르기로 되돌린다. */
  const current = () => {
    if (viewOnly()) { closeSheet({ force: true }); return null; }
    const now = buildShare(tripIds);
    if (now.ok && now.signature === first.signature) return now;
    closeSheet({ force: true });
    toast(now.ok ? '일정이 바뀌어 공유를 다시 시작합니다. 보낼 일정을 다시 골라 주세요.' : now.error, { error: true });
    if (now.ok) openShare();
    return null;
  };
  const methods = () => openSheet((root) => renderShareMethods(root, {
    count: first.count,
    onQr: () => { const now = current(); if (now) openSheet((r) => renderQrSheet(r, { link: now.link, onBack: methods, onClose: close })); },
    onLink: () => openSheet((r) => renderLinkNotice(r, { onBack: methods, onClose: close,
      onConfirm: () => {
        const now = current();
        if (!now) return;
        const serial = sheetSerial;
        shareText(now.link).then((result) => afterShare(serial, result, { text: now.link, title: '일정 링크', note: '자동으로 보내거나 복사하지 못했습니다. 아래 링크를 길게 눌러 복사해 보내 주세요.', copied: '링크를 복사했습니다. 메신저에 붙여넣어 보내 주세요.' }));
      } })),
    onFamily: () => { const now = current(); if (now) openSheet((r) => renderFamilyPreview(r, { text: now.text, onBack: methods, onClose: close,
      onSend: () => {
        const latest = current();
        if (!latest) return;
        const serial = sheetSerial;
        shareText(latest.text).then((result) => afterShare(serial, result, { text: latest.text, title: '가족에게 보낼 글', note: '자동으로 보내거나 복사하지 못했습니다. 아래 글을 길게 눌러 복사해 보내 주세요.', copied: '글을 복사했습니다. 메신저에 붙여넣어 보내 주세요.' }));
      } })); },
    onClose: close,
  }));
  methods();
  return { ok: true };
}

/* ---------------- 일정 받기 ---------------- */

/** 붙여넣기 창. 오류가 있으면 입력을 보존한 채 이유를 보여 준다. 미뤄 둔 링크 코드가 있으면 미리 채운다. */
function openReceiveInput(text = pendingShareCode ?? '', error = null) {
  openSheet((root) => renderReceiveInput(root, {
    text, error, onClose: () => closeSheet({ force: true }),
    onSubmit: (value) => {
      const code = extractCode(value);
      const d = decodeShare(code);
      if (!d.ok) { openReceiveInput(value, RECEIVE_ERRORS[d.reason]); return; }
      openReceiveSheet(code, { payload: d.payload });
    },
  }), { kind: 'view' });
}

/** 내 기록이 없음 = 휴가·일정·복무 정보·가점이 모두 없음 (가족·지인 판별). 받은 일정이 있어도 내 기록이 없으면 보기 전용 후보다. */
const isFirstRun = () => state && !state.grants.length && !state.trips.length && !state.service && state.merit.points === 0;

/** 사용자가 확인한 판정 결과. 저장 직전 같은지 다시 본다. */
const classificationKey = (c) => JSON.stringify({ kind: c.kind, nickname: c.entry?.nickname ?? null, issuedOn: c.entry?.issuedOn ?? null, items: c.entry?.items ?? null });

/**
 * 받기 시트. 코드 → payload → 판정 → 시트. 링크 진입·붙여넣기·재판정 모두 이 함수를 거친다.
 * @param {string} code
 * @param {{payload?: any, nickname?: string, viewOnly?: boolean, notice?: string|null}} [opts]
 */
function openReceiveSheet(code, { payload = null, nickname = '', viewOnly = false, notice = null } = {}) {
  if (!state) return;
  if (!payload) {
    const d = decodeShare(code);
    if (!d.ok) { openReceiveInput(code, RECEIVE_ERRORS[d.reason]); return; }
    payload = d.payload;
  }
  const classification = classifyIncoming(state, payload);
  const confirmedKey = classificationKey(classification);
  // 이 시트의 코드만 버린다. 작성 중 새로 도착해 보류한 다른 링크는 다음 받기까지 보존한다.
  const close = () => { closeSheet(); if (!isOpen(sheet) && pendingShareCode === code) pendingShareCode = null; };
  openSheet((root) => renderReceiveSheet(root, {
    payload, classification, nickname, viewOnly, install: installInfo(), firstRun: isFirstRun(), notice,
    onClose: close,
    onRetry: () => openReceiveInput(''),
    onCopyForApp: async () => {
      const serial = sheetSerial;
      const r = await copyText(code);
      if (serial !== sheetSerial) return r; // 기다리는 사이 사용자가 닫거나 다른 시트를 열었으면 건드리지 않는다
      if (r === 'manual') openSheet((root2) => { renderManualText(root2, { title: '일정 코드', note: '복사하지 못했습니다. 아래 코드를 길게 눌러 복사한 뒤 홈 화면 앱의 달력 → 일정 받기에 붙여넣으세요.', text: code, testId: 'receive-manual-text', onClose: close }); return null; }, { kind: 'view' });
      return r;
    },
    onSave: ({ nickname: name, viewOnly: v }) => saveReceived(code, payload, confirmedKey, { nickname: name, viewOnly: v }),
  }), { kind: 'view' });
}

/** 저장 직전 재판정 → 적용 → commit. 다른 창이 그사이 바꿨으면 저장하지 않고 다시 묻는다. */
function saveReceived(code, payload, confirmedKey, { nickname, viewOnly }) {
  const again = () => openReceiveSheet(code, { payload, nickname, viewOnly, notice: '다른 창에서 받은 일정이 바뀌어 다시 확인합니다. 내용을 보고 다시 저장해 주세요.' });
  const now = classifyIncoming(state, payload);
  if (classificationKey(now) !== confirmedKey) { again(); return; }
  if (now.kind !== 'new' && now.kind !== 'replace') { again(); return; }
  let next = applyIncoming(state, payload, { nickname, today });
  if (viewOnly) next = { ...next, settings: { ...next.settings, viewOnly: true } };
  const r = commit(next);
  if (!r.ok) {
    // 충돌이면 commit이 최신 기록을 다시 읽었다. 쓸 수 있는 기록을 읽은 경우에만 다시 판정한다.
    if (r.conflict && r.reloaded) again();
    return;
  }
  const first = payload.items[0];
  if (pendingShareCode === code) pendingShareCode = null;
  closeSheet({ force: true });
  month = first.start.slice(0, 7);
  selected = first.start;
  if (view !== 'calendar') setView('calendar'); else render();
  toast(`${nickname.trim()}의 일정 ${payload.items.length}건을 받았습니다.`);
}

/** 복구·저장 불가 화면에서 받으려던 코드를 잃지 않게 복사 단추를 준다. */
function pendingCodeButton() {
  if (!pendingShareCode) return null;
  const code = pendingShareCode;
  return h('button', { type: 'button', class: 'btn btn--ghost', 'data-testid': 'recovery-copy-code', onClick: async () => {
    const serial = sheetSerial;
    const r = await copyText(code);
    if (serial !== sheetSerial || pendingShareCode !== code) return;
    if (r === 'copied') toast('받으려던 일정 코드를 복사했습니다. 기록을 복구한 뒤 달력 → 일정 받기에 붙여넣으세요.');
    else openSheet((root) => { renderManualText(root, { title: '받으려던 일정 코드', note: '복사하지 못했습니다. 아래 코드를 길게 눌러 복사해 두세요.', text: code, testId: 'receive-manual-text', onClose: () => closeSheet({ force: true }) }); return null; }, { kind: 'view' });
  } }, '받으려던 일정 코드 복사');
}

/** 공유 체인 결과 처리: 공유됨·복사됨은 닫고, 취소는 그대로, 수동은 복사 상자. 그사이 시트가 바뀌었으면 화면은 건드리지 않는다. */
function afterShare(serial, result, { text, title, note, copied }) {
  const live = serial === sheetSerial && isOpen(sheet) && sheetKind === 'edit' && !viewOnly();
  if (result === 'copied') toast(copied);
  if (!live) return;
  if (result === 'shared' || result === 'copied') { closeSheet({ force: true }); return; }
  if (result === 'manual') {
    openSheet((root) => { renderManualText(root, { title, note, text, testId: 'share-manual-text', onClose: () => closeSheet({ force: true }) }); return null; });
  }
  // 'cancelled': 사용자가 공유 시트를 닫음 — 안내 없이 현재 화면 유지
}

function tripSaveGuard() {
  const baseline = snapshotGrantKinds(state.grants);
  return (candidate, replaceId, options) => {
    if (hasChangedGrantKinds(candidate, baseline, state.grants)) {
      return { ok: false, error: '사용할 휴가가 다른 창에서 바뀌었습니다. 지금 입력은 그대로 있습니다. 일정을 다시 열어 확인해 주세요.' };
    }
    return saveTrip(candidate, replaceId, options);
  };
}

function openTrip(id) {
  if (viewOnly()) return;
  const trip = state.trips.find((t) => t.id === id) ?? null;
  const base = trip ? JSON.stringify(trip) : null;
  const guardedSave = tripSaveGuard();
  openSheet((root) => renderTripEditor(root, {
    state, today, trip, onRefreshDate: refreshCurrentDate,
    onSave: (c, replaceId, o) => {
      const stale = staleCheck(state.trips, replaceId, base);
      return stale ? { ok: false, error: stale } : guardedSave(c, replaceId, o);
    },
    onDelete: (tid) => {
      const stale = staleCheck(state.trips, tid, base);
      return stale ? { ok: false, error: stale } : deleteTrip(tid);
    },
    onClose: () => closeSheet(),
    onAsk: askRule,
  }));
}

function addTrip(date) {
  if (viewOnly()) return;
  if (!state.grants.length && date === undefined) { setView('grants'); return; }
  openSheet((root) => renderTripEditor(root, {
    state, today, trip: null, onRefreshDate: refreshCurrentDate, startDate: date ?? selected,
    onSave: tripSaveGuard(), onDelete: deleteTrip, onClose: () => closeSheet(), onAsk: askRule,
  }));
}

/** 성과제 날짜에서 성과제외박 일정 초안을 연다. 휴가 일수는 차감하지 않는다. */
function addPerformanceTrip({ n, start, days }) {
  if (viewOnly()) return;
  if (!days) return;
  openSheet((root) => renderTripEditor(root, {
    state, today, trip: null, onRefreshDate: refreshCurrentDate,
    draft: { kind: 'performance', grantId: null, start, end: addDays(start, days - 1), title: `성과제외박 ${n}회차` },
    onSave: tripSaveGuard(), onDelete: deleteTrip, onClose: () => closeSheet(), onAsk: askRule,
  }));
}

function saveTrip(candidate, replaceId, { confirmed }) {
  refreshCurrentDate();
  const issues = validateTrip(state, candidate, replaceId);
  if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
  if (issues.some((i) => i.severity === 'warning') && !confirmed) {
    return { ok: false, issues, error: '확인 필요 내용을 읽고 체크한 뒤 다시 저장해 주세요.' };
  }
  const trips = replaceId ? state.trips.map((t) => (t.id === replaceId ? candidate : t)) : [...state.trips, candidate];
  const before = replaceId ? state.trips.find((t) => t.id === replaceId) : null;
  const msg = !before ? '일정을 저장했습니다.'
    : before.status !== candidate.status ? { completed: '사용완료로 표시했습니다.', cancelled: '일정을 취소했습니다.', planned: '계획으로 되돌렸습니다.' }[candidate.status]
      : '변경을 저장했습니다.';
  const r = commit({ ...state, trips }, msg);
  if (r.ok) {
    closeSheet({ force: true });
    const first = candidate.segments.map((s) => s.start).sort()[0];
    if (first && !before) { selected = first; month = first.slice(0, 7); render(); }
  }
  return r;
}

function deleteTrip(id) {
  const r = commit({ ...state, trips: state.trips.filter((t) => t.id !== id) }, '일정을 삭제했습니다.');
  if (r.ok) closeSheet({ force: true });
  return r;
}

function openGrant(id, { initialKind } = {}) {
  if (viewOnly()) return;
  const grant = id ? state.grants.find((g) => g.id === id) : null;
  const base = grant ? JSON.stringify(grant) : null;
  openSheet((root) => renderGrantForm(root, {
    grant, today, initialKind, auto: grant ? entryForGrant(state.promotionGrants, grant.id)?.entry.status ?? null : null, usage: grant ? calculateBalances(state, today).byGrant[grant.id] : null,
    onSave: (candidate, replaceId) => {
      const stale = staleCheck(state.grants, replaceId, base);
      if (stale) return { ok: false, error: stale };
      const issues = validateGrantChange(state, candidate, replaceId);
      if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
      const grants = replaceId ? state.grants.map((g) => (g.id === replaceId ? candidate : g)) : [...state.grants, candidate];
      // 자동 정기휴가를 고치면(이름만 바꾼 경우 제외) 진급일 연동을 멈춘다 — 같은 저장에서
      const hit = replaceId ? entryForGrant(state.promotionGrants, replaceId) : null;
      const promotionGrants = hit ? { ...state.promotionGrants, [hit.kind]: promotionEntryAfterEdit(hit.entry, grant, candidate) } : state.promotionGrants;
      const unlinked = hit && hit.entry.status === 'managed' && promotionGrants[hit.kind].status === 'fixed';
      const reset = replaceId && state.grants.find(g => g.id === replaceId)?.kind !== candidate.kind
        ? resetPreparationForGrant(state.trips, replaceId) : { trips: state.trips, resetCount: 0 };
      const r = commit({ ...state, grants, promotionGrants, trips: reset.trips }, replaceId
        ? `휴가를 수정했습니다.${reset.resetCount ? ` 연결된 일정 ${reset.resetCount}건의 준비 체크를 비웠습니다.` : ''}${unlinked ? ' 직접 고친 정기휴가라 진급일 연동을 멈췄습니다.' : ''}` : '휴가를 추가했습니다.');
      if (r.ok) closeSheet({ force: true });
      return r;
    },
    onDelete: (gid) => {
      const stale = staleCheck(state.grants, gid, base);
      if (stale) return { ok: false, error: stale };
      const issues = validateGrantDelete(state, gid);
      if (issues.length) return { ok: false, issues };
      // 자동 정기휴가를 지우면 복무 정보를 다시 저장해도 다시 넣지 않는다 — 같은 저장에서
      const r = commit({ ...state, grants: state.grants.filter((g) => g.id !== gid), promotionGrants: promotionGrantsAfterDelete(state.promotionGrants, gid) }, '휴가를 삭제했습니다.');
      if (r.ok) closeSheet({ force: true });
      return r;
    },
    onClose: () => closeSheet(),
  }));
}

function openVisits() {
  if (viewOnly()) return;
  openSheet((root) => renderVisitForm(root, {
    settings: state.settings,
    onSave: (partial) => {
      // 시트는 면회외출 두 값만 돌려준다. 공유 번호·보기 전용 같은 나머지 설정은 그대로 둔다.
      const settings = { ...state.settings, ...partial };
      const issues = validateSettings(state, settings);
      if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
      const r = commit({ ...state, settings }, '면회외출 시작 횟수를 저장했습니다.');
      if (r.ok) closeSheet({ force: true });
      return r;
    },
    onClose: () => closeSheet(),
  }));
}

/**
 * 가점 시트. 열 때의 가점·휴가 목록을 기준으로 고정한다 — 다른 창이 그사이 전환했으면 저장을 거부해
 * 같은 가점이 두 번 휴가로 바뀌지 않게 한다(남은 가점이 같아도 휴가 목록이 달라지므로 둘 다 비교).
 */
function openMerit() {
  if (viewOnly()) return;
  const base = JSON.stringify([state.merit, state.grants]);
  openSheet((root) => renderMeritForm(root, {
    merit: state.merit,
    onSave: (candidate) => {
      if (JSON.stringify([state.merit, state.grants]) !== base) {
        return { ok: false, error: '다른 화면에서 가점이나 휴가가 바뀌었습니다 — 닫고 다시 열어 주세요.' };
      }
      const r = convertMerit(candidate, { today, newId });
      if (!r.ok) return { ok: false, issues: r.issues };
      const saved = commit({ ...state, merit: r.merit, grants: [...state.grants, ...r.grants] },
        r.days ? `포상휴가 ${r.days}일을 추가했습니다 (가점 ${r.used}점 사용)` : '가점을 저장했습니다.');
      if (saved.ok) closeSheet({ force: true });
      return saved;
    },
    onClose: () => closeSheet(),
  }));
}

function scheduleOf(s = state) {
  return s?.service ? computeSchedule(s.service, today) : null;
}

const partialSpan = (svc) => {
  const p = svc ? computeSchedule(svc, today).lastPartial : null;
  return p ? `${p.start}~${p.end}` : null;
};

/**
 * 복무 정보 저장. 폼은 마지막 덜 찬 회차 기간이 바뀌면 일수를 비우고 다시 입력받는다.
 * 안전장치: 일수 값이 입력된 때의 기간(meta.lastDaysSpan)과 저장할 기간이 다르면 일수는 '확인 필요'(null).
 * 저장된 출타 일정은 건드리지 않는다.
 */
/**
 * 정기휴가 자동 지급 계획. keepDates 계급은 저장 전 상태에서 먼저 연동을 멈춘 뒤 계산한다
 * (이미 옮긴 결과에 상태만 바꾸면 날짜가 옮겨진 채라 다시 막힌다).
 */
function autoGrantPlan(service, keepDates = [], makeId = (p) => `${p}-preview`) {
  const promotionGrants = { ...state.promotionGrants };
  for (const k of keepDates) if (promotionGrants[k]?.status === 'managed') promotionGrants[k] = { ...promotionGrants[k], status: 'fixed' };
  // 미리보기는 가짜 ID로 계산한다 — 실제 ID는 저장 때만 만든다
  return planPromotionGrants({ ...state, promotionGrants }, service, { today, newId: makeId });
}

/** 저장 결과를 사용자에게 한 문장씩 알린다 */
function autoGrantMessage(rows, keepDates) {
  const add = rows.filter((r) => r.action === 'add');
  const parts = [];
  if (add.length) parts.push(`${add.map((r) => `${r.rank} ${r.planned.amount}일`).join('·')} 정기휴가를 진급일부터 쓸 수 있게 넣었습니다.`);
  for (const r of rows.filter((x) => x.action === 'move')) parts.push(`${r.rank} 정기휴가 사용 시작일을 ${plainDot(r.planned.availableFrom)}로 옮겼습니다.`);
  for (const r of rows.filter((x) => x.action === 'unlink')) parts.push(`${r.rank} 진급일이 지나 자동 연동을 멈췄습니다 — 남은 일수를 확인하세요.`);
  for (const k of keepDates) { const r = rows.find((x) => x.kind === k); if (r) parts.push(`${r.rank} 정기휴가는 날짜를 그대로 두고 연동을 멈췄습니다.`); }
  return parts.join(' ');
}

function saveService(candidate, meta = {}, { keepDates = [] } = {}) {
  // 시트를 켜 둔 채 자정을 넘겼으면 오늘 날짜부터 다시 읽는다(오늘 진급분을 미래로 보지 않게)
  const now = seoulToday();
  if (now !== today) { today = now; render(); }
  const issues = validateService(candidate);
  if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
  const carried = 'lastDaysSpan' in meta ? meta.lastDaysSpan : partialSpan(state.service);
  const next = candidate.lastPerformanceDays !== null && carried !== partialSpan(candidate)
    ? { ...candidate, lastPerformanceDays: null } : candidate;
  // 시트를 연 뒤 날짜가 바뀌었거나 다른 창에서 휴가가 바뀌면 보여 준 내용과 다르게 저장되지 않게 멈춘다.
  // 비교는 화면이 보여 준 것과 같은 조건(날짜 유지 적용 전)으로 한다.
  const preview = autoGrantPlan(next);
  if (meta.previewKey !== undefined && autoGrantPlanKey(preview.rows) !== meta.previewKey) {
    return { ok: false, refreshPreview: true, error: '그사이 날짜나 기록이 바뀌어 정기휴가 처리 내용이 달라졌습니다 — 아래 내용을 확인하고 다시 저장해 주세요.' };
  }
  const plan = autoGrantPlan(next, keepDates, newId);
  const after = { ...state, service: next, grants: plan.grants, promotionGrants: plan.promotionGrants };
  // 옮긴 자동 휴가 때문에 이미 잡아 둔 일정이 범위를 벗어나면 저장하지 않고, 날짜를 그대로 두는 선택을 준다
  const blockedIssues = [];
  const blocked = [];
  for (const r of plan.rows.filter((x) => x.action === 'move')) {
    const g = plan.grants.find((x) => x.id === plan.promotionGrants[r.kind].grantId);
    const errs = validateGrantChange(after, g, g.id).filter((i) => i.severity === 'error');
    if (errs.length) { blocked.push(r.kind); blockedIssues.push(...errs); }
  }
  if (blocked.length) return { ok: false, issues: blockedIssues, blocked };
  const lastNote = next.lastPerformanceDays !== candidate.lastPerformanceDays ? ' 마지막 성과제 기간이 바뀌어 일수를 다시 확인해 주세요.' : '';
  const autoNote = autoGrantMessage(plan.rows, keepDates);
  const r = commit(after, `복무 정보를 저장했습니다.${lastNote}${autoNote ? ` ${autoNote}` : ''}`);
  if (r.ok) closeSheet({ force: true });
  return r;
}

function openService() {
  if (viewOnly()) return;
  const base = JSON.stringify(state.service);
  openSheet((root) => renderServiceForm(root, {
    service: state.service, today,
    onSave: (candidate, meta, opts) => (JSON.stringify(state.service) !== base ? { ok: false, error: STALE_EDIT } : saveService(candidate, meta, opts)),
    // 미리보기와 저장이 같은 계획 함수·최신 기록·최신 날짜를 쓴다
    previewAutoGrants: (draft) => (validateService(draft).some((i) => i.severity === 'error') ? null : autoGrantPlan(draft).rows),
    onClose: () => closeSheet(),
  }));
}

function exportBackup(s = state) {
  download(`airforce-leave-backup-${today}.json`, serializeBackup(s));
  toast('백업 파일을 내려받았습니다.');
}

async function readBackupFile(file) {
  if (file.size > MAX_BACKUP_BYTES) {
    return { ok: false, issues: [{ code: 'BACKUP_TOO_LARGE', severity: 'error', message: '백업 파일이 2MB를 넘습니다.' }] };
  }
  return parseBackup(await file.text());
}

async function importFile(file, { current = state, recovering = false } = {}) {
  const r = await readBackupFile(file);
  if (!r.ok) {
    importIssues = r.issues.filter((i) => i.severity === 'error');
    if (recovering) toast(importIssues[0]?.message ?? '복원할 수 없는 파일입니다.', { error: true });
    else render();
    return;
  }
  importIssues = [];
  openSheet((root) => renderRestoreConfirm(root, {
    current: current ?? createEmptyState(today), incoming: r.state, fromVersion: r.fromVersion, issues: r.issues, exportedAt: r.exportedAt,
    onBackupCurrent: () => (current ? exportBackup(current) : toast('지금 기록을 읽을 수 없어 위 원본 파일 받기를 사용하세요.', { error: true })),
    onConfirm: () => {
      const saved = commit(r.state, '백업에서 복원했습니다.');
      if (saved.ok) { closeSheet({ force: true }); tabs.hidden = false; }
      return saved;
    },
    onClose: () => closeSheet({ force: true }),
  }), { kind: 'view' });
}

/* ---------------- 설치·업데이트 ---------------- */

function installInfo() {
  const ua = navigator.userAgent;
  const inAppMatch = [
    [/KAKAOTALK/i, '카카오톡'], [/Instagram/i, '인스타그램'], [/FBAN|FBAV/i, '페이스북'], [/\bLine\//i, '라인'],
    [/NAVER\(inapp/i, '네이버 앱'], [/everytimeApp/i, '에브리타임'], [/DaumApps/i, '다음 앱'],
  ].find(([re]) => re.test(ua));
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true,
    inApp: inAppMatch ? inAppMatch[1] : null,
    platform: ios ? 'ios' : /Android/i.test(ua) ? 'android' : 'other',
    canPrompt: Boolean(installPrompt),
    prompt: async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      render();
    },
  };
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (view === 'settings' && state) render(); });

function applyUpdate() {
  if (isOpen(sheet) && sheetHandle?.isDirty()) {
    toast('작성 중인 내용을 저장하거나 닫은 뒤 새 버전을 적용해 주세요.', { error: true });
    return;
  }
  // 대기 워커가 이미 다른 창에서 활성화됐으면 SKIP_WAITING은 효과가 없다 → 새로고침
  if (controllerChanged || waitingWorker?.state === 'activated') { location.reload(); return; }
  if (!waitingWorker) return;
  updateRequested = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

function showUpdate(worker) {
  if (worker) waitingWorker = worker;
  const banner = document.getElementById('update-banner');
  fill(banner, 
    h('span', null, controllerChanged ? '새 버전이 적용되었습니다.' : '새 버전이 있습니다.'),
    h('button', { type: 'button', class: 'btn btn--small btn--on-dark', 'data-testid': 'apply-update', onClick: applyUpdate }, controllerChanged ? '새로고침' : '새로고침해 적용'));
  banner.hidden = false;
  if (view === 'settings' && state) render();
}

function setOffline(next) {
  if (offlineState === next) return;
  offlineState = next;
  if (state && view === 'settings') render();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) { setOffline('unsupported'); return; }
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) { setOffline('insecure'); return; }
  navigator.serviceWorker.ready
    .then(() => caches.keys())
    .then((keys) => setOffline(keys.some((k) => k.startsWith('airforce-leave-calendar-')) ? 'ready' : 'pending'))
    .catch(() => setOffline('failed'));
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => setOffline('failed'));
  // 처음 설치할 때(clients.claim)도 controllerchange가 온다 — 그때는 새 버전이 아니므로 무시한다.
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 사용자가 '적용'을 누른 경우에만 다시 불러온다. 입력 중 강제 새로고침 없음.
    if (updateRequested) { location.reload(); return; }
    if (!hadController) { hadController = true; return; }
    // 다른 창이 새 버전을 적용했다: 이 창은 옛 코드 그대로이니 새로고침을 안내한다
    controllerChanged = true;
    showUpdate(null);
  });
}

/* ---------------- 렌더 ---------------- */

function setView(next) {
  view = next === 'grants' && viewOnly() ? 'calendar' : next;
  next = view;
  if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  render();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function openGuide() {
  if (isOpen(sheet)) return;
  openSheet((root) => renderGuide(root, { onClose: () => closeSheet({ force: true }) }), { kind: 'view' });
}
document.getElementById('help-btn')?.addEventListener('click', openGuide);

tabs.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('[data-view]');
  if (btn) setView(btn.dataset.view);
});
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#s=')) {
    // 앱이 열린 채 다른 링크를 누른 경우
    const code = readShareHash();
    pendingShareCode = code;
    if (!state) {
      // 복구·저장 불가 화면: 복사 단추가 새 코드를 가리키도록 다시 그린다
      if (lastLoadFailure) renderRecovery(lastLoadFailure);
      return;
    }
    if (isOpen(sheet)) {
      closeSheet(); // 작성 중이면 확인을 묻는다
      if (isOpen(sheet)) { toast('작성 중인 내용이 있어 받기를 미뤘습니다. 닫은 뒤 달력의 "일정 받기"를 누르면 이어서 받을 수 있습니다.'); return; }
    }
    if (view !== 'calendar') { view = 'calendar'; render(); }
    openReceiveSheet(code);
    return;
  }
  if (location.hash === '#grants' && viewOnly()) history.replaceState(null, '', '#calendar'); // 보기 전용: 내 휴가 주소를 달력으로 되돌림
  const v = viewFromHash();
  if (v !== view) { view = v; render(); }
});
function refreshCurrentDate() {
  if (document.visibilityState !== 'visible' || !state) return;
  const now = seoulToday();
  if (now !== today) {
    today = now;
    render();
    sheetHandle?.refreshDate?.();
  }
}
document.addEventListener('visibilitychange', refreshCurrentDate);
window.addEventListener('focus', refreshCurrentDate);
setInterval(refreshCurrentDate, 60_000);

function render() {
  if (!state) return;
  // 보기 전용 재보정: 처음 열 때·다른 창 반영·복원 뒤에도 내 휴가 화면에 머물지 않는다
  const ro = viewOnly();
  tabs.classList.toggle('tabs--two', ro);
  const grantsTab = tabs.querySelector('[data-view="grants"]');
  if (grantsTab) grantsTab.hidden = ro;
  if (ro && view === 'grants') { view = 'calendar'; if (location.hash === '#grants') history.replaceState(null, '', '#calendar'); }
  for (const t of tabs.querySelectorAll('[data-view]')) {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  const balances = calculateBalances(state, today);
  const schedule = scheduleOf();
  if (view === 'calendar') {
    renderCalendar(main, {
      month, state, balances, today, selected, schedule,
      onPerformanceTrip: addPerformanceTrip,
      onSelectDate: (d) => {
        selected = d; month = d.slice(0, 7); render();
        main.querySelector(`[data-date="${d}"]`)?.focus();
      },
      onMonthChange: (m) => { month = m; if (!selected.startsWith(m)) selected = m === today.slice(0, 7) ? today : `${m}-01`; render(); },
      onOpenTrip: openTrip,
      onAddTrip: addTrip,
      onShare: ro ? null : openShare,
      onReceive: () => openReceiveInput(),
      viewOnly: ro,
      welcome: !ro && state.grants.length === 0 && state.trips.length === 0 ? { inApp: installInfo().inApp } : null,
      onHelp: openGuide,
      onRestore: () => setView('settings'),
    });
  } else if (view === 'grants') {
    renderGrants(main, {
      state, balances, today, schedule, onEditGrant: openGrant, onAddGrant: () => openGrant(null), onEditVisits: openVisits, onEditMerit: openMerit, onOpenTrip: openTrip,
      onEditService: openService, onPromoGrant: (kind) => openGrant(null, { initialKind: kind }),
    });
  } else {
    renderSettings(main, {
      state, today, appVersion: APP_VERSION, importIssues, onEditService: openService,
      onExport: () => exportBackup(),
      onImportFile: (f) => importFile(f),
      install: installInfo(),
      offline: offlineState,
      update: { waiting: Boolean(waitingWorker) || controllerChanged, apply: applyUpdate },
      onAsk: askRule,
      onRenameReceived: (senderId, nickname) => commit(renameReceived(state, senderId, nickname), '별명을 바꿨습니다.'),
      onRemoveReceived: (senderId) => commit(removeReceived(state, senderId), '받은 일정을 지웠습니다.'),
      viewOnly: ro,
      onToggleViewOnly: (next) => commit({ ...state, settings: { ...state.settings, viewOnly: next } }, next ? '받은 일정만 보기로 바꿨습니다. 내 기록은 그대로 있습니다.' : '내 기록을 다시 보여 줍니다.'),
    });
  }
}

function renderRecovery(result) {
  tabs.hidden = true;
  state = null;
  lastRaw = result.raw;
  const fileInput = h('input', { type: 'file', id: 'recover-file', accept: 'application/json,.json', class: 'sr-only',
    onChange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f, { current: null, recovering: true }); } });
  let understood = false;
  const fresh = h('button', { type: 'button', class: 'btn btn--danger', disabled: true, onClick: () => {
    const r = commit(createEmptyState(today), '새 기록으로 시작했습니다.');
    if (r.ok) tabs.hidden = false;
  } }, '비우고 새로 시작');
  const downloadRaw = h('button', { type: 'button', class: 'btn btn--primary', onClick: () => download(`airforce-leave-raw-${today}.txt`, result.raw, 'text/plain') }, '원본 기록 파일 받기');
  if (result.kind === 'future') {
    // 새 판 기록은 손상이 아니다 — 지우기를 제공하지 않는다.
    fill(main,
      h('h1', { class: 'view-title' }, '저장된 기록을 열 수 없습니다'),
      h('p', { class: 'form-error', role: 'alert' }, '새 버전 앱이 저장한 기록입니다 — 앱을 업데이트해 주세요'),
      h('p', { class: 'small' }, '기록은 그대로 두었습니다. 앱을 새로 고치거나 업데이트한 뒤 다시 열어 주세요.'),
      h('div', { class: 'btn-row' }, downloadRaw, pendingCodeButton()));
    return;
  }
  fill(main, 
    h('h1', { class: 'view-title' }, '저장된 기록을 열 수 없습니다'),
    h('p', { class: 'form-error', role: 'alert' }, result.error ?? '알 수 없는 오류'),
    h('p', { class: 'small' }, '기록을 자동으로 지우지 않았습니다. 원본을 먼저 받아 두고, 백업 파일이 있으면 복원하세요.'),
    h('div', { class: 'btn-row' },
      downloadRaw,
      h('label', { for: 'recover-file', class: 'btn btn--ghost', tabindex: '0' }, '백업에서 복원'), fileInput, pendingCodeButton()),
    h('label', { class: 'choice choice--confirm' },
      h('input', { type: 'checkbox', onChange: (e) => { understood = e.target.checked; fresh.disabled = !understood; } }),
      h('span', null, '원본을 받아 두었고, 이 기기의 기록을 비우는 데 동의합니다')),
    fresh);
}

function renderUnavailable(result) {
  tabs.hidden = true;
  fill(main, 
    h('h1', { class: 'view-title' }, '이 브라우저에 기록을 저장할 수 없습니다'),
    h('p', { class: 'form-error', role: 'alert' }, result.error),
    h('p', { class: 'small' }, '개인정보 보호(시크릿) 모드나 앱 안 브라우저에서는 저장이 막힐 수 있습니다. 일반 Safari 또는 Chrome에서 다시 열어 주세요.'),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--primary', onClick: () => location.reload() }, '다시 시도'), pendingCodeButton()));
}

function boot() {
  const result = loadState(storage, today);
  if (result.kind === 'ok' || result.kind === 'empty') {
    state = result.state;
    lastRaw = result.raw;
    render();
    if (pendingShareCode) openReceiveSheet(pendingShareCode);
  } else if (result.kind === 'corrupt' || result.kind === 'future') {
    lastLoadFailure = result;
    renderRecovery(result);
  } else {
    renderUnavailable(result);
  }
  registerServiceWorker();
}

boot();
