const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

/**
 * 실패 시 최대 2회까지 재시도하는 fetch 래퍼.
 */
async function fetchWithRetry(url, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} - ${url}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

export async function fetchHtml(url, options = {}) {
  const res = await fetchWithRetry(url, options);
  return res.text();
}

export async function fetchJson(url, options = {}) {
  const res = await fetchWithRetry(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  return res.json();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 텍스트 안에서 #키워드 형태를 모두 뽑아 공백으로 구분된 문자열로 반환.
 * 하나도 없으면 빈 문자열.
 */
export function extractHashtags(text) {
  if (!text) return "";
  const matches = text.match(/#[^\s#,]+/g);
  return matches ? [...new Set(matches)].join(" ") : "";
}

/**
 * 텍스트 안에서 4.7(1,664) 같은 "별점(리뷰수)" 패턴을 찾아 { rating, reviewCount } 반환.
 * 없으면 둘 다 빈 문자열.
 */
export function extractRatingAndReviewCount(text) {
  if (!text) return { rating: "", reviewCount: "" };
  const match = text.match(/(\d(?:\.\d)?)\s*\(([\d,]+)\)/);
  if (!match) return { rating: "", reviewCount: "" };
  return { rating: match[1], reviewCount: match[2] };
}

/**
 * 텍스트에서 YYYY.MM.DD / YYYY-MM-DD 형태의 가장 이른 날짜를 찾아 YYYY-MM-DD로 반환.
 * 없으면 빈 문자열.
 */
export function extractEarliestDate(text) {
  if (!text) return "";
  const matches = [...text.matchAll(/(\d{4})[.\-](\d{2})[.\-](\d{2})/g)];
  if (!matches.length) return "";
  const dates = matches.map((m) => `${m[1]}-${m[2]}-${m[3]}`).sort();
  return dates[0];
}
