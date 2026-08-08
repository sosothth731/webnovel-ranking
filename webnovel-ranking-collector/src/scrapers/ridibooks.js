import * as cheerio from "cheerio";
import { fetchHtml, sleep, extractHashtags, extractRatingAndReviewCount, extractEarliestDate } from "../lib/http.js";
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

  // 론칭일은 목록 페이지에 없어서 작품 상세페이지를 하나씩 더 조회합니다.
  const enriched = [];
  for (let i = 0; i < top15.length; i++) {
    const item = top15[i];
    let launchDate = "";
    try {
      launchDate = await fetchLaunchDate(item.bookId);
    } catch (err) {
      console.warn(`[리디북스] ${item.title} 론칭일 조회 실패: ${err.message}`);
    }
    enriched.push({
      platform: "리디북스",
      rank: i + 1,
      title: item.title,
      author: item.author,
      launchDate,
      metricType: "별점(리뷰수)",
      metricValue: item.rating && item.reviewCount ? `${item.rating}(${item.reviewCount})` : "",
      keywords: item.keywords || "",
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
    const description = book?.introduction?.description ?? "";

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
      keywords: extractHashtags(description),
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
    const keywords = extractHashtags(blockText);

    results.push({ bookId, title, author, rating, reviewCount, keywords });
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

async function fetchLaunchDate(bookId) {
  if (!bookId) return "";
  const html = await fetchHtml(`https://ridibooks.com/books/${bookId}`);
  const $ = cheerio.load(html);

  // 1순위: "발행일/등록일/출간일" 같은 라벨 주변에서 직접 찾기 (화면에 실제 보이는 값 기준,
  // 실측으로 확인된 가장 신뢰도 높은 방법). 태그 구조가 dt/dd든 span이든 상관없이 동작한다.
  const labelPattern = /발행일|등록일|출간일|최초\s*등록|연재\s*시작/;
  const fromLabel = extractDateNearLabel($, labelPattern);
  if (fromLabel) return fromLabel;

  // 2순위: 상세페이지에 __NEXT_DATA__가 있는 경우, 그 안에서 발행 관련 필드를 찾는다.
  // (베스트 목록 페이지와 달리 상세페이지 __NEXT_DATA__엔 책 정보가 없을 수 있어 후순위로 둔다.)
  const nextDataRaw = $("#__NEXT_DATA__").html();
  if (nextDataRaw) {
    try {
      const nextDataJson = JSON.parse(nextDataRaw);
      const found = findEarliestDateField(nextDataJson);
      if (found) return found;
    } catch {
      // JSON 파싱 실패 시 아래 최후 수단으로 계속 진행
    }
  }

  // 3순위(최후 수단): 페이지 전체에서 가장 이른 날짜. 라벨과 무관하게 고르는 거라
  // 정확도가 가장 낮으니, 위 두 방법이 전부 실패했을 때만 사용한다.
  return extractEarliestDate($.text());
}
