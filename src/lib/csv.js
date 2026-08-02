import { mkdir, appendFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const HEADER = [
  "확인날짜",
  "플랫폼",
  "순위",
  "작품명",
  "작가명",
  "론칭일",
  "지표종류",
  "지표값",
  "키워드",
  "URL",
];

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function rowToCsvLine(row, collectedDate) {
  return [
    collectedDate,
    row.platform,
    row.rank,
    row.title,
    row.author,
    row.launchDate,
    row.metricType,
    row.metricValue,
    row.keywords,
    row.url,
  ]
    .map(csvEscape)
    .join(",");
}

function todayKoreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * rows를 output/webnovel_ranking.csv 에 누적 저장(append)합니다.
 * 파일이 없으면 헤더를 먼저 씁니다.
 * 매일 실행해도 계속 같은 파일에 쌓이므로, 시간에 따른 순위 변화 추적이 가능합니다.
 */
export async function appendRowsToCsv(rows, outputDir = "output") {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "webnovel_ranking.csv");
  const collectedDate = todayKoreaDate();

  const exists = await fileExists(filePath);
  const lines = rows.map((row) => rowToCsvLine(row, collectedDate));

  if (!exists) {
    const bom = "\ufeff";
    await writeFile(filePath, bom + HEADER.join(",") + "\r\n" + lines.join("\r\n") + "\r\n", "utf8");
  } else {
    await appendFile(filePath, lines.join("\r\n") + "\r\n", "utf8");
  }

  return { filePath, collectedDate, count: rows.length };
}

/**
 * 오늘 날짜 전용 스냅샷 CSV도 별도로 저장합니다 (output/daily/YYYY-MM-DD.csv).
 * 특정 날짜만 따로 열어보고 싶을 때 편리합니다.
 */
export async function writeDailySnapshotCsv(rows, outputDir = "output") {
  const collectedDate = todayKoreaDate();
  const dailyDir = path.join(outputDir, "daily");
  await mkdir(dailyDir, { recursive: true });
  const filePath = path.join(dailyDir, `${collectedDate}.csv`);

  const bom = "\ufeff";
  const lines = rows.map((row) => rowToCsvLine(row, collectedDate));
  await writeFile(filePath, bom + HEADER.join(",") + "\r\n" + lines.join("\r\n") + "\r\n", "utf8");

  return filePath;
}
