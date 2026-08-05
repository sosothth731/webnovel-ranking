import { fetchJson } from "../lib/http.js";

const LANDING_URL = "https://page.kakao.com/landing/ranking/11/89/";

/**
 * 카카오페이지 로맨스 랭킹 TOP15 수집.
 *
 * 카카오페이지는 클라이언트 렌더링(React/Next) 방식이라 랜딩 페이지 HTML 자체에는
 * 랭킹 데이터가 없습니다. 첨부 확장 프로그램(inject.js)이 그랬듯, 실제 데이터는
 * "/landing/ranking" 이 포함된 별도 API 요청으로 옵니다.
 *
 * 이 API의 정확한 요청 URL(쿼리 파라미터 포함)은 .env 의 KAKAO_RANKING_API_URL 로 넣어주세요.
 * 찾는 방법은 .env.example 상단 주석 참고.
 */
export async function collectKakaoPage() {
  const apiUrl = process.env.KAKAO_RANKING_API_URL;
  if (!apiUrl) {
    throw new Error(
      "KAKAO_RANKING_API_URL이 설정되지 않았습니다. .env 파일에 카카오페이지 랭킹 API 주소를 넣어주세요 (.env.example 참고)."
    );
  }

  const json = await fetchJson(apiUrl, {
    headers: {
      Referer: LANDING_URL,
      Origin: "https://page.kakao.com",
    },
  });

  const list = json?.result?.list;
  if (!Array.isArray(list)) {
    throw new Error(
      "카카오페이지 응답 구조가 예상과 다릅니다 (result.list를 찾을 수 없음). " +
        "API 응답 형식이 바뀌었을 수 있으니 KAKAO_RANKING_API_URL을 다시 캡처해 확인해주세요."
    );
  }

  const rows = list
    .map((item) => {
      const seriesId = item?.series_id;
      const title = item?.title ?? "";
      const url = seriesId
        ? `https://page.kakao.com/content/${seriesId}`
        : "";

      return {
        platform: "카카오페이지",
        rank: Number(item?.service_property?.rank),
        title,
        author: item?.authors ?? "",
        launchDate:
          typeof item?.start_sale_dt === "string" ? item.start_sale_dt.slice(0, 10) : "",
        metricType: "뷰수",
        metricValue: formatNumber(item?.service_property?.view_count),
        keywords: "", // 랭킹 API 응답에 태그가 없다면 빈 값. 필요 시 작품 상세 API 추가 연동 필요.
        url,
      };
    })
    .filter((row) => Number.isFinite(row.rank) && row.rank >= 1 && row.rank <= 15)
    .sort((a, b) => a.rank - b.rank);

  if (!rows.length) {
    throw new Error("카카오페이지: 1~15위 데이터를 찾지 못했습니다. 응답 구조를 확인해주세요.");
  }

  return rows;
}

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value ?? "");
}
