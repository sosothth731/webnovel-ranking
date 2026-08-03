import * as cheerio from "cheerio";
import { fetchHtml, sleep, extractHashtags, extractEarliestDate } from "../lib/http.js";

const LIST_URL =
  "https://series.naver.com/novel/top100List.series?rankingTypeCode=DAILY&categoryCode=201";
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 500);

export async function collectNaverSeries() {
  const html = await fetchHtml(LIST_URL);
  const $ = cheerio.load(html);

  const items = [];

  // 확인된 정확한 구조: <ul class="comic_top_lst"> 안의 각 <li> 하나가 작품 한 편.
  // 제목은 반드시 .comic_cont h3 안의 링크에서만 가져온다 — 썸네일 링크(.pic)는
  // "매일10시무료" 같은 뱃지 텍스트를 포함하고 있어서 잘못된 제목으로 오인되기 쉽다.
  $(".comic_top_lst > li").each((_, li) => {
    const $li = $(li);
    const $titleLink = $li.find('.comic_cont h3 a[href*="detail.series?productNo="]').first();
    if (!$titleLink.length) return;

    const href = $titleLink.attr("href") || "";
    const match = href.match(/productNo=(\d+)/);
    if (!match) return;

    items.push({
      productNo: match[1],
      title: $titleLink.text().trim(),
      author: $li.find(".comic_cont .author").first().text().trim(),
      rating: $li.find(".comic_cont .score_num").first().text().trim(),
    });
  });

  if (!items.length) {
    throw new Error(
      "네이버시리즈: 랭킹 목록에서 작품을 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다."
    );
  }

  const top15 = items.slice(0, 15);

  const enriched = [];
  for (let i = 0; i < top15.length; i++) {
    const item = top15[i];
    let detail = { downloadCount: "", keywords: "", launchDate: "" };
    try {
      detail = await fetchDetail(item.productNo);
    } catch (err) {
      console.warn(`[네이버시리즈] ${item.title} 상세정보 조회 실패: ${err.message}`);
    }

    enriched.push({
      platform: "네이버시리즈",
      rank: i + 1,
      title: item.title,
      author: item.author,
      launchDate: detail.launchDate,
      metricType: "다운로드수",
      metricValue: detail.downloadCount,
      keywords: detail.keywords,
      url: `https://series.naver.com/novel/detail.series?productNo=${item.productNo}`,
    });
    await sleep(REQUEST_DELAY_MS);
  }

  return enriched;
}

async function fetchDetail(productNo) {
  const url = `https://series.naver.com/novel/detail.series?productNo=${productNo}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // 다운로드수: 상세페이지 상단 btn_download 안에 "19.5만" 형태로 노출 (직접 확인된 구조).
  const downloadCount = $(".btn_download span").first().text().trim();

  // 키워드: meta description 안에 "#로맨스 #메디컬 ..." 형태로 노출 (직접 확인된 구조).
  const description = $('meta[name="description"]').attr("content") || "";
  const keywords = extractHashtags(description);

  // 론칭일: 회차 목록 ajax 주소(sVolumeListUrl)를 오름차순으로 호출해 1화 등록일을 가져온다.
  let launchDate = "";
  const pageSource = html;
  const volumeListMatch = pageSource.match(/sVolumeListUrl\s*:\s*'([^']+)'/);
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
      console.warn(`[네이버시리즈] productNo=${productNo} 회차 목록 조회 실패: ${err.message}`);
    }
  }

  return { downloadCount, keywords, launchDate };
}
