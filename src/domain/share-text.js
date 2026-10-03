// 공유용 사람 문구: 받기 미리보기 줄과 가족·지인에게 보내는 문장. 순수 함수.
// 앱 이름·부대명·링크·내부 코드를 담지 않는다 (스펙 §가족 문장).
import { koreanDate, weekday } from './dates.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function parts(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, wd: WEEKDAYS[weekday(date)] };
}

/** 계획/확정 표시 — 공식 승인이 아니라 본인이 표시한 값 */
export function statusLabel(confirmed) {
  return confirmed ? '확정' : '계획';
}

/**
 * '10월 12일(월) ~ 14일(수)' / '10월 30일(금) ~ 11월 2일(월)' / '2026년 12월 30일(수) ~ 2027년 1월 2일(토)' / '11월 1일(일)'
 * 같은 달이면 끝에 일만, 달이 다르면 끝에도 월, 해가 다르면 양쪽에 연도.
 */
export function rangeText(start, end) {
  const a = parts(start);
  if (start === end) return `${a.m}월 ${a.d}일(${a.wd})`;
  const b = parts(end);
  if (a.y !== b.y) return `${a.y}년 ${a.m}월 ${a.d}일(${a.wd}) ~ ${b.y}년 ${b.m}월 ${b.d}일(${b.wd})`;
  if (a.m !== b.m) return `${a.m}월 ${a.d}일(${a.wd}) ~ ${b.m}월 ${b.d}일(${b.wd})`;
  return `${a.m}월 ${a.d}일(${a.wd}) ~ ${b.d}일(${b.wd})`;
}

/** 받기 시트 미리보기 줄: '10월 12일(월) ~ 14일(수) · 확정' */
export function previewLines(items) {
  return items.map((it) => `${rangeText(it.start, it.end)} · ${statusLabel(it.confirmed)}`);
}

/** 가족·지인용 문장. 기준일 = 코드를 만든 날. 출타 사이 빈 날은 잇지 않는다. */
export function familyText(items, issuedOn) {
  return [
    `출타 일정 (${koreanDate(issuedOn)} 기준)`,
    ...previewLines(items).map((line) => `· ${line}`),
    '확정은 제가 표시한 것이고, 바뀌면 다시 보낼게요.',
  ].join('\n');
}
