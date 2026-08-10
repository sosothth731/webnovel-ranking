import * as cheerio from "cheerio";
import { fetchHtml, sleep, extractHashtags, extractEarliestDate } from "../lib/http.js";

const LIST_URL_BASE =
  "https://series.naver.com/novel/specialFreeList.series?specialFreeTypeCode=FREEFROMTODAY&orderTypeCode=NEW";
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 500);
const MAX_PAGES_SAFETY = 200; // 사이트가 이상하게 응답해도 무한루프에 빠지지 않도록 하는 안전장치

/**
 * 네이버시리즈 "매일10시무료(FREEFROMTODAY)" 목록을 최신순으로 전부 훑어서,
 * 그중 "신규"(작품 자체가 신작인 경우) 뱃지가 붙은 항목만 골라낸 뒤,
 * 상세페이지에서 장르가 로맨스(#로맨스 키워드)인 것만 남긴다.
 *
 * 주의: 이 목록의 정렬(orderTypeCode=NEW)은 "작품이 매일10시무료 프로모션에
 * 편입된 시점" 기준으로 보이며, "신규"/"새로운 에피소드" 뱃지와는 무관하게 섞여
 * 나온다(실측 확인됨). 그래서 신작만 뽑으려면 목록 전체를 끝까지 훑어야 한다.
 */
export async function collectNaverDailyFreeNewRomance() {
  const firstPageHtml = await fetchHtml(pageUrl(1));
  const $first = cheerio.load(firstPageHtml);

  const totalText = $first(".lst_header .total .num").first().text().trim();
  const total = Number(totalText.replace(/,/g, ""));

  const firstPageItems = parseListPage($first);
  if (!firstPageItems.length) {
    throw new Error(
      "네이버시리즈(매일10시무료): 목록에서 작품을 하나도 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다."
    );
  }

  const perPage = firstPageItems.length;
  const totalPages = Number.isFinite(total) && total > 0
    ? Math.min(Math.ceil(total / perPage), MAX_PAGES_SAFETY)
    : 1;

  const allItems = [...firstPageItems];

  for (let page = 2; page <= totalPages; page++) {
    let $page;
    try {
      const html = await fetchHtml(pageUrl(page));
      $page = cheerio.load(html);
    } catch (err) {
      console.warn(`[네이버시리즈-매일10시무료] ${page}페이지 조회 실패: ${err.message}`);
      continue;
    }
    const items = parseListPage($page);
    if (!items.length) break; // 더 이상 항목이 없으면 종료
    allItems.push(...items);
    await sleep(REQUEST_DELAY_MS);
  }

  const newOnly = allItems.filter((item) => item.isNew);

  const rows = [];
  for (const item of newOnly) {
    let detail;
    try {
      detail = await fetchRomanceDetail(item.productNo);
    } catch (err) {
      console.warn(`[네이버시리즈-매일10시무료] ${item.title} 상세정보 조회 실패: ${err.message}`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    if (!detail.isRomance) continue; // 로맨스 장르가 아니면 제외

    rows.push({
      title: item.title,
      author: item.author,
      launchDate: detail.launchDate,
      rating: detail.rating,
      commentCount: detail.commentCount,
      downloadCount: detail.downloadCount,
      keywords: detail.keywords,
      url: `https://series.naver.com/novel/detail.series?productNo=${item.productNo}`,
    });
  }

  return rows;
}

function pageUrl(page) {
  return `${LIST_URL_BASE}&page=${page}`;
}

/**
 * 목록 페이지 하나(<ul class="lst_list"> 안의 <li>들)를 파싱한다.
 * 확인된 정확한 구조:
 * - 제목/작품번호: h3 안의 <a href="...detail.series?productNo=...">
 * - "신규"(작품 자체가 신작) 뱃지: h3 안의 <em class="ico ico_new3">신규</em>
 *   ("새로운 에피소드" 뱃지 <em class="ico ico_update">는 신작이 아니라 업데이트이므로 제외)
 * - 작가명: .cont .author
 */
function parseListPage($) {
  const items = [];
  $(".lst_list > li").each((_, li) => {
    const $li = $(li);
    const $titleLink = $li
      .find('h3 a[href*="detail.series?productNo="]')
      .first();
    if (!$titleLink.length) return;

    const href = $titleLink.attr("href") || "";
    const match = href.match(/productNo=(\d+)/);
    if (!match) return;

    const isNew = $li.find("h3 em.ico_new3").text().trim() === "신규";

    items.push({
      productNo: match[1],
      title: $titleLink.attr("title")?.trim() || $titleLink.text().trim(),
      author: $li.find(".cont .author").first().text().trim(),
      isNew,
    });
  });
  return items;
}

/**
 * 상세페이지에서 별점/댓글수/다운로드수/장르(로맨스 여부)/론칭일을 가져온다.
 * 확인된 정확한 구조 (.end_head 영역):
 * - 별점: .end_head .score_area em
 * - 다운로드수: .end_head .btn_download span (예: "17.5만")
 * - 댓글수: .end_head #commentCount (예: "106")
 * - 장르/키워드: meta[name="description"] 안의 #해시태그들 (기존 top100 스크레이퍼와 동일 방식)
 * - 론칭일: sVolumeListUrl을 오름차순으로 호출해 1화 등록일 조회 (top100 스크레이퍼와 동일 로직)
 */
async function fetchRomanceDetail(productNo) {
  const url = `https://series.naver.com/novel/detail.series?productNo=${productNo}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const rating = $(".end_head .score_area em").first().text().trim();
  const downloadCount = $(".end_head .btn_download span").first().text().trim();
  const commentCount = $(".end_head #commentCount").first().text().trim();

  const description = $('meta[name="description"]').attr("content") || "";
  const keywords = extractHashtags(description);
  const isRomance = keywords.split(" ").includes("#로맨스");

  let launchDate = "";
  const volumeListMatch = html.match(/sVolumeListUrl\s*:\s*'([^']+)'/);
  if (volumeListMatch) {
    let volumeListPath = volumeListMatch[1];
    if (volumeListPath.includes("sortOrder=")) {
      volumeListPath = volumeListPath.replace(/sortOrder=[A-Z]+/, "sortOrder=ASC");
    } else {
      volumeListPath += (volumeListPath.includes("?") ? "&" : "?") + "sortOrder=ASC";
    }
    const volumeListUrl = volumeListPath.startsWith("http")
      ? volumeListPath
      : `https://series.naver.com${volumeListPath}`;

    try {
      const volumeRaw = await fetchHtml(volumeListUrl, {
        headers: { Referer: url, "X-Requested-With": "XMLHttpRequest" },
      });
      launchDate = extractEarliestDate(volumeRaw);
    } catch (err) {
      console.warn(`[네이버시리즈-매일10시무료] productNo=${productNo} 회차 목록 조회 실패: ${err.message}`);
    }
  }

  return { rating, downloadCount, commentCount, keywords, isRomance, launchDate };
}
