const { chromium } = require('playwright');
const fs = require('fs');

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

// Telegram 通知工具
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    console.log('📢 TG 通知已发送！');
  } catch (err) {
    console.error('❌ TG 通知发送失败:', err.message);
  }
}

// 🛡️ 扫除干扰弹窗与 Cookie 提示
async function forceDismissPopups(page) {
  console.log('🛡️ 正在执行 DOM 级弹窗粉碎策略...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const targets = allEls.filter(el => 
      el.children.length === 0 && 
      ['maybe later', 'i need help', 'accept all', 'accept'].includes(el.textContent.trim().toLowerCase())
    );
    targets.forEach(el => el.click());

    const ideaHeader = allEls.find(el => el.textContent && el.textContent.includes('Got an idea to make FreeMCHost better'));
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
    console.log('🚀 正在打开 Freemchost 登录页面...');
    await page.goto('https://freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 });

    console.log('📝 正在输入账号密码...');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);

    console.log('🔐 正在尝试登录...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
      page.click('button[type="submit"]')
    ]);

    console.log('✅ 登录成功！当前 URL:', page.url());

    // 1. 进入控制台主页，点击服务器卡片进入详情
    console.log('📂 正在访问服务列表主页: https://freemchost.com/app');
    await page.goto('https://freemchost.com/app', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await forceDismissPopups(page);

    console.log('🔍 正在定位服务器卡片...');
    let cardClicked = false;
    
    let targetUuid = '';
    if (serverPageUrl && serverPageUrl.includes('/servers/')) {
      targetUuid = serverPageUrl.split('/servers/')[1].trim();
    }

    if (targetUuid) {
      const specificLink = page.locator(`a[href*="${targetUuid}"]`).first();
      if (await specificLink.count() > 0) {
        console.log(`👉 找到指定 UUID [${targetUuid}] 卡片，正在点击进入...`);
        await specificLink.click();
        cardClicked = true;
      }
    }

    if (!cardClicked) {
      console.log('👉 点击列表中的第一个服务器卡片...');
      const firstServerLink = page.locator('a[href*="/app/servers/"]').first();
      if (await firstServerLink.count() > 0) {
        await firstServerLink.click();
        cardClicked = true;
      }
    }

    if (!cardClicked && serverPageUrl) {
      console.log('⚠️ 未找到卡片，使用直达 URL 进入详情页:', serverPageUrl);
      await page.goto(serverPageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    }

    console.log('📍 实际到达页面 URL:', page.url());
    await page.waitForTimeout(4000);
    await forceDismissPopups(page);

    // 2. 点击顶部 [PLAN / Billing] 选项卡
    console.log('📌 正在点击切换至顶部 [PLAN / Billing] 选项卡...');
    let billingClicked = false;
    for (let i = 0; i < 5; i++) {
      await forceDismissPopups(page);
      billingClicked = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        // 寻找包含 Billing 且包含 PLAN 的顶部选项卡元素
        const target = allEls.find(el => {
          const txt = (el.textContent || '').trim();
          return txt.includes('Billing') && txt.includes('PLAN') && txt.length < 60;
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (billingClicked) {
        console.log('✅ 成功切入 Billing 面板！');
        break;
      }
      await page.waitForTimeout(2000);
    }

    if (!billingClicked) {
      console.log('⚠️ 尝试备用定位器点击 [PLAN Billing]...');
      const planBillingTab = page.locator('text=/PLAN/i').locator('..').filter({ hasText: /Billing/i }).first();
      if (await planBillingTab.count() > 0) {
        await planBillingTab.click({ force: true });
      }
    }

    await page.waitForTimeout(3000);

    // 3. 触发 [Renew now] 点击
    console.log('🔄 正在触发 [Renew now] 按钮点击...');
    let renewClicked = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await forceDismissPopups(page);
      
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
        console.log('👉 已成功触发 [Renew now] 点击！');
        break;
      }
      
      await page.waitForTimeout(2000);
    }

    if (!renewClicked) {
      throw new Error('未能在 Billing 页面找到 [Renew now] 按钮，页面可能未完全加载。');
    }

    // 4. 等待 48 hours 弹窗并点击
    console.log('📋 正在等待 48小时 续期弹窗...');
    await page.waitForTimeout(2000);

    let clicked48h = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      clicked48h = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        const targetText = allEls.find(el => 
          el.children.length === 0 && 
          el.textContent.trim().toLowerCase().includes('48 hours')
        );

        if (targetText) {
          let p = targetText;
          for (let i = 0; i < 5; i++) {
            if (p.parentElement && p.parentElement !== document.body) {
              p = p.parentElement;
              if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || p.onclick) {
                p.click();
                return true;
              }
            }
          }
          targetText.click();
          return true;
        }
        return false;
      });

      if (clicked48h) {
        console.log('👉 成功选择 [48 hours] 选项！');
        break;
      }
      await page.waitForTimeout(1500);
    }

    if (!clicked48h) {
      console.log('⚠️ 尝试使用 Locator 强制点击 [48 hours]...');
      const hours48Option = page.locator('text=/48 hours/i').first();
      await hours48Option.waitFor({ state: 'visible', timeout: 10000 });
      await hours48Option.click({ force: true });
    }

    // 5. 保存截图并发送 TG 通知
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/renew_success.png', fullPage: true });

    const successMsg = '🎉 Freemchost 服务器已成功点击 48小时 续期！';
    console.log('✅ ' + successMsg);
    await sendTelegramMessage(tgToken, tgChatId, successMsg);

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    await page.screenshot({ path: 'screenshots/renew_error.png', fullPage: true });
    await sendTelegramMessage(tgToken, tgChatId, `⚠️ Freemchost 续期失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
