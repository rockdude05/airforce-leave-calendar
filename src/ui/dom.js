// DOM 생성 도우미. 문자열 자식은 항상 텍스트 노드가 되므로 사용자 입력이 HTML로 실행되지 않는다.

/**
 * @param {string} tag
 * @param {Record<string, any>|null} [attrs]
 * @param {...any} children
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = Boolean(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

/** replaceChildren과 같지만 null·false 자식은 건너뛴다 ("null" 글자 렌더 방지). */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** el.append과 같지만 null·false 자식은 건너뛴다 — 네이티브 append는 null을 "null" 글자로 넣는다. */
export function add(el, ...children) {
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-10-10' -> '10월 10일 (토)' */
export function formatDate(date, { weekday = true, year = false } = {}) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${year ? `${y}년 ` : ''}${m}월 ${d}일${weekday ? ` (${wd})` : ''}`;
}

/** '2026-10-10' -> '10.10' */
export function shortDate(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}.${d}`;
}

export function formatRange(start, end) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

export function weekdayName(index) {
  return WEEKDAYS[index];
}

/**
 * 이슈 목록 블록. 비어 있으면 null.
 * onAsk(code)는 선택적 — 코드에 매핑된 규칙 항목이 있을 때만 "문의하기" 클릭 핸들러를 돌려주면 그 안내에 버튼을 붙인다.
 */
export function issueList(issues, { id, onAsk } = {}) {
  if (!issues.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const hasError = sorted.some((i) => i.severity === 'error');
  return h('ul', { class: 'issues', id, role: hasError ? 'alert' : null },
    sorted.map((i) => {
      const ask = onAsk?.(i.code);
      return h('li', { class: `issue issue--${i.severity}` },
        h('span', { class: 'issue__tag' }, { error: '저장 불가', warning: '확인 필요', info: '안내' }[i.severity]),
        h('span', { class: 'issue__msg' }, i.message),
        ask ? h('button', { type: 'button', class: 'btn btn--ghost btn--small issue__ask', onClick: ask }, '문의하기') : null);
    }));
}
