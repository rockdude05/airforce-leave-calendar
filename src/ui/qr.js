// QR 그리기. 모듈 계산(순수)과 SVG 생성(DOM)을 나눠 Node 테스트가 계산 부분을 검증한다.
// SVG는 createElementNS로 만들고 style 속성을 쓰지 않는다 (CSP style-src 'self').
import { QrCode, QrSegment } from '../vendor/qrcodegen.js';

const ECC = { L: 'LOW', M: 'MEDIUM', Q: 'QUARTILE', H: 'HIGH' };
const ECC_BY_ORDINAL = ['L', 'M', 'Q', 'H'];
const SHARE_MARK = '#s=';
/** 규격상 여백(quiet zone) 4모듈 */
const QUIET = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 세그먼트 나누기. makeSegments는 글 전체를 한 모드로 넣으므로 소문자 주소가 섞인 링크는 통째로 BYTE가 된다.
 * '#s=' 뒤 코드가 알파뉴메릭(0-9A-Z 공백 $%*+-./:)이면 주소는 BYTE, 코드는 ALPHANUMERIC으로 나눠 QR을 줄인다.
 */
function segmentsFor(text) {
  const at = text.lastIndexOf(SHARE_MARK);
  if (at >= 0) {
    const code = text.slice(at + SHARE_MARK.length);
    if (code.length && QrSegment.isAlphanumeric(code)) {
      return [QrSegment.makeBytes(new TextEncoder().encode(text.slice(0, at + SHARE_MARK.length))), QrSegment.makeAlphanumeric(code)];
    }
  }
  return QrSegment.makeSegments(text);
}

/**
 * 글 → 모듈 격자. boostEcl=false라 요청한 오류 정정 등급을 그대로 쓴다(ecc 필드로 확인 가능).
 * @param {string} text
 * @param {'L'|'M'|'Q'|'H'} [ecc]
 * @returns {{ size: number, ecc: 'L'|'M'|'Q'|'H', dark: (x: number, y: number) => boolean }}
 */
export function qrModules(text, ecc = 'M') {
  const name = ECC[ecc];
  if (!name) throw new RangeError(`unknown ecc level: ${String(ecc)}`);
  const qr = QrCode.encodeSegments(segmentsFor(text), QrCode.Ecc[name], 1, 40, -1, false);
  return { size: qr.size, ecc: ECC_BY_ORDINAL[qr.errorCorrectionLevel.ordinal], dark: (x, y) => qr.getModule(x, y) };
}

/** 어두운 모듈마다 'M x y h1 v1 h-1 z' 한 조각. 좌표는 여백 4를 더한 값. */
export function qrPathData(text, ecc = 'M') {
  const m = qrModules(text, ecc);
  const parts = [];
  for (let y = 0; y < m.size; y += 1) {
    for (let x = 0; x < m.size; x += 1) if (m.dark(x, y)) parts.push(`M${x + QUIET} ${y + QUIET}h1v1h-1z`);
  }
  return { size: m.size, d: parts.join('') };
}

/**
 * 흰 배경 + 검은 path 하나로 된 SVG. 실패(글이 너무 김 등)는 예외를 그대로 던진다 — 호출자가 안내한다.
 * @returns {SVGSVGElement}
 */
export function renderQrSvg(text, { ecc = 'M' } = {}) {
  const { size, d } = qrPathData(text, ecc);
  const total = size + QUIET * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '일정 공유 QR');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(total));
  bg.setAttribute('height', String(total));
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}
