import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const MAIN_CSV = `확인날짜,플랫폼,순위,작품명,작가명,론칭일,지표종류,지표값,키워드,URL
2026-08-09,네이버시리즈,1,테스트작품A,작가A,2026-01-01,다운로드수,"10만","#로맨스","https://series.naver.com/novel/detail.series?productNo=1"
`;

const ROMANCE_CSV = `확인날짜,작품명,작가명,론칭일,별점,댓글수,다운로드수,키워드,URL
2026-08-09,버릇 나쁜 오빠,갓녀,2026-08-02,9.9,106,"17.5만","#로맨스 #19금","https://series.naver.com/novel/detail.series?productNo=14506678"
2026-08-08,다른 로맨스 신작,홍길동,2026-08-01,8.5,50,"5만","#로맨스","https://series.naver.com/novel/detail.series?productNo=99999999"
`;

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  beforeParse(window) {
    // 실제 CDN(cdnjs)은 이 샌드박스에서 접근 불가하므로 Papa.parse를 가벼운 스텁으로 대체.
    window.Papa = {
      parse(text, opts) {
        const lines = text.trim().split("\n");
        const headers = lines[0].split(",");
        const data = lines.slice(1).map((line) => {
          // 테스트 데이터는 필드 안에 콤마가 없는 경우가 대부분이라 간단히 분리,
          // 따옴표로 감싼 필드만 처리
          const cells = [];
          let cur = "";
          let inQ = false;
          for (const ch of line) {
            if (ch === '"') { inQ = !inQ; continue; }
            if (ch === "," && !inQ) { cells.push(cur); cur = ""; continue; }
            cur += ch;
          }
          cells.push(cur);
          const row = {};
          headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
          return row;
        });
        return { data };
      },
    };
    window.fetch = async (url) => {
      if (url.includes("naver_dailyfree_romance_new.csv")) {
        return { ok: true, text: async () => ROMANCE_CSV };
      }
      if (url.includes("webnovel_ranking.csv")) {
        return { ok: true, text: async () => MAIN_CSV };
      }
      return { ok: false, text: async () => "" };
    };
  },
});

const { window } = dom;

// setup()이 fetch(Promise.all) 완료 후 비동기로 호출되므로 잠깐 대기
await new Promise((resolve) => setTimeout(resolve, 300));

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

// 1) 로맨스 탭으로 이동하면 romanceView가 보이고 카드가 렌더링되는지
window.location.hash = "#/romance";
await new Promise((resolve) => setTimeout(resolve, 50));
const romanceView = window.document.getElementById("romanceView");
assert(romanceView.style.display === "block", "#/romance 이동 시 romanceView가 보인다");
const romanceWrap = window.document.getElementById("romanceWrap");
assert(romanceWrap.innerHTML.includes("버릇 나쁜 오빠"), "로맨스 신작 카드가 렌더링된다");
assert(
  romanceWrap.querySelector('a.card-title[href*="/romance/work/"]') !== null,
  "카드 제목 링크가 상세페이지(#/romance/work/...)를 가리킨다"
);

// 2) 날짜 이동(이전 날짜) 시 다른 날짜 데이터로 바뀌는지
window.document.getElementById("romanceDatePrev").click();
await new Promise((resolve) => setTimeout(resolve, 50));
assert(romanceWrap.innerHTML.includes("다른 로맨스 신작"), "이전 날짜로 이동하면 그 날짜의 카드가 보인다");

// 3) 상세페이지 라우팅 및 3개 차트(별점/댓글수/다운로드수) 렌더링
const url = "https://series.naver.com/novel/detail.series?productNo=14506678";
window.location.hash = `#/romance/work/${encodeURIComponent(url)}`;
await new Promise((resolve) => setTimeout(resolve, 50));
const romanceDetailView = window.document.getElementById("romanceDetailView");
assert(romanceDetailView.style.display === "block", "#/romance/work/... 이동 시 상세페이지가 보인다");
assert(romanceDetailView.innerHTML.includes("버릇 나쁜 오빠"), "상세페이지에 작품명이 나온다");
assert(romanceDetailView.innerHTML.includes("별점 추이"), "별점 추이 차트 섹션이 있다");
assert(romanceDetailView.innerHTML.includes("댓글수 추이"), "댓글수 추이 차트 섹션이 있다");
assert(romanceDetailView.innerHTML.includes("다운로드수 추이"), "다운로드수 추이 차트 섹션이 있다");

// 4) 검색창에 로맨스 신작 제목을 치면 드롭다운에 뜨고, 클릭하면 해당 상세페이지로 감
window.location.hash = "";
await new Promise((resolve) => setTimeout(resolve, 50));
const searchInput = window.document.getElementById("searchInput");
searchInput.value = "버릇";
searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 50));
const searchResults = window.document.getElementById("searchResults");
assert(!searchResults.hidden, "검색어 입력 시 드롭다운이 열린다");
assert(searchResults.innerHTML.includes("버릇 나쁜 오빠"), "드롭다운에 로맨스 신작이 뜬다");
const resultBtn = searchResults.querySelector(".search-result-item");
assert(resultBtn?.dataset.kind === "romance", "검색 결과 항목에 romance kind가 붙는다");

resultBtn.click();
await new Promise((resolve) => setTimeout(resolve, 50));
assert(
  window.location.hash === `#/romance/work/${encodeURIComponent(url)}`,
  "검색 결과 클릭 시 로맨스 상세페이지로 이동한다"
);

// 5) 네비게이션 pill 활성화 상태
window.location.hash = "#/romance";
await new Promise((resolve) => setTimeout(resolve, 50));
assert(
  window.document.getElementById("navRomance").classList.contains("active"),
  "로맨스 탭에서 navRomance pill이 active 상태가 된다"
);
assert(
  !window.document.getElementById("navBoard").classList.contains("active"),
  "로맨스 탭에서 navBoard pill은 active가 아니다"
);

console.log(process.exitCode ? "\n일부 테스트 실패" : "\n모든 테스트 통과");

// 6) 기존 TOP15 보드/상세페이지 라우팅 회귀 테스트 (로맨스 기능 추가로 안 깨졌는지 확인)
searchInput.value = "";
searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
window.location.hash = "";
await new Promise((resolve) => setTimeout(resolve, 50));
assert(window.document.getElementById("boardView").style.display === "block", "기본(#) 라우트는 boardView를 보여준다");
assert(window.document.getElementById("boardWrap").innerHTML.includes("테스트작품A"), "TOP15 보드에 기존 카드가 여전히 렌더링된다");

const top15Url = "https://series.naver.com/novel/detail.series?productNo=1";
window.location.hash = `#/work/${encodeURIComponent(top15Url)}`;
await new Promise((resolve) => setTimeout(resolve, 50));
assert(window.document.getElementById("detailView").style.display === "block", "#/work/... 라우트는 detailView를 보여준다");
assert(window.document.getElementById("detailView").innerHTML.includes("테스트작품A"), "TOP15 상세페이지가 여전히 정상 렌더링된다");

searchInput.value = "테스트작품A";
searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 50));
const top15ResultBtn = searchResults.querySelector(".search-result-item");
assert(top15ResultBtn?.dataset.kind === "top15", "TOP15 작품 검색 결과에는 top15 kind가 붙는다");

console.log(process.exitCode ? "\n일부 테스트 실패" : "\n모든 테스트 통과 (회귀 포함)");
