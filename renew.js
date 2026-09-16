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
    await fetch(url, { method: 'POST', body: formData });
    console.log('📸 TG 截图已成功推送至 Telegram！');
  } catch (err) {
    console.error('❌ TG 截图发送失败:', err.message);
  }
}

// 🧹 专属前置清理：在点击 Renew now 之前，强行打碎所有挡路的 Modal 弹窗和黑屏遮罩
async function nukeAllNoiseBeforeRenew(page) {
  console.log('🧹 [Renew 前置清理] 正在移除阻挡 Renew 按钮的所有干扰弹窗与遮罩...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    // 恢复页面点击与滚动
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';

    const allEls = Array.from(document.querySelectorAll('*'));
    allEls.forEach(el => {
      if (['BODY', 'HTML'].includes(el.tagName) || ['root', '__next', 'app'].includes(el.id)) return;

      const style = window.getComputedStyle(el);
      const isFixed = style.position === 'fixed';
      const isAbsolute = style.position === 'absolute';
      const zIndex = parseInt(style.zIndex, 10) || 0;
      const isDialog = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';

      const txt = (el.innerText || '').toLowerCase();
      // 如果已经是续费弹窗则保留（点击 Renew 按钮前一般不会存在）
      if (txt.includes('keep your server online') || txt.includes('select renewal duration')) {
        return;
      }

      // 将所有固定定位或 z-index 高于常态的弹窗/遮罩彻底 remove 掉
      if (isDialog || (isFixed && zIndex > 5) || (isAbsolute && zIndex > 50)) {
        const rect = el.getBoundingClientRect();
        if (isDialog || rect.width > 100 || rect.height > 100) {
          el.remove();
        }
      }
    });
  });
  await page.waitForTimeout(300);
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

    // 1. 直达服务器页面
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log(`📂 访问服务器目标页面: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // 等待网页加载并清除初次弹窗
    await page.waitForTimeout(3000);
    await nukeAllNoiseBeforeRenew(page);

    // 2. 切入顶部 [PLAN / Billing]
    console.log('📌 点击切换至顶部 [PLAN / Billing] 选项卡...');
    let billingClicked = false;
    for (let i = 0; i < 5; i++) {
      billingClicked = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        const target = allEls.find(el => {
          if (el.closest('aside') || el.closest('nav') || el.closest('[class*="sidebar"]')) return false;
          const txt = (el.textContent || '').trim();
          return txt.includes('Billing') && (txt.includes('PLAN') || txt.length < 30);
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (billingClicked) {
        console.log('✅ 成功点击 PLAN / Billing 选项卡！');
        break;
      }
      await nukeAllNoiseBeforeRenew(page);
      await page.waitForTimeout(1500);
    }

    if (!billingClicked) {
      throw new Error('未找到 [PLAN Billing] 选项卡');
    }

    // 关键步骤：点击 Billing 后，等待 3.5 秒让 Discord 等后置弹窗充分弹出来，然后再统一粉碎掉！
    console.log('⏳ 等待 Billing 页面加载及 Discord 等后置弹窗弹出...');
    await page.waitForTimeout(3500);
    await nukeAllNoiseBeforeRenew(page);

    // 3. 点击红色 [Renew now] 按钮
    console.log('🔄 寻找并点击红色 [Renew now] 按钮...');
    let renewClicked = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      renewClicked = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
        const target = allBtns.find(b => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return txt.includes('renew now');
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (renewClicked) {
        console.log('👉 成功点击红色 [Renew now] 按钮！');
        break;
      }
      // 如果还没找到，可能还有残留遮罩，再扫一次
      await nukeAllNoiseBeforeRenew(page);
      await page.waitForTimeout(1500);
    }

    if (!renewClicked) {
      throw new Error('未找到 [Renew now] 按钮');
    }

    // ⛔⚠️ 核心逻辑分水岭：点击完 Renew now 后，绝对不再调用任何清屏函数！
    console.log('⏳ 等待正牌续费弹窗（Keep your server online）弹出...');
    await page.waitForTimeout(3500);

    // 4. 选择 60 hours / 48 hours 免费卡片
    console.log('📋 在续费弹窗中寻找 60 hours 免费选项...');
    const cardClicked = await page.evaluate(() => {
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

    if (cardClicked) {
      console.log('👉 已成功点击 60 hours 免费续费卡片！');
    } else {
      console.log('⚠️ 未在弹窗中锁定到 60 hours 卡片，可能按钮尚未解锁或已自动选定。');
    }

    await page.waitForTimeout(4000);

    // 5. 判断最终续费状态并发送 TG 通知
    const isModalStillOpen = await page.evaluate(() => {
      return document.body.innerText.includes('Keep your server online');
    });

    const screenshotPath = 'screenshots/renew_result.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (isModalStillOpen) {
      const notReadyMsg = '⏳ Freemchost 尝试续期：免费续期按钮尚未激活（需要等剩余时间小于 46 小时）。';
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
