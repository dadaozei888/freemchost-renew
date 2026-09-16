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

// 💥 通用强力清屏：按 DOM 结构与层级彻底拔除所有非续费弹窗/遮罩
async function nukePopups(page) {
  console.log('💥 执行通用清屏：强行清除所有 Modal 弹窗与 Backdrop 遮罩...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    // 1. 恢复被弹窗锁定的网页滚动与点击交互
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';

    // 2. 遍历所有元素，通过样式特征（fixed/absolute/z-index/dialog）强行拔除弹窗
    const allEls = Array.from(document.querySelectorAll('*'));
    allEls.forEach(el => {
      // 忽略根容器节点
      if (['BODY', 'HTML'].includes(el.tagName) || ['root', '__next', 'app'].includes(el.id)) {
        return;
      }

      const style = window.getComputedStyle(el);
      const isFixed = style.position === 'fixed';
      const isAbsolute = style.position === 'absolute';
      const zIndex = parseInt(style.zIndex, 10) || 0;
      const isDialog = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';

      const txt = (el.innerText || '').toLowerCase();
      // 保护真正的续费弹窗（避免误删）
      const isRenewalModal = txt.includes('keep your server online') || 
                             txt.includes('select renewal duration') || 
                             txt.includes('free renewals open');

      if (isRenewalModal) return;

      // 如果符合遮罩/弹窗特征，直接移除
      if (isDialog || (isFixed && zIndex > 5) || (isAbsolute && zIndex > 100)) {
        const rect = el.getBoundingClientRect();
        if (isDialog || rect.width > 150 || rect.height > 150) {
          el.remove();
        }
      }
    });

    // 3. 辅助逻辑：触发各类常见“Close”或“Maybe later”按钮
    document.querySelectorAll('button, a, div[role="button"]').forEach(btn => {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (['maybe later', 'close', 'reject all', 'accept all', 'i need help'].includes(txt)) {
        try { btn.click(); } catch(e) {}
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

    // 1. 进入服务器页面
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log(`📂 访问服务器目标页面: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // 第一次扫清进站弹窗
    await page.waitForTimeout(3000);
    await nukePopups(page);

    // 若在列表页则进入 UUID 对应服务器
    if (page.url().endsWith('/app')) {
      let targetUuid = '';
      if (serverPageUrl && serverPageUrl.includes('/servers/')) {
        targetUuid = serverPageUrl.split('/servers/')[1].trim();
      }
      if (targetUuid) {
        const specificLink = page.locator(`a[href*="${targetUuid}"]`).first();
        if (await specificLink.count() > 0) {
          await specificLink.click();
          await page.waitForTimeout(3000);
          await nukePopups(page);
        }
      }
    }

    // 2. 切入顶部 [PLAN / Billing]
    console.log('📌 点击切换至顶部 [PLAN / Billing] 选项卡...');
    let billingClicked = false;
    for (let i = 0; i < 5; i++) {
      await nukePopups(page);
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
      await page.waitForTimeout(2000);
    }

    if (!billingClicked) {
      throw new Error('未找到 [PLAN Billing] 选项卡');
    }

    // 等待面板内容与链式弹窗渲染，再次扫清
    await page.waitForTimeout(3500);
    await nukePopups(page);

    // 3. 点击 [Renew now]
    console.log('🔄 触发 [Renew now] 按钮...');
    let renewClicked = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await nukePopups(page);
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
      await page.waitForTimeout(2000);
    }

    if (!renewClicked) {
      throw new Error('未找到 [Renew now] 按钮');
    }

    // 4. 选择 60 hours / 48 hours 免费续卡
    console.log('📋 选择免费续期卡片...');
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
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
      }
    });

    await page.waitForTimeout(4000);

    // 检查续费弹窗状态
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
