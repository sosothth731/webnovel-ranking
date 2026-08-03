/**
 * Next.js 등 SSR 프레임워크가 페이지에 심어둔 __NEXT_DATA__ 같은 대형 JSON 안에서
 * "책/작품 목록으로 보이는 배열"을 재귀적으로 찾아낸다.
 *
 * 정확한 스키마를 모를 때 쓰는 방어적 탐색 방법: 각 사이트의 API 응답 구조가
 * 언제든 바뀔 수 있으므로, 고정 경로(예: data.props.pageProps.list) 대신
 * "이런 모양의 배열"을 찾는 방식으로 어느 정도의 변화에 견디도록 했다.
 *
 * @param {any} root 탐색할 JSON
 * @param {(item: any) => boolean} itemMatcher 배열의 각 원소가 "책 항목"인지 판별하는 함수
 * @param {number} minLength 이 정도 길이 이상이어야 유의미한 목록으로 인정
 * @returns {any[] | null}
 */
export function deepFindArray(root, itemMatcher, minLength = 5) {
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length >= minLength && node.every((item) => itemMatcher(item))) {
        return node;
      }
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }

    for (const key of Object.keys(node)) {
      const found = walk(node[key]);
      if (found) return found;
    }
    return null;
  }

  return walk(root);
}

/**
 * JSON 트리 전체를 재귀적으로 훑어서, 키 이름에 "date"가 들어간 필드들의 값 중
 * YYYY-MM-DD / YYYY.MM.DD 형태로 보이는 것을 전부 모아 가장 이른 날짜를 반환한다.
 * 정확한 필드명을 모를 때(사이트 구조가 바뀌었을 때) 쓰는 최후의 수단.
 */
export function findEarliestDateField(root, maxDepth = 6) {
  const seen = new Set();
  const dateLike = /^\d{4}[.\-]\d{2}[.\-]\d{2}/;
  let earliest = null;

  function walk(node, depth) {
    if (!node || typeof node !== "object" || depth > maxDepth) return;
    if (seen.has(node)) return;
    seen.add(node);

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && /date/i.test(key) && dateLike.test(value)) {
        const normalized = value.slice(0, 10).replace(/\./g, "-");
        if (!earliest || normalized < earliest) earliest = normalized;
      } else if (value && typeof value === "object") {
        walk(value, depth + 1);
      }
    }
  }

  walk(root, 0);
  return earliest;
}

/**
 * 객체 안에서 이름에 keyword를 포함하는 첫 번째 키의 값을 찾는다 (대소문자 무시, 재귀 X, 얕은 탐색).
 */
export function findFieldLike(obj, keyword) {
  if (!obj || typeof obj !== "object") return undefined;
  const lower = keyword.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().includes(lower)) return obj[key];
  }
  return undefined;
}
