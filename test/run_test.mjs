import * as cheerio from "cheerio";
import { readFile } from "node:fs/promises";
import { extractHashtags } from "../src/lib/http.js";

const listHtml = await readFile(new URL("./sample_list.html", import.meta.url), "utf8");
const $ = cheerio.load(listHtml);

const items = [];
$(".lst_list > li").each((_, li) => {
  const $li = $(li);
  const $titleLink = $li.find('h3 a[href*="detail.series?productNo="]').first();
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

console.log("=== [네이버시리즈] 목록 파싱 결과 ===");
console.log(items);

const newOnly = items.filter((i) => i.isNew);
console.log(`신규(신작) 뱃지 있는 항목 수: ${newOnly.length} / 전체 ${items.length}`);
if (newOnly.length !== 2) {
  console.error("❌ FAIL: 신규 항목 수가 예상(2)과 다릅니다");
  process.exitCode = 1;
} else {
  console.log("✅ PASS (목록 파싱)");
}

const detailHtml = await readFile(new URL("./sample_detail.html", import.meta.url), "utf8");
const $d = cheerio.load(detailHtml);

const rating = $d(".end_head .score_area em").first().text().trim();
const downloadCount = $d(".end_head .btn_download span").first().text().trim();
const commentCount = $d(".end_head #commentCount").first().text().trim();
const description = $d('meta[name="description"]').attr("content") || "";
const keywords = extractHashtags(description);
const isRomance = keywords.split(" ").includes("#로맨스");

console.log("\n=== [네이버시리즈] 상세페이지 파싱 결과 ===");
console.log({ rating, downloadCount, commentCount, keywords, isRomance });

const expected = { rating: "9.9", downloadCount: "17.5만", commentCount: "106", isRomance: true };
const ok =
  rating === expected.rating &&
  downloadCount === expected.downloadCount &&
  commentCount === expected.commentCount &&
  isRomance === expected.isRomance;
console.log(ok ? "✅ PASS (상세 파싱)" : "❌ FAIL (상세 파싱)");
if (!ok) process.exitCode = 1;
