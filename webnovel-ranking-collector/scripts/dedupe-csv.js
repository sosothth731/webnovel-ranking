import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../src/lib/csv.js";

/**
 * 이미 중복/꼬인 상태로 쌓인 output/webnovel_ranking.csv를 한 번만 정리하는 스크립트.
 *
 * 같은 (확인날짜, 플랫폼, 순위) 조합이 여러 번 나오면 — 예전에 워크플로우를
 * 하루에 두 번 이상 돌렸을 때 생긴 경우 — 파일에서 "가장 나중에 등장하는 행"만 남기고
 * 나머지는 지운다. 나중에 등장하는 행 = 더 나중에 실행된 결과이므로, 보통 버그
 * 수정 이후의 올바른 데이터가 남게 된다.
 *
 * 실행: node scripts/dedupe-csv.js
 */
async function main() {
  const filePath = path.join("output", "webnovel_ranking.csv");
  const raw = await readFile(filePath, "utf8");
  const records = parseCsv(raw);
  const header = records[0];
  const dataRows = records.slice(1);

  const byKey = new Map();
  let order = 0;
  for (const row of dataRows) {
    const key = `${row[0]}|${row[1]}|${row[2]}`; // 확인날짜|플랫폼|순위
    byKey.set(key, { row, order: order++ }); // 같은 키면 나중 것으로 덮어씀 = 마지막 등장만 남음
  }

  const deduped = [...byKey.values()]
    .sort((a, b) => a.order - b.order)
    .map((v) => v.row);

  const before = dataRows.length;
  const after = deduped.length;

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  const lines = deduped.map((row) => row.map(csvEscape).join(","));
  const bom = "\ufeff";
  const body = lines.length ? lines.join("\r\n") + "\r\n" : "";
  await writeFile(filePath, bom + header.map(csvEscape).join(",") + "\r\n" + body, "utf8");

  console.log(`정리 완료: ${before}행 → ${after}행 (중복 ${before - after}행 제거)`);
}

main().catch((err) => {
  console.error("정리 실패:", err.message);
  process.exitCode = 1;
});
