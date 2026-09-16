const { chromium } = require('playwright');
const fs = require('fs');

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

// Telegram 纯文本通知工具
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    console.log('📢 TG 文本通知已发送！');
  } catch (err) {
    console.error('❌ TG 通知发送失败:', err.message);
  }
}

// 🛡️ 扫除干扰弹窗（重点清理 "Maybe later" 社区弹窗与 Cookie 提示）
async function forceDismissPopups(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    // 强制清理各类干扰弹窗按钮
    const allEls = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
    const targetTexts = ['maybe later', 'i need help', 'accept all', 'accept', 'close', 'dismiss'];
    
    allEls.forEach(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (targetTexts.includes(txt)) {
        el.click();
      }
    });

    // 移除“Got an idea to make FreeMCHost better”横幅
    const allNodes = Array.from(document.querySelectorAll('*'));
    const ideaHeader = allNodes.find(el => el.textContent && el.textContent.includes('Got an idea to make FreeMCHost better'));
    if (ideaHeader) {
      let container = ideaHeader;
      for (let i = 0; i < 5; i++) {
        if (container.parentElement && container.parentElement !== document.body) {
          container = container.parentElement;
        }
      }
      if (container && container !== document.body) {
        container.remove();
      }
    }
  });
  await page.waitForTimeout(1000);
}

(async () => {
  const email = process.env.FREE_EMAIL;
  const password = process.env.FREE_PASSWORD;
  const serverPageUrl = process.env.SERVER_PAGE_URL;
  const proxyUrl = process.env.PROXY_URL;
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChatId = process.env.TG_CHAT_ID;

  console.log('🚀 正在启动伪装浏览器...');

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ]
  };

  if (proxyUrl) {
    console.log(`🌐 正在初始化代理网络: ${proxyUrl}`);
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US'
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    console.log('🚀 打开 Freemchost 登录页面...');
    await page.goto('https://freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 });

    console.log('📝 输入账号密码...');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);

    console.log('🔐 尝试登录...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
      page.click('button[type="submit"]')
    ]);

    console.log('✅ 登录成功！当前 URL:', page.url());

    // 1. 直达或进入服务器详情页
    if (serverPageUrl) {
      console.log('📂 直接访问服务器详情页:', serverPageUrl);
      await page.goto(serverPageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    } else {
      console.log('📂 访问服务列表主页...');
      await page.goto('https://freemchost.com/app', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      await forceDismissPopups(page);

      const firstServerLink = page.locator('a[href*="/app/servers/"]').first();
      if (await firstServerLink.count() > 0) {
        await firstServerLink.click();
      }
    }

    await page.waitForTimeout(4000);

    // 2. 粉碎 "Join the FreeMCHost community" 弹窗并点击 [PLAN Billing]
    console.log('🛡️ 优先清理页面遮罩与弹窗...');
    await forceDismissPopups(page);

    console.log('📌 点击切换至顶部 [PLAN Billing] 选项卡...');
    let billingClicked = false;
    for (let i = 0; i < 5; i++) {
      await forceDismissPopups(page);
      billingClicked = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        const target = allEls.find(el => {
          if (el.closest('aside') || el.closest('nav')) return false; // 排除侧边栏
          const txt = (el.textContent || '').trim();
          return txt.includes('Billing') && (txt.includes('PLAN') || txt === 'Billing') && txt.length < 50;
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (billingClicked) {
        console.log('✅ 成功点击 PLAN Billing 选项卡！');
        break;
      }
      await page.waitForTimeout(1500);
    }

    if (!billingClicked) {
      console.log('⚠️ 尝试使用 Playwright Locator 强制点击 Billing...');
      const billingTab = page.locator('main').locator('text=/Billing/i').first();
      await billingTab.click({ force: true });
    }

    await page.waitForTimeout(3000);

    // 3. 点击红色的 [Renew now] 按钮
    console.log('🔄 正在寻找并点击红色 [Renew now] 按钮...');
    await forceDismissPopups(page);

    let renewClicked = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      renewClicked = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
        const target = allBtns.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'renew now');
        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (renewClicked) {
        console.log('👉 已成功点击 [Renew now] 按钮！');
        break;
      }
      await page.waitForTimeout(2000);
    }

    if (!renewClicked) {
      throw new Error('未能在页面找到 [Renew now] 按钮，请确认是否已成功进入 PLAN Billing 页面。');
    }

    // 4. 等待续期弹窗并点击 [60 hours] 选项
    console.log('📋 正在等待弹窗并选择 [60 hours] 选项...');
    await page.waitForTimeout(2000);

    const hours60Option = page.locator('text=/60 hours/i').first();
    await hours60Option.waitFor({ state: 'visible', timeout: 10000 });
    await hours60Option.click({ force: true });
    console.log('👉 成功点击选择 [60 hours] 选项！');

    // 5. 等待页面响应并保存本地截图
    await page.waitForTimeout(5000);
    const successPath = 'screenshots/renew_success.png';
    await page.screenshot({ path: successPath, fullPage: true });

    const successMsg = '🎉 Freemchost 服务器自动续期流程已顺利执行完毕！截图已保存至仓库构建产物。';
    console.log('✅ ' + successMsg);
    await sendTelegramMessage(tgToken, tgChatId, successMsg);

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    const errorPath = 'screenshots/renew_error.png';
    await page.screenshot({ path: errorPath, fullPage: true });
    await sendTelegramMessage(tgToken, tgChatId, `⚠️ Freemchost 续期失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
