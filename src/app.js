// 컨트롤러: 모든 변경 후보를 검증하고, 저장에 성공한 뒤에만 화면 상태를 바꾼다.
import { seoulToday } from './domain/dates.js';
import { createEmptyState, STORAGE_KEY, RULE_VERSION } from './domain/model.js';
import { calculateBalances } from './domain/balances.js';
import { validateTrip, validateGrantChange, validateGrantDelete, validateSettings } from './domain/validation.js';
import { loadState, saveState, serializeBackup, parseBackup, MAX_BACKUP_BYTES } from './storage.js';
import { h, fill } from './ui/dom.js';
import { renderCalendar } from './ui/calendar.js';
import { renderGrants, renderGrantForm, renderVisitForm } from './ui/grants.js';
import { renderTripEditor } from './ui/trip-editor.js';
import { renderSettings, renderRestoreConfirm } from './ui/settings.js';
import { renderGuide } from './ui/guide.js';
import { renderServiceForm } from './ui/service.js';
import { computeSchedule, validateService } from './domain/service.js';
import { addDays } from './domain/dates.js';
import { APP_VERSION } from './version.js';
import { sendFeedback, renderManualFeedback } from './feedback.js';

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
let view = viewFromHash();
/** @type {{isDirty:()=>boolean}|null} */
let sheetHandle = null;
let importIssues = [];
/** @type {ServiceWorker|null} */
let waitingWorker = null;
let updateRequested = false;
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
  return ['calendar', 'grants', 'settings'].includes(v) ? v : 'calendar';
}

function toast(message, { error = false } = {}) {
  const region = document.getElementById(error ? 'alert' : 'toast');
  const el = h('p', { class: `toast${error ? ' toast--error' : ''}` }, message);
  fill(region, el);
  setTimeout(() => { if (el.isConnected) el.remove(); }, error ? 7000 : 3200);
}

/** 검증된 상태를 저장하고 성공 시에만 반영 */
function commit(next, message) {
  const r = saveState(storage, next, { expectedRaw: lastRaw });
  if (!r.ok) {
    if (r.conflict) reloadFromStorage();
    toast(r.error, { error: true });
    return { ok: false, error: r.error };
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

/** 다른 창(홈 화면 앱·브라우저 탭)이 바꾼 기록을 다시 읽는다. */
function reloadFromStorage() {
  const result = loadState(storage, today);
  if (result.kind === 'ok' || result.kind === 'empty') {
    state = result.state;
    lastRaw = result.raw;
    tabs.hidden = false;
    // 열린 편집 시트는 옛 기록 기준이므로 닫지 않고 두되, 저장 시 다시 검증·비교된다.
    render();
  } else if (result.kind === 'corrupt' || result.kind === 'future') {
    closeSheet({ force: true });
    renderRecovery(result);
  }
}

window.addEventListener('storage', (e) => {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  if (e.newValue === lastRaw) return;
  reloadFromStorage();
  toast('다른 창에서 바뀐 기록을 불러왔습니다.');
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

function openSheet(renderFn) {
  sheet.replaceChildren();
  sheetHandle = renderFn(sheet) ?? null;
  showDialog(sheet);
  sheet.querySelector('.sheet__body')?.scrollTo?.(0, 0);
}

function closeSheet({ force = false } = {}) {
  if (!force && sheetHandle?.isDirty() && !window.confirm('저장하지 않은 내용을 버리고 닫을까요?')) return;
  sheetHandle = null;
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
    openSheet((root) => { renderManualFeedback(root, { rule, type, onClose: () => closeSheet({ force: true }) }); return null; });
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

function openTrip(id) {
  const trip = state.trips.find((t) => t.id === id) ?? null;
  const base = trip ? JSON.stringify(trip) : null;
  openSheet((root) => renderTripEditor(root, {
    state, today, trip,
    onSave: (c, replaceId, o) => {
      const stale = staleCheck(state.trips, replaceId, base);
      return stale ? { ok: false, error: stale } : saveTrip(c, replaceId, o);
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
  if (!state.grants.length && date === undefined) { setView('grants'); return; }
  openSheet((root) => renderTripEditor(root, {
    state, today, trip: null, startDate: date ?? selected,
    onSave: saveTrip, onDelete: deleteTrip, onClose: () => closeSheet(), onAsk: askRule,
  }));
}

/** 성과제 날짜에서 성과제외박 일정 초안을 연다. 휴가 일수는 차감하지 않는다. */
function addPerformanceTrip({ n, start, days }) {
  if (!days) return;
  openSheet((root) => renderTripEditor(root, {
    state, today, trip: null,
    draft: { kind: 'performance', grantId: null, start, end: addDays(start, days - 1), title: `성과제외박 ${n}회차` },
    onSave: saveTrip, onDelete: deleteTrip, onClose: () => closeSheet(), onAsk: askRule,
  }));
}

function saveTrip(candidate, replaceId, { confirmed }) {
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
  const grant = id ? state.grants.find((g) => g.id === id) : null;
  const base = grant ? JSON.stringify(grant) : null;
  openSheet((root) => renderGrantForm(root, {
    grant, today, initialKind, usage: grant ? calculateBalances(state, today).byGrant[grant.id] : null,
    onSave: (candidate, replaceId) => {
      const stale = staleCheck(state.grants, replaceId, base);
      if (stale) return { ok: false, error: stale };
      const issues = validateGrantChange(state, candidate, replaceId);
      if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
      const grants = replaceId ? state.grants.map((g) => (g.id === replaceId ? candidate : g)) : [...state.grants, candidate];
      const r = commit({ ...state, grants }, replaceId ? '휴가를 수정했습니다.' : '휴가를 추가했습니다.');
      if (r.ok) closeSheet({ force: true });
      return r;
    },
    onDelete: (gid) => {
      const stale = staleCheck(state.grants, gid, base);
      if (stale) return { ok: false, error: stale };
      const issues = validateGrantDelete(state, gid);
      if (issues.length) return { ok: false, issues };
      const r = commit({ ...state, grants: state.grants.filter((g) => g.id !== gid) }, '휴가를 삭제했습니다.');
      if (r.ok) closeSheet({ force: true });
      return r;
    },
    onClose: () => closeSheet(),
  }));
}

function openVisits() {
  openSheet((root) => renderVisitForm(root, {
    settings: state.settings,
    onSave: (settings) => {
      const issues = validateSettings(state, settings);
      if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
      const r = commit({ ...state, settings }, '면회외출 시작 횟수를 저장했습니다.');
      if (r.ok) closeSheet({ force: true });
      return r;
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
function saveService(candidate, meta = {}) {
  const issues = validateService(candidate);
  if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };
  const carried = 'lastDaysSpan' in meta ? meta.lastDaysSpan : partialSpan(state.service);
  const next = candidate.lastPerformanceDays !== null && carried !== partialSpan(candidate)
    ? { ...candidate, lastPerformanceDays: null } : candidate;
  const r = commit({ ...state, service: next }, next.lastPerformanceDays !== candidate.lastPerformanceDays
    ? '복무 정보를 저장했습니다. 마지막 성과제 기간이 바뀌어 일수를 다시 확인해 주세요.' : '복무 정보를 저장했습니다.');
  if (r.ok) closeSheet({ force: true });
  return r;
}

function openService() {
  const base = JSON.stringify(state.service);
  openSheet((root) => renderServiceForm(root, {
    service: state.service, today,
    onSave: (candidate, meta) => (JSON.stringify(state.service) !== base ? { ok: false, error: STALE_EDIT } : saveService(candidate, meta)),
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
    current: current ?? createEmptyState(today), incoming: r.state, issues: r.issues, exportedAt: r.exportedAt,
    onBackupCurrent: () => (current ? exportBackup(current) : toast('지금 기록을 읽을 수 없어 위 원본 파일 받기를 사용하세요.', { error: true })),
    onConfirm: () => {
      const saved = commit(r.state, '백업에서 복원했습니다.');
      if (saved.ok) { closeSheet({ force: true }); tabs.hidden = false; }
      return saved;
    },
    onClose: () => closeSheet({ force: true }),
  }));
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
  if (!waitingWorker) return;
  if (isOpen(sheet) && sheetHandle?.isDirty()) {
    toast('작성 중인 내용을 저장하거나 닫은 뒤 새 버전을 적용해 주세요.', { error: true });
    return;
  }
  updateRequested = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

function showUpdate(worker) {
  waitingWorker = worker;
  const banner = document.getElementById('update-banner');
  fill(banner, 
    h('span', null, '새 버전이 있습니다.'),
    h('button', { type: 'button', class: 'btn btn--small btn--on-dark', 'data-testid': 'apply-update', onClick: applyUpdate }, '새로고침해 적용'));
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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 사용자가 '적용'을 누른 경우에만 다시 불러온다. 입력 중 강제 새로고침 없음.
    if (updateRequested) location.reload();
  });
}

/* ---------------- 렌더 ---------------- */

function setView(next) {
  view = next;
  if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  render();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function openGuide() {
  if (isOpen(sheet)) return;
  openSheet((root) => renderGuide(root, { onClose: () => closeSheet({ force: true }) }));
}
document.getElementById('help-btn')?.addEventListener('click', openGuide);

tabs.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('[data-view]');
  if (btn) setView(btn.dataset.view);
});
window.addEventListener('hashchange', () => { const v = viewFromHash(); if (v !== view) { view = v; render(); } });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state) return;
  const now = seoulToday();
  if (now !== today) { today = now; render(); }
});

function render() {
  if (!state) return;
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
      welcome: state.grants.length === 0 && state.trips.length === 0 ? { inApp: installInfo().inApp } : null,
      onHelp: openGuide,
      onRestore: () => setView('settings'),
    });
  } else if (view === 'grants') {
    renderGrants(main, {
      state, balances, today, schedule, onEditGrant: openGrant, onAddGrant: () => openGrant(null), onEditVisits: openVisits, onOpenTrip: openTrip,
      onEditService: openService, onPromoGrant: (kind) => openGrant(null, { initialKind: kind }),
    });
  } else {
    renderSettings(main, {
      state, today, appVersion: APP_VERSION, importIssues, onEditService: openService,
      onExport: () => exportBackup(),
      onImportFile: (f) => importFile(f),
      install: installInfo(),
      offline: offlineState,
      update: { waiting: Boolean(waitingWorker), apply: applyUpdate },
      onAsk: askRule,
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
      h('div', { class: 'btn-row' }, downloadRaw));
    return;
  }
  fill(main, 
    h('h1', { class: 'view-title' }, '저장된 기록을 열 수 없습니다'),
    h('p', { class: 'form-error', role: 'alert' }, result.error ?? '알 수 없는 오류'),
    h('p', { class: 'small' }, '기록을 자동으로 지우지 않았습니다. 원본을 먼저 받아 두고, 백업 파일이 있으면 복원하세요.'),
    h('div', { class: 'btn-row' },
      downloadRaw,
      h('label', { for: 'recover-file', class: 'btn btn--ghost', tabindex: '0' }, '백업에서 복원'), fileInput),
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
    h('button', { type: 'button', class: 'btn btn--primary', onClick: () => location.reload() }, '다시 시도'));
}

function boot() {
  const result = loadState(storage, today);
  if (result.kind === 'ok' || result.kind === 'empty') {
    state = result.state;
    lastRaw = result.raw;
    render();
  } else if (result.kind === 'corrupt' || result.kind === 'future') {
    renderRecovery(result);
  } else {
    renderUnavailable(result);
  }
  registerServiceWorker();
}

boot();
