import * as cheerio from "cheerio";
import { fetchHtml, sleep, extractRatingAndReviewCount, extractEarliestDate } from "../lib/http.js";
import { deepFindArray, findEarliestDateField } from "../lib/deepFind.js";

const LIST_URL = "https://ridibooks.com/bestsellers/romance";
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 500);

export async function collectRidibooks() {
  const html = await fetchHtml(LIST_URL);
  const $ = cheerio.load(html);

  let items = extractFromNextData($);
  let usedFallback = false;

  if (!items || !items.length) {
    items = extractFromHtml($);
    usedFallback = true;
  }

  if (!items.length) {
    throw new Error(
      "리디북스: 베스트 목록에서 작품을 하나도 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다."
    );
  }

  if (usedFallback) {
    console.warn(
      "[리디북스] __NEXT_DATA__를 찾지 못해 HTML 직접 파싱으로 대체했습니다. 결과를 한번 검산해보세요."
    );
  }

  const top15 = items.slice(0, 15);

  // 론칭일과 키워드 둘 다 목록 페이지엔 없어서, 작품 상세페이지를 하나씩 더 조회합니다.
  // (한 작품당 상세페이지는 한 번만 요청하고, 그 안에서 론칭일/키워드를 같이 뽑습니다.)
  const enriched = [];
  for (let i = 0; i < top15.length; i++) {
    const item = top15[i];
    let detail = { launchDate: "", keywords: "" };
    try {
      detail = await fetchDetailInfo(item.bookId);
    } catch (err) {
      console.warn(`[리디북스] ${item.title} 상세정보 조회 실패: ${err.message}`);
    }
    enriched.push({
      platform: "리디북스",
      rank: i + 1,
      title: item.title,
      author: item.author,
      launchDate: detail.launchDate,
      metricType: "별점(리뷰수)",
      metricValue: item.rating && item.reviewCount ? `${item.rating}(${item.reviewCount})` : "",
      keywords: detail.keywords,
      url: item.bookId ? `https://ridibooks.com/books/${item.bookId}` : "",
    });
    await sleep(REQUEST_DELAY_MS);
  }

  return enriched;
}

/**
 * 1차 시도: Next.js가 SSR 시 페이지에 심어두는 __NEXT_DATA__ JSON에서 책 목록을 찾는다.
 * 클래스명 기반 파싱보다 사이트 리디자인에 훨씬 덜 취약하다.
 */
function extractFromNextData($) {
  const raw = $("#__NEXT_DATA__").html();
  if (!raw) return null;

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  // 1순위: 실제로 확인된 정확한 경로.
  // dehydratedState.queries 안에서 queryKey[0] === 'BestSellers'인 쿼리가
  // data.bestsellers.items[] 에 랭킹 순서 그대로(0번=1위) 작품 목록을 담고 있다.
  let items = null;
  const queries = json?.props?.pageProps?.dehydratedState?.queries;
  if (Array.isArray(queries)) {
    const bestsellersQuery = queries.find(
      (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "BestSellers"
    );
    items = bestsellersQuery?.state?.data?.bestsellers?.items;
  }

  // 2순위 폴백: 위 경로가 사이트 개편으로 바뀌었을 경우, 일반적인 형태로 배열을 다시 탐색.
  if (!Array.isArray(items)) {
    items = deepFindArray(
      json,
      (entry) => entry?.book?.title?.main && Array.isArray(entry?.book?.authors)
    );
  }

  if (!Array.isArray(items)) return null;

  return items.map((entry) => {
    const book = entry?.book ?? {};
    const title = book?.series?.title || book?.title?.main || "";
    const author = (book.authors || []).map((a) => a.name).filter(Boolean).join(", ");
    const bookId = book.id ?? "";

    const ratings = Array.isArray(book.ratings) ? book.ratings : [];
    const totalCount = ratings.reduce((sum, r) => sum + (r.count || 0), 0);
    const weightedSum = ratings.reduce((sum, r) => sum + (r.count || 0) * (r.rating || 0), 0);
    const avgRating = totalCount ? (weightedSum / totalCount).toFixed(1) : "";

    return {
      bookId: String(bookId),
      title,
      author,
      rating: avgRating,
      reviewCount: totalCount ? totalCount.toLocaleString("en-US") : "",
    };
  });
}

/**
 * 2차 시도(폴백): __NEXT_DATA__가 없거나 원하는 배열을 못 찾았을 때,
 * "/books/{id}" 링크를 기준으로 HTML을 직접 훑는다.
 */
function extractFromHtml($) {
  const results = [];
  const seenBookIds = new Set();

  $('a[href^="/books/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/^\/books\/(\d+)/);
    if (!match) return;
    const bookId = match[1];
    if (seenBookIds.has(bookId)) return;

    const title = $(el).text().trim();
    if (!title) return; // 이미지만 있는 링크는 건너뜀

    seenBookIds.add(bookId);

    // 해당 링크를 포함하는 li(또는 비슷한 블록) 전체 텍스트에서 부가정보 추출
    const $block = $(el).closest("li, div").length ? $(el).closest("li, div") : $(el).parent();
    const blockText = $block.text();

    const author = $block.find('a[href^="/author/"]').first().text().trim();
    const { rating, reviewCount } = extractRatingAndReviewCount(blockText);

    results.push({ bookId, title, author, rating, reviewCount });
  });

  return results;
}

/**
 * "발행일" 같은 라벨 글자를 가진 요소를 찾아서, 그 안(라벨+값이 한 덩어리인 경우)이나
 * 바로 다음 형제 요소들, 혹은 부모의 다음 형제 블록에서 날짜를 찾는다.
 * 정확한 태그 구조(dt/dd, th/td 등)를 몰라도 동작하도록 만든 범용 탐색 방식이다.
 */
function extractDateNearLabel($, labelPattern) {
  let result = null;
  $("*").each((_, el) => {
    if (result) return;
    const $el = $(el);
    if ($el.children().length > 0) return; // 텍스트만 있는 최하위 요소 위주로 검사(중복 매칭 방지)
    const text = $el.text().trim();
    if (!text || !labelPattern.test(text)) return;

    // 라벨과 값이 같은 요소 안에 함께 있는 경우: "발행일 2023.05.12" 또는 "발행일 : 2023.05.12"
    const inline = extractEarliestDate(text);
    if (inline) {
      result = inline;
      return;
    }

    // 라벨 다음에 오는 형제 요소 몇 개 안에서 찾기 (라벨/값이 나뉜 구조)
    let sib = $el.next();
    for (let i = 0; i < 3 && sib.length && !result; i++, sib = sib.next()) {
      const d = extractEarliestDate(sib.text());
      if (d) result = d;
    }
    if (result) return;

    // 부모를 감싸는 다음 형제 블록에서 찾기 (라벨/값이 각각 다른 상위 블록에 있는 구조)
    const parentSib = $el.parent().next();
    if (parentSib.length) {
      const d = extractEarliestDate(parentSib.text());
      if (d) result = d;
    }
  });
  return result;
}

// 거의 모든 로맨스 책 상세페이지에 공통으로 붙는 사이트 전역 카테고리 라벨.
// meta keywords 태그 맨 앞에 항상 끼어있어서, 작품 고유 키워드가 아니므로 제외한다.
const GENERIC_KEYWORDS = new Set(["ebook", "전자책", "로맨스 e북", "e북"]);

async function fetchDetailInfo(bookId) {
  if (!bookId) return { launchDate: "", keywords: "" };
  const html = await fetchHtml(`https://ridibooks.com/books/${bookId}`);
  const $ = cheerio.load(html);

  // 키워드: <meta name="keywords" content="ebook,전자책,...,절륜남,순진녀,..."> 에서 가져온다.
  // 화면에 보이는 "이 작품의 키워드" 섹션과 동일한 내용이 여기 쉼표로 나열되어 있다(실측 확인됨).
  const keywordsRaw = $('meta[name="keywords"]').attr("content") || "";
  const keywords = keywordsRaw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .filter((k) => !GENERIC_KEYWORDS.has(k))
    .map((k) => `#${k}`)
    .join(" ");

  // 론칭일 (기존 로직 그대로: 라벨 근접 탐색 → __NEXT_DATA__ → 페이지 전체 최후수단)
  const labelPattern = /발행일|등록일|출간일|최초\s*등록|연재\s*시작/;
  let launchDate = extractDateNearLabel($, labelPattern);

  if (!launchDate) {
    const nextDataRaw = $("#__NEXT_DATA__").html();
    if (nextDataRaw) {
      try {
        launchDate = findEarliestDateField(JSON.parse(nextDataRaw));
      } catch {
        // JSON 파싱 실패 시 아래 최후 수단으로 계속 진행
      }
    }
  }

  if (!launchDate) {
    launchDate = extractEarliestDate($.text());
  }

  return { launchDate: launchDate || "", keywords };
}
