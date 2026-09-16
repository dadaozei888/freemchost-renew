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

// 💥 [底层击穿引擎] 多重物理/事件强力点击
async function penetrateClick(page, searchText, excludeSidebar = false) {
  console.log(`⚡ [击穿模式] 正在定位并强制点击: "${searchText}"`);

  // 1. 获取物理坐标并使用浏览器底层鼠标点击 (最推荐，直接无视前端遮罩)
  try {
    const coords = await page.evaluate(({ text, noSidebar }) => {
      const all = Array.from(document.querySelectorAll('*'));
      const found = all.find(el => {
        if (el.children.length !== 0) return false;
        if (!el.textContent.trim().toLowerCase().includes(text.toLowerCase())) return false;
        if (noSidebar && (el.closest('aside') || el.closest('nav'))) return false;
        return true;
      });

      if (found) {
        const rect = found.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    }, { text: searchText, noSidebar: excludeSidebar });

    if (coords && coords.x > 0 && coords.y > 0) {
      await page.mouse.click(coords.x, coords.y);
      console.log(`  └─ 🎯 物理坐标击穿成功！位置: (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
      return true;
    }
  } catch (e) {
    console.log(`  └─ 物理坐标获取失败: ${e.message}`);
  }

  // 2. Playwright 物理级强力点击 (force: true 直接穿透所有遮罩层)
  try {
    const locator = page.locator(`text=/${searchText}/i`).last();
    if (await locator.count() > 0) {
      await locator.click({ force: true, timeout: 3000 });
      console.log(`  └─ 🎯 Playwright force:true 强力击穿成功！`);
      return true;
    }
  } catch (e) {}

  // 3. React / DOM 合成全链路事件强派 (pointerdown -> mousedown -> pointerup -> mouseup -> click)
  try {
    const dispatched = await page.evaluate(({ text, noSidebar }) => {
      const all = Array.from(document.querySelectorAll('*'));
      const found = all.find(el => {
        if (el.children.length !== 0) return false;
        if (!el.textContent.trim().toLowerCase().includes(text.toLowerCase())) return false;
        if (noSidebar && (el.closest('aside') || el.closest('nav'))) return false;
        return true;
      });

      if (!found) return false;

      let curr = found;
      for (let i = 0; i < 4; i++) {
        if (!curr) break;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
          curr.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
        });
        curr = curr.parentElement;
      }
      return true;
    }, { text: searchText, noSidebar: excludeSidebar });

    if (dispatched) {
      console.log(`  └─ 🎯 DOM 全链路合成事件击穿成功！`);
      return true;
    }
  } catch (e) {}

  return false;
}

(async () => {
  const email = process.env.FREE_EMAIL;
  const password = process.env.FREE_PASSWORD;
  const serverPageUrl = process.env.SERVER_PAGE_URL;
  const proxyUrl = process.env.PROXY_URL;
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChatId = process.env.TG_CHAT_ID;

  console.log('🚀 启动伪装浏览器 [底层击穿模式]...');

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
    console.log(`🌐 初始化代理网络: ${proxyUrl}`);
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

    console.log('✅ 登录成功！');

    // 直达或进入服务器详情页
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log('📂 访问目标页面:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);

    // 1. 底层击穿点击：切换至顶部 [Billing] 选项卡 (排除侧边栏)
    console.log('📌 执行 [Billing] 选项卡击穿点击...');
    let billingSuccess = false;
    for (let i = 0; i < 3; i++) {
      billingSuccess = await penetrateClick(page, 'Billing', true);
      if (billingSuccess) break;
      await page.waitForTimeout(2000);
    }

    if (!billingSuccess) {
      throw new Error('无法击穿点击 [Billing] 选项卡');
    }

    await page.waitForTimeout(3000);

    // 2. 底层击穿点击：[Renew now] 按钮
    console.log('🔄 执行 [Renew now] 按钮击穿点击...');
    let renewSuccess = false;
    for (let i = 0; i < 3; i++) {
      renewSuccess = await penetrateClick(page, 'Renew now');
      if (renewSuccess) break;
      await page.waitForTimeout(2000);
    }

    if (!renewSuccess) {
      throw new Error('未找到或无法点击 [Renew now] 按钮');
    }

    await page.waitForTimeout(3000);

    // 3. 底层击穿点击：[60 hours] / [48 hours] 选项
    console.log('📋 执行 [60 hours / 48 hours] 选项击穿点击...');
    let optionSuccess = await penetrateClick(page, '60 hours');
    if (!optionSuccess) {
      optionSuccess = await penetrateClick(page, '48 hours');
    }

    await page.waitForTimeout(4000);

    // 验证续期弹窗状态
    const isModalStillOpen = await page.evaluate(() => {
      return document.body.innerText.includes('Keep your server online');
    });

    const screenshotPath = 'screenshots/renew_result.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (isModalStillOpen) {
      const notReadyMsg = '⏳ Freemchost 执行完成：免费续期按钮尚未激活（需等待剩余时间小于 46 小时）。';
      console.log('⚠️ ' + notReadyMsg);
      await sendTelegramPhoto(tgToken, tgChatId, screenshotPath, notReadyMsg);
    } else {
      const successMsg = '🎉 Freemchost 服务器已成功击穿并完成免费续期！';
      console.log('✅ ' + successMsg);
      await sendTelegramPhoto(tgToken, tgChatId, screenshotPath, successMsg);
    }

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    const errorPath = 'screenshots/renew_error.png';
    await page.screenshot({ path: errorPath, fullPage: true });
    await sendTelegramPhoto(tgToken, tgChatId, errorPath, `⚠️ Freemchost 执行失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
