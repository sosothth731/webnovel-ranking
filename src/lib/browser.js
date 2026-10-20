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
        // GitHub의 ubuntu 서버에는 일반 Google Chrome이 깔려 있다. 테스트용 번들 Chromium보다
        // 실제 사용자 브라우저에 가까우므로 먼저 시도하고, 없으면 번들 Chromium으로 되돌아간다.
        try {
          browser = await chromium.launch({ channel: "chrome", headless: true });
        } catch {
          browser = await chromium.launch({ headless: true });
        }
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

/**
 * 받은 페이지가 "정상 페이지"가 아니라 접속 확인/차단 안내 페이지로 보이는지 판단한다.
 * (사이트 보안 장치는 이런 확인 페이지를 403/503으로 먼저 내려주고, 실제 브라우저가 그
 *  확인을 마치면 진짜 페이지로 넘어가는 경우가 있다.)
 */
export function looksBlocked(status, title, html) {
  const t = title || "";
  if (/just a moment|attention required|access denied|잠시만 기다리|접근이 거부|접근 제한/i.test(t)) {
    return true;
  }
  return status >= 400 && (html || "").length < 5000;
}

export async function fetchHtmlViaBrowser(url) {
  const { context } = await getSession();
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!res) throw new Error(`브라우저 응답 없음 - ${url}`);

    const firstStatus = res.status();
    const headers = res.headers();
    let title = await page.title().catch(() => "");
    let html = await page.content();

    if (looksBlocked(firstStatus, title, html)) {
      // 확인 페이지라면 브라우저가 스스로 통과하고 넘어갈 시간을 최대 20초 준다.
      await page
        .waitForFunction(
          () => !/just a moment|attention required|access denied|잠시만 기다리|접근이 거부|접근 제한/i.test(document.title),
          null,
          { timeout: 20000 }
        )
        .catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      title = await page.title().catch(() => "");
      html = await page.content();
    }

    if (looksBlocked(firstStatus >= 400 ? firstStatus : 200, title, html)) {
      // 어떤 장치가 막는지 알 수 있도록 응답 정보를 오류 메시지에 남긴다.
      const diag = [
        headers["server"] && `server=${headers["server"]}`,
        headers["cf-ray"] && `cf-ray=${headers["cf-ray"]}`,
        headers["cf-mitigated"] && `cf-mitigated=${headers["cf-mitigated"]}`,
        title && `title="${title.slice(0, 40)}"`,
      ].filter(Boolean).join(" ");
      throw new Error(`HTTP ${firstStatus} (브라우저) ${diag} - ${url}`);
    }
    return html;
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
