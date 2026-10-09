import { preparationContext } from './preparation.js';

// 제공된 OJT의 참고 내용. 검토일은 시행일이 아니며 계산·허가 규칙으로 쓰지 않는다.
export const OJT_REVIEWED_ON = '2026-10-05';
export const OJT_NOTICE = '참고 안내 · 실제 일정은 부대 공지를 확인하세요';
export const OJT_GUIDANCE = Object.freeze([
  { id: 'outing-times', title: '외출·면회 시간', pages: [3, 7],
    text: '평일 일반 외출은 17:30~21:30, 휴일 면회외출은 08:30~21:30으로 안내되어 있습니다. 귀영은 21:30까지 정문 통과, 복귀 보고는 22:00까지로 구분됩니다. 전투휴무일·별도 지시는 부대에 확인하세요. 진료·시험외출은 별도 절차입니다.' },
  { id: 'leave-times', title: '외박·휴가 출발과 복귀', pages: [8, 12],
    text: '기상 이후 출발(평일 06:30·휴일 07:00)로 안내되어 있습니다. 귀영은 21:30까지 정문 통과, 복귀 보고는 22:00까지입니다. 구간별로 필요한 출타증을 모두 준비하고 별도 지시는 부대에 확인하세요.' },
  { id: 'leave-limit', title: '1회 휴가 기간', pages: [12],
    text: '일반적인 1회 휴가는 최대 15일로 안내되어 있습니다. 청원 등 예외와 외박을 합친 출타 상한은 부대에 확인하세요. 앱은 이 안내로 저장을 막지 않습니다.' },
  { id: 'consolation-limit', title: '위로휴가 기간', pages: [8],
    text: '위로휴가는 1회 최대 7일로 안내되어 있습니다. 현행 적용과 예외는 부대에 확인하세요. 앱은 이 안내로 저장을 막지 않습니다.' },
  { id: 'reward-limit', title: '가점·마일리지 포상', pages: [8],
    text: '가점·마일리지 포상은 계급별 6일, 계급 간 2일 이월, 마일리지 포상은 최대 12일로 안내되어 있습니다. 다른 포상은 계급별 제한과 구분됩니다. 앱은 이 한도를 자동 집계하거나 제한하지 않습니다. 실제 적용 기준은 부대에 확인하세요.' },
  { id: 'performance', title: '성과제외박 사용', pages: [8],
    text: '기본 6주 2박3일·원거리 8주 3박4일, 휴일 포함 원칙과 평일 1박2일 예외, 국외여행 불가로 안내되어 있습니다. 총 43일 산정·분할·휴가와 혼합하는 조건은 부대에 확인하세요. 앱은 43일을 자동 지급하지 않습니다.' },
].map(n => Object.freeze({ ...n, pages: Object.freeze(n.pages) })));

export function guidanceForTrip(trip, grants) {
  const context = preparationContext(trip.segments);
  if (!context) return [];
  const kinds = new Set(trip.segments.filter(s => s.kind === 'leave').map(s => grants.find(g => g.id === s.grantId)?.kind));
  const ids = new Set(context.outingKind ? ['outing-times'] : ['leave-times']);
  if (context.hasLeave) ids.add('leave-limit');
  if (kinds.has('consolation')) ids.add('consolation-limit');
  if (kinds.has('reward')) ids.add('reward-limit');
  if (context.hasPerformance) ids.add('performance');
  return OJT_GUIDANCE.filter(n => ids.has(n.id));
}
