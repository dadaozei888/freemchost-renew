const { chromium } = require('playwright');
const fs = require('fs');

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

// Telegram 发送文字通知
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    console.log('📢 TG 文字通知已发送！');
  } catch (err) {
    console.error('❌ TG 通知发送失败:', err.message);
  }
}

// Telegram 发送图片通知
async function sendTelegramPhoto(botToken, chatId, imagePath, caption) {
  if (!botToken || !chatId || !fs.existsSync(imagePath)) return;
  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);
    
    const fileBuffer = fs.readFileSync(imagePath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    formData.append('photo', blob, 'screenshot.png');

    const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    await fetch(url, {
      method: 'POST',
      body: formData
    });
    console.log('📸 TG 截图已成功推送至 Telegram！');
  } catch (err) {
    console.error('❌ TG 截图发送失败:', err.message);
  }
}

// 🛡️ 扫除干扰弹窗与 Cookie 提示
async function forceDismissPopups(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

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
  await page.waitForTimeout(500);
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
      console.log('📂 访问服务器详情页:', serverPageUrl);
      await page.goto(serverPageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    } else {
      console.log('📂 访问服务列表主页...');
      await page.goto('https://freemchost.com/app', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      await forceDismissPopups(page);
      const firstServerLink = page.locator('a[href*="/app/servers/"]').first();
      await firstServerLink.click();
    }

    await page.waitForTimeout(3000);
    await forceDismissPopups(page);

    // 2. 精准点击顶部 [PLAN Billing] 选项卡
    console.log('📌 正在点击顶部 [PLAN Billing] 选项卡...');
    
    const clickedBilling = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));
      const billingTab = allEls.find(el => {
        const text = (el.textContent || '').trim();
        return text.includes('Billing') && text.includes('PLAN') && text.length < 50;
      });
      if (billingTab) {
        billingTab.click();
        return true;
      }
      return false;
    });

    if (!clickedBilling) {
      console.log('⚠️ evaluate 点击未成功，尝试 Locator 点击...');
      const billingTabLocator = page.locator('text=Billing').filter({ hasText: 'PLAN' }).first();
      await billingTabLocator.click({ force: true });
    }

    // 等待 Billing 页面加载完成
    await page.waitForTimeout(3000);
    await forceDismissPopups(page);

    // 3. 寻找并点击红色的 [Renew now] 按钮
    console.log('🔄 寻找并点击 [Renew now] 按钮...');
    const renewBtn = page.locator('button, a, div[role="button"]').filter({ hasText: /^Renew now$/i }).first();
    await renewBtn.waitFor({ state: 'visible', timeout: 15000 });
    await renewBtn.click({ force: true });
    console.log('👉 已成功点击 [Renew now]！');

    // 4. 等待弹窗并选择 [60 hours] 选项
    console.log('📋 正在等待弹窗并选择 [60 hours] 选项...');
    await page.waitForTimeout(2000);

    const option60h = page.locator('text=/60 hours/i').first();
    await option60h.waitFor({ state: 'visible', timeout: 10000 });

    await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));
      const targetText = allEls.find(el => el.children.length === 0 && el.textContent.trim().toLowerCase().includes('60 hours'));
      if (targetText) {
        let p = targetText;
        for (let i = 0; i < 5; i++) {
          if (p.parentElement && p.parentElement !== document.body) {
            p = p.parentElement;
            if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || p.onclick || (p.className && typeof p.className === 'string' && p.className.includes('border'))) {
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
    console.log('👉 已成功点击 [60 hours] 选项！');

    // 5. 完成并保存截图推送 TG
    await page.waitForTimeout(5000);
    const screenshotPath = 'screenshots/renew_success.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const successMsg = '🎉 Freemchost 服务器已成功点击 60小时 续期！';
    console.log('✅ ' + successMsg);
    await sendTelegramPhoto(tgToken, tgChatId, screenshotPath, successMsg);

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    const errorPath = 'screenshots/renew_error.png';
    await page.screenshot({ path: errorPath, fullPage: true });
    await sendTelegramPhoto(tgToken, tgChatId, errorPath, `⚠️ Freemchost 续期失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
