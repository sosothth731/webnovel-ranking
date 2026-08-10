import "dotenv/config";
import { collectKakaoPage } from "./scrapers/kakaopage.js";
import { collectRidibooks } from "./scrapers/ridibooks.js";
import { collectNaverSeries } from "./scrapers/naverseries.js";
import { collectNaverDailyFreeNewRomance } from "./scrapers/naverseries-dailyfree-romance.js";
import {
  appendRowsToCsv,
  writeDailySnapshotCsv,
  appendRomanceRowsToCsv,
  writeRomanceDailySnapshotCsv,
} from "./lib/csv.js";

const PLATFORMS = [
  { name: "카카오페이지", run: collectKakaoPage },
  { name: "리디북스", run: collectRidibooks },
  { name: "네이버시리즈", run: collectNaverSeries },
];

async function main() {
  const allRows = [];
  const summary = [];

  for (const platform of PLATFORMS) {
    process.stdout.write(`\n[${platform.name}] 수집 시작...\n`);
    try {
      const rows = await platform.run();
      allRows.push(...rows);
      summary.push({ platform: platform.name, status: "성공", count: rows.length });
      process.stdout.write(`[${platform.name}] 완료: ${rows.length}건\n`);
    } catch (err) {
      summary.push({ platform: platform.name, status: "실패", error: err.message });
      console.error(`[${platform.name}] 실패: ${err.message}`);
    }
  }

  if (allRows.length) {
    const { filePath, collectedDate, count } = await appendRowsToCsv(allRows);
    const dailyPath = await writeDailySnapshotCsv(allRows);
    process.stdout.write(
      `\n총 ${count}건 저장 완료 (${collectedDate})\n- 누적 파일: ${filePath}\n- 오늘자 스냅샷: ${dailyPath}\n`
    );
  } else {
    process.stdout.write("\n저장할 데이터가 없습니다. 모든 플랫폼이 실패했습니다.\n");
  }

  // 네이버시리즈 "매일10시무료" 로맨스 신작 다운로드수/댓글수/별점 추이 별도 수집.
  // TOP15 랭킹과는 스키마가 달라서(별점·댓글수·다운로드수를 한 행에 같이 저장) 별도 CSV로 관리한다.
  process.stdout.write("\n[네이버시리즈-매일10시무료 로맨스 신작] 수집 시작...\n");
  try {
    const romanceRows = await collectNaverDailyFreeNewRomance();
    if (romanceRows.length) {
      const { filePath, collectedDate, count } = await appendRomanceRowsToCsv(romanceRows);
      const dailyPath = await writeRomanceDailySnapshotCsv(romanceRows);
      process.stdout.write(
        `[네이버시리즈-매일10시무료 로맨스 신작] 완료: ${count}건 (${collectedDate})\n- 누적 파일: ${filePath}\n- 오늘자 스냅샷: ${dailyPath}\n`
      );
      summary.push({ platform: "네이버시리즈-매일10시무료 로맨스 신작", status: "성공", count });
    } else {
      process.stdout.write("[네이버시리즈-매일10시무료 로맨스 신작] 완료: 오늘은 해당하는 작품이 없습니다.\n");
      summary.push({ platform: "네이버시리즈-매일10시무료 로맨스 신작", status: "성공", count: 0 });
    }
  } catch (err) {
    console.error(`[네이버시리즈-매일10시무료 로맨스 신작] 실패: ${err.message}`);
    summary.push({
      platform: "네이버시리즈-매일10시무료 로맨스 신작",
      status: "실패",
      error: err.message,
    });
  }

  process.stdout.write("\n===== 실행 요약 =====\n");
  for (const item of summary) {
    if (item.status === "성공") {
      process.stdout.write(`- ${item.platform}: 성공 (${item.count}건)\n`);
    } else {
      process.stdout.write(`- ${item.platform}: 실패 (${item.error})\n`);
    }
  }

  const failedCount = summary.filter((s) => s.status === "실패").length;
  if (failedCount > 0) {
    process.exitCode = 1; // 일부 실패 시 CI에서 알림/재시도를 걸 수 있도록 종료 코드로 표시
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exitCode = 1;
});
