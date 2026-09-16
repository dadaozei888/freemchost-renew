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

// 🛡️ 仅用于扫除进站/切页时的干扰弹窗（Feedback, Cookie, Community等）
async function clearInitialNoisePopups(page) {
  console.log('🧹 正在清理页面干扰弹窗（Feedback / Cookie / Community）...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';

    // 干扰弹窗特征词列表
    const noiseKeywords = [
      'how would you rate',
      'your feedback',
      'join the freemchost community',
      'we ask before we track you',
      'got an idea to make',
      'cookie policy'
    ];

    const allEls = Array.from(document.querySelectorAll('div, section, aside, dialog'));
    allEls.forEach(el => {
      const txt = (el.innerText || '').toLowerCase();
      
      // 绝不误删正牌续费弹窗
      if (txt.includes('keep your server online') || txt.includes('select renewal duration')) {
        return;
      }

      if (noiseKeywords.some(kw => txt.includes(kw))) {
        let container = el;
        while (container.parentElement && container.parentElement !== document.body) {
          const style = window.getComputedStyle(container);
          if (style.position === 'fixed' || style.position === 'absolute' || container.getAttribute('role') === 'dialog') {
            break;
          }
          container = container.parentElement;
        }
        if (container && container !== document.body) {
          container.remove();
        }
      }
    });

    // 清理无用背景遮罩
    document.querySelectorAll('div').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' && parseInt(style.zIndex, 10) > 10) {
        const txt = (el.innerText || '').toLowerCase();
        if (!txt.includes('keep your server online') && !txt.includes('select renewal duration')) {
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

    // 1. 直达目标页面
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log(`📂 访问服务器目标页面: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // 等待网页加载并清除初始干扰弹窗
    await page.waitForTimeout(3500);
    await clearInitialNoisePopups(page);

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
      await clearInitialNoisePopups(page);
      await page.waitForTimeout(1500);
    }

    if (!billingClicked) {
      throw new Error('未找到 [PLAN Billing] 选项卡');
    }

    // 选项卡切换后，再清一次可能新弹出的 Feedback 弹窗
    await page.waitForTimeout(2500);
    await clearInitialNoisePopups(page);

    // 3. 点击红色 [Renew now] 按钮 (从此之后不再清理任何弹窗！)
    console.log('🔄 寻找并点击红色 [Renew now] 按钮...');
    let renewClicked = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      renewClicked = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
        const target = allBtns.find(b => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return txt === 'renew now' || txt === 'renew';
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (renewClicked) {
        console.log('👉 成功触发 [Renew now] 点击！');
        break;
      }
      await page.waitForTimeout(1500);
    }

    if (!renewClicked) {
      throw new Error('未找到 [Renew now] 按钮');
    }

    // 4. 等待正牌续费弹窗弹出，并点击 [60 hours] 选项
    console.log('⏳ 等待续费选择弹窗（Keep your server online）渲染...');
    await page.waitForTimeout(3000);

    console.log('📋 点击 60 hours / 48 hours 免费续期卡片...');
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
      console.log('👉 成功点击 60 hours 免费选项！');
    } else {
      console.log('⚠️ 未在弹窗中成功定位到 60 hours 选项卡。');
    }

    await page.waitForTimeout(4000);

    // 5. 最终结果确认与截图推送
    const isModalStillOpen = await page.evaluate(() => {
      return document.body.innerText.includes('Keep your server online');
    });

    const screenshotPath = 'screenshots/renew_result.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (isModalStillOpen) {
      const notReadyMsg = '⏳ Freemchost 尝试续期：由于剩余时间未少于 46 小时，免费续期按钮尚未激活。';
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
