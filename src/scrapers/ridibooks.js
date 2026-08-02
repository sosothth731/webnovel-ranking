import * as cheerio from "cheerio";
import { fetchHtml, sleep, extractHashtags, extractRatingAndReviewCount, extractEarliestDate } from "../lib/http.js";
import { deepFindArray, findFieldLike } from "../lib/deepFind.js";

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

  const bookItems = deepFindArray(
    json,
    (item) =>
      item &&
      typeof item === "object" &&
      typeof findFieldLike(item, "title") === "string" &&
      (findFieldLike(item, "author") !== undefined || findFieldLike(item, "writer") !== undefined)
  );

  if (!bookItems) return null;

  return bookItems.map((item) => {
    const title = findFieldLike(item, "title") ?? "";
    const authorField = findFieldLike(item, "author") ?? findFieldLike(item, "writer") ?? "";
    const author = typeof authorField === "string" ? authorField : JSON.stringify(authorField);
    const bookId = findFieldLike(item, "id") ?? findFieldLike(item, "bookId") ?? "";
    const rating = findFieldLike(item, "rating") ?? findFieldLike(item, "score") ?? "";
    const reviewCount = findFieldLike(item, "reviewCount") ?? findFieldLike(item, "ratingCount") ?? "";
    const description = findFieldLike(item, "description") ?? findFieldLike(item, "phrase") ?? "";

    return {
      bookId: String(bookId),
      title,
      author,
      rating: rating ? String(rating) : "",
      reviewCount: reviewCount ? String(reviewCount) : "",
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

async function fetchLaunchDate(bookId) {
  if (!bookId) return "";
  const html = await fetchHtml(`https://ridibooks.com/books/${bookId}`);
  const $ = cheerio.load(html);

  // 상세페이지 정보 테이블(dt/dd 구조)에서 "발행"/"등록" 관련 항목을 우선적으로 찾는다.
  let dateText = "";
  $("dt, th").each((_, el) => {
    const label = $(el).text();
    if (/발행|등록|출간/.test(label)) {
      const $value = $(el).next("dd, td");
      if ($value.length) dateText += " " + $value.text();
    }
  });

  const fromLabel = extractEarliestDate(dateText);
  if (fromLabel) return fromLabel;

  // 라벨 매칭에 실패하면 페이지 전체에서 가장 이른 날짜를 최후 수단으로 사용(정확도 낮을 수 있음).
  return extractEarliestDate($.text());
}
