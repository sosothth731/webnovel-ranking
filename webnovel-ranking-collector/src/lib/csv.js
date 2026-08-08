import { mkdir, writeFile, readFile, access } from "node:fs/promises";
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

/**
 * 우리가 직접 쓴 CSV(쉼표 구분, 따옴표로 이스케이프)를 다시 배열의 배열로 읽어들인다.
 * 첫 번째 요소는 헤더 행이다.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const clean = text.replace(/^\ufeff/, "");

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // \n에서 처리하므로 건너뜀
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
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
 * rows를 output/webnovel_ranking.csv 에 저장합니다.
 * 같은 날짜(확인날짜)의 기존 데이터가 이미 있으면 통째로 지우고 새로 씁니다 —
 * 같은 날 워크플로우를 두 번 이상 돌려도(예: 버그 수정 후 재실행) 옛날 데이터와
 * 새 데이터가 섞이지 않고, 항상 그날의 "가장 마지막 실행 결과"만 남습니다.
 * 다른 날짜의 기존 데이터는 그대로 유지됩니다.
 */
export async function appendRowsToCsv(rows, outputDir = "output") {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "webnovel_ranking.csv");
  const collectedDate = todayKoreaDate();

  let keptLines = [];
  if (await fileExists(filePath)) {
    const raw = await readFile(filePath, "utf8");
    const records = parseCsv(raw);
    const dataRecords = records.slice(1); // 헤더 행 제외
    keptLines = dataRecords
      .filter((r) => r[0] !== collectedDate) // 오늘 날짜 기존 데이터는 제거
      .map((r) => r.map(csvEscape).join(","));
  }

  const newLines = rows.map((row) => rowToCsvLine(row, collectedDate));
  const allLines = [...keptLines, ...newLines];

  const bom = "\ufeff";
  const body = allLines.length ? allLines.join("\r\n") + "\r\n" : "";
  await writeFile(filePath, bom + HEADER.join(",") + "\r\n" + body, "utf8");

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
