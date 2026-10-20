// 일부 사이트(리디북스)가 Node의 fetch 요청을 HTTP 403으로 막기 때문에, 실제 Chromium
// 브라우저(Playwright)로 페이지를 열어서 HTML을 가져오는 보조 모듈이다.
// playwright가 설치되어 있지 않으면 code: "BROWSER_UNAVAILABLE" 오류를 던지고,
// 호출하는 쪽에서 일반 fetch로 되돌아가도록 한다.

let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      let chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch (err) {
        const e = new Error(
          "playwright가 설치되어 있지 않습니다 (npm install 후 npx playwright install chromium 필요)"
        );
        e.code = "BROWSER_UNAVAILABLE";
        throw e;
      }
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
      } catch (err) {
        const e = new Error(`브라우저를 실행하지 못했습니다: ${err.message.split("\n")[0]}`);
        e.code = "BROWSER_UNAVAILABLE";
        throw e;
      }
      const context = await browser.newContext({
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        viewport: { width: 1366, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });
      return { browser, context };
    })();
    // 실패한 시도를 캐시해두면 이후 호출이 계속 같은 오류만 반복하므로 그대로 둔다(1회만 시도).
  }
  return sessionPromise;
}

export async function fetchHtmlViaBrowser(url) {
  const { context } = await getSession();
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!res) throw new Error(`브라우저 응답 없음 - ${url}`);
    if (res.status() >= 400) {
      throw new Error(`HTTP ${res.status()} ${res.statusText()} (브라우저) - ${url}`);
    }
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!sessionPromise) return;
  try {
    const { browser } = await sessionPromise;
    await browser.close();
  } catch {
    // 브라우저가 애초에 안 떠 있었으면 닫을 것도 없다
  }
}
