import { addDays, isDateOnly, weekday } from './dates.js';
import { preparationContext } from './preparation.js';

/** OJT의 '희망 주'는 월~일. 정확한 마감 시각·휴일 이동은 추정하지 않는다. */
export function applicationWindow(segments, today) {
  const context = preparationContext(segments);
  if (!context || !isDateOnly(today)) return null;
  const monday = addDays(context.start, -((weekday(context.start) + 6) % 7));
  if (!isDateOnly(monday)) return null;
  const startsOn = addDays(monday, context.outingKind ? -10 : -21);
  const closesOn = addDays(monday, context.outingKind ? -5 : -7);
  if (!isDateOnly(startsOn) || !isDateOnly(closesOn)) return null;
  const phase = today < startsOn ? 'before' : today < closesOn ? 'open' : today === closesOn ? 'closing-day' : 'closed';
  return { kind: context.outingKind ? 'outing' : 'leave', startsOn, closesOn, phase };
}
