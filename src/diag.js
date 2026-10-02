// iOS 시트 빈 화면 진단 모드 (임시). 주소에 ?diag=A..F 를 붙이면 변형을 켜고, 시트가 열릴 때 측정값을 화면에 표시한다.
// A: 시트 애니메이션 끔  B: 스크롤을 시트 안쪽으로 분리  C: 제목 줄 고정 끔
// D: 제목 칸 자동 커서 끔  E: 커서를 애니메이션 끝난 뒤에  F: 내용을 그린 뒤 시트 열기
export const DIAG = (new URLSearchParams(location.search).get('diag') || '').toUpperCase().replace(/[^A-F]/g, '');
export const DIAG_BUILD = 'diag-1';
if (DIAG) document.documentElement.dataset.diag = DIAG;
export const diagOn = (k) => DIAG.includes(k);

function rect(el) { if (!el) return null; const r = el.getBoundingClientRect(); return [r.top, r.height, r.width].map(Math.round).join('/'); }

export function diagReport(sheet) {
  if (!DIAG && new URLSearchParams(location.search).get('diag') === null) return;
  const lines = [`출타 장부 ${DIAG_BUILD} · 변형 ${DIAG || '없음(기본)'}`, `${navigator.userAgent.match(/OS [\d_]+/)?.[0] ?? ''} standalone=${navigator.standalone === true || matchMedia('(display-mode: standalone)').matches}`];
  const sample = (ms) => {
    const cs = getComputedStyle(sheet); const vv = window.visualViewport;
    lines.push(`${ms}ms 시트${rect(sheet)} 제목${rect(sheet.querySelector('.sheet__head'))} 본문${rect(sheet.querySelector('.sheet__body'))} scroll=${Math.round(sheet.scrollTop)} op=${cs.opacity} tf=${cs.transform === 'none' ? 'none' : 'set'} focus=${document.activeElement?.id || document.activeElement?.tagName} vv=${vv ? Math.round(vv.height) + '@' + Math.round(vv.offsetTop) : '-'}`);
  };
  let panel = null;
  const show = () => {
    panel?.remove();
    panel = document.createElement('pre');
    panel.className = 'diag-panel';
    panel.textContent = lines.join('\n');
    sheet.append(panel);
  };
  [0, 300, 1000].forEach((ms) => setTimeout(() => { sample(ms); show(); }, ms));
}
