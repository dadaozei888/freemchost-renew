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

// 💥 彻底摧毁所有遮罩与“Got an idea”弹窗 DOM
async function destroyAllModals(page) {
  console.log('🛡️ 正在彻底粉碎所有页面遮罩与反馈弹窗...');
  await page.keyboard.press('Escape');
  
  await page.evaluate(() => {
    // 1. 查找包含 "Got an idea" 或 "Maybe later" 的固定定位容器并直接移除
    const allEls = Array.from(document.querySelectorAll('div, section, dialog'));
    allEls.forEach(el => {
      const txt = (el.textContent || '').toLowerCase();
      if (txt.includes('got an idea') || txt.includes('maybe later')) {
        let parent = el;
        for (let i = 0; i < 6; i++) {
          if (parent.parentElement && parent.parentElement !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.position === 'fixed' || style.position === 'absolute' || parent.getAttribute('role') === 'dialog') {
              parent.remove();
              return;
            }
            parent = parent.parentElement;
          }
        }
        el.remove();
      }
    });

    // 2. 移除所有全屏半透明遮罩背景
    const backdrops = document.querySelectorAll('[class*="backdrop"], [class*="overlay"], div[class*="fixed"][class*="inset-0"]');
    backdrops.forEach(b => b.remove());
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

    // 1. 直达服务器详情页
    if (serverPageUrl) {
      console.log('📂 直接访问服务器详情页:', serverPageUrl);
      await page.goto(serverPageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    } else {
      console.log('📂 访问服务列表主页...');
      await page.goto('https://freemchost.com/app', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      const firstServerLink = page.locator('a[href*="/app/servers/"]').first();
      if (await firstServerLink.count() > 0) {
        await firstServerLink.click();
      }
    }

    await page.waitForTimeout(4000);
    await destroyAllModals(page);

    // 2. 强行点击顶部 [PLAN Billing] 选项卡并验证成功
    console.log('📌 正在点击切换至顶部 [PLAN Billing] 选项卡...');
    let billingClicked = false;
    for (let i = 0; i < 5; i++) {
      await destroyAllModals(page);
      
      billingClicked = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        // 查找包含 Billing 和 PLAN 关键字的顶部卡片
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

      await page.waitForTimeout(2000);

      // 验证页面是否已经包含 "Plan & lifecycle" 或 "CURRENT PLAN"
      const onBillingPage = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Plan & lifecycle') || text.includes('CURRENT PLAN');
      });

      if (onBillingPage) {
        console.log('✅ 确认已成功切入 PLAN Billing 页面！');
        billingClicked = true;
        break;
      }
    }

    if (!billingClicked) {
      throw new Error('无法切入 PLAN Billing 页面，请检查页面结构或遮罩拦截。');
    }

    // 3. 寻找并点击红色 [Renew now] 按钮
    console.log('🔄 正在寻找并点击红色 [Renew now] 按钮...');
    let renewClicked = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await destroyAllModals(page);
      
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
      throw new Error('未能在 PLAN Billing 页面找到 [Renew now] 按钮。');
    }

    // 4. 等待续期弹窗，点击 60 hours / 48 hours 选项
    console.log('📋 正在等待 60/48 小时续期弹窗...');
    await page.waitForTimeout(3000);

    let clickAttempted = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));
      const targetText = allEls.find(el => {
        if (el.children.length !== 0) return false;
        const txt = el.textContent.trim().toLowerCase();
        return txt.includes('60 hours') || txt.includes('48 hours');
      });

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

    await page.waitForTimeout(4000);

    // 判断弹窗是否依然存在（未到 46 小时时点击无效，弹窗不会关闭）
    const isModalStillOpen = await page.evaluate(() => {
      return document.body.innerText.includes('Keep your server online');
    });

    const screenshotPath = 'screenshots/renew_result.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (isModalStillOpen) {
      const notReadyMsg = '⏳ Freemchost 续期未成功：免费续期按钮尚未激活（需等待剩余时间小于 46 小时）。';
      console.log('⚠️ ' + notReadyMsg);
      await sendTelegramPhoto(tgToken, tgChatId, screenshotPath, notReadyMsg);
    } else {
      const successMsg = '🎉 Freemchost 服务器已成功完成免费续期！';
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
