import { readFile } from "node:fs/promises";
import { extractLaunchDateFromInlineScript } from "../src/scrapers/ridibooks.js";

const html = await readFile(new URL("./sample_ridi_detail.html", import.meta.url), "utf8");
const result = extractLaunchDateFromInlineScript(html);

console.log("추출된 론칭일:", result);
console.log("기대값: 2026-08-07");
console.log(result === "2026-08-07" ? "✅ PASS" : "❌ FAIL");
