// 받은 일정(다른 사람의 날짜) 판정·적용. 순수 함수 — 저장하지 않고 새 상태를 돌려준다.
// 받은 일정은 잔여·겹침 차단·자동 지급에 관여하지 않는다 (스펙 §받기 규칙).
import { compareDates, toDayNumber } from './dates.js';
import { RECEIVED_LIMIT, COLOR_SLOTS } from './model.js';

/** 날짜·확정 표시까지 모두 같은 항목 목록인지 */
export function sameItems(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.start === b[i].start && x.end === b[i].end && x.confirmed === b[i].confirmed);
}

/**
 * 받으려는 코드가 지금 기록에서 어떤 경우인지. 판정 순서: own → 같은 번호(duplicate/replace) → limit → new.
 * @returns {{kind:'own'}|{kind:'duplicate',entry:any}|{kind:'limit'}|{kind:'replace',entry:any,older:boolean}|{kind:'new'}}
 */
export function classifyIncoming(state, payload) {
  if (state.settings.shareId && payload.senderId === state.settings.shareId) return { kind: 'own' };
  const entry = state.received.find((e) => e.senderId === payload.senderId);
  if (entry) {
    if (entry.issuedOn === payload.issuedOn && sameItems(entry.items, payload.items)) return { kind: 'duplicate', entry };
    return { kind: 'replace', entry, older: compareDates(payload.issuedOn, entry.issuedOn) < 0 };
  }
  if (state.received.length >= RECEIVED_LIMIT) return { kind: 'limit' };
  return { kind: 'new' };
}

/** 색 자리: 가장 덜 쓰인 색 중 가장 낮은 번호 */
export function nextColor(received) {
  const counts = new Array(COLOR_SLOTS).fill(0);
  for (const e of received) if (Number.isInteger(e.color) && e.color >= 0 && e.color < COLOR_SLOTS) counts[e.color] += 1;
  let best = 0;
  for (let c = 1; c < COLOR_SLOTS; c += 1) if (counts[c] < counts[best]) best = c;
  return best;
}

/**
 * new·replace만 적용한다. 교체는 색·배열 위치를 유지하고 별명·날짜·항목을 바꾼다.
 * 별명은 앞뒤 공백만 지운다. 빈 별명·21자 이상은 여기서 막지 않고 저장 단계(saveState → validateReceived)가 거절한다.
 * @param {{nickname: string, today: string}} opts
 */
export function applyIncoming(state, payload, { nickname, today }) {
  const c = classifyIncoming(state, payload);
  if (c.kind !== 'new' && c.kind !== 'replace') throw new RangeError(`cannot apply incoming schedule: ${c.kind}`);
  const items = payload.items.map((it) => ({ start: it.start, end: it.end, confirmed: it.confirmed }));
  const name = nickname.trim();
  if (c.kind === 'replace') {
    return {
      ...state,
      received: state.received.map((e) => (e === c.entry ? { ...e, nickname: name, receivedOn: today, issuedOn: payload.issuedOn, items } : e)),
    };
  }
  const added = { senderId: payload.senderId, nickname: name, color: nextColor(state.received), receivedOn: today, issuedOn: payload.issuedOn, items };
  return { ...state, received: [...state.received, added] };
}

function findOrThrow(state, senderId) {
  const entry = state.received.find((e) => e.senderId === senderId);
  if (!entry) throw new RangeError(`no received schedule from ${senderId}`);
  return entry;
}

export function renameReceived(state, senderId, nickname) {
  const entry = findOrThrow(state, senderId);
  return { ...state, received: state.received.map((e) => (e === entry ? { ...e, nickname: nickname.trim() } : e)) };
}

export function removeReceived(state, senderId) {
  findOrThrow(state, senderId);
  return { ...state, received: state.received.filter((e) => e.senderId !== senderId) };
}

/**
 * 달력용: 날짜 → 그 날 나가는 사람들 [{entry, item}] (received 순서). 없는 날짜는 키가 없다.
 * @param {any[]} received
 * @param {string[]} dates
 * @returns {Map<string, {entry:any, item:any}[]>}
 */
export function receivedByDate(received, dates) {
  const map = new Map();
  if (!dates.length) return map;
  // 날짜는 달력 칸 순서(오름차순)로 온다. 날짜 변환은 한 번만 하고, 화면 밖 항목은 건너뛴다.
  const nums = dates.map(toDayNumber);
  const first = nums[0];
  const last = nums[nums.length - 1];
  for (const entry of received) {
    for (const item of entry.items) {
      const s = toDayNumber(item.start);
      const e = toDayNumber(item.end);
      if (e < first || s > last) continue;
      for (let i = 0; i < dates.length; i += 1) {
        if (nums[i] < s || nums[i] > e) continue;
        if (!map.has(dates[i])) map.set(dates[i], []);
        map.get(dates[i]).push({ entry, item });
      }
    }
  }
  return map;
}
