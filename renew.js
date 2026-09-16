const { chromium } = require('playwright');
const fs = require('fs');

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
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
    console.log('📸 TG 状态截图已成功推送！');
  } catch (err) {
    console.error('❌ TG 截图发送失败:', err.message);
  }
}

// 💥 彻底消灭 Discord 社区弹窗、Feedback 弹窗及无用遮罩
async function nukeDiscordAndNoisePopups(page) {
  console.log('🧹 正在清理 Discord/Community 弹窗与遮罩...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    // 恢复 body 点击与滚动
    document.body.style.pointerEvents = 'auto';
    document.body.style.overflow = 'auto';

    // 1. 尝试直接点击 "Maybe later" 或关闭按钮
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    buttons.forEach(btn => {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (txt === 'maybe later' || txt === 'close') {
        try { btn.click(); } catch (e) {}
      }
    });

    // 2. 物理拔除 Discord 弹窗及非续费 Modal
    const allEls = Array.from(document.querySelectorAll('div, section, article, dialog'));
    allEls.forEach(el => {
      const txt = (el.innerText || '').toLowerCase();

      // 绝不误删正牌续费弹窗
      if (
        txt.includes('keep your server online') || 
        txt.includes('select renewal duration') ||
        txt.includes('336 hours') ||
        txt.includes('168 hours')
      ) {
        return;
      }

      // 如果包含 Discord 社区邀请或反馈弹窗关键字，直接销毁其最高层节点
      if (
        txt.includes('join the freemchost community') || 
        txt.includes('maybe later') ||
        txt.includes('how would you rate') ||
        txt.includes('cookie policy')
      ) {
        let parent = el;
        while (parent.parentElement && parent.parentElement !== document.body) {
          parent = parent.parentElement;
        }
        if (parent && parent !== document.body) {
          parent.remove();
        }
      }
    });

    // 3. 强制清除遗留的高 z-index 半透明背景遮罩
    document.querySelectorAll('div').forEach(div => {
      const style = window.getComputedStyle(div);
      if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex, 10) > 5) {
        const txt = (div.innerText || '').toLowerCase();
        if (!txt.includes('keep your server online') && !txt.includes('336 hours')) {
          div.remove();
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

    // 1. 直达目标服务器页面
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log(`📂 访问目标页面: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // 2. 尝试点击 [PLAN / Billing] 选项卡
    console.log('📌 定位并点击 [PLAN / Billing] 选项卡...');
    await page.waitForTimeout(2000);
    await nukeDiscordAndNoisePopups(page);

    let billingClicked = false;
    for (let attempt = 0; attempt < 5; attempt++) {
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
      await page.waitForTimeout(1500);
    }

    if (!billingClicked) {
      throw new Error('未找到 [PLAN Billing] 选项卡');
    }

    // 等待 Discord 社区弹窗彻底渲染弹出
    console.log('⏳ 等待页面渲染并消灭 Discord/Community 后置弹窗...');
    await page.waitForTimeout(3000);
    await nukeDiscordAndNoisePopups(page);

    // 3. 寻找并点击红色 [Renew now] 按钮
    console.log('🔄 寻找并点击红色 [Renew now] 按钮...');
    let renewClicked = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      await nukeDiscordAndNoisePopups(page);

      renewClicked = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
        const target = allBtns.find(b => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return txt === 'renew now' || txt === 'renew';
        });

        if (target) {
          // 使用原生 DOM 事件触发 click，避免 Playwright 遮挡检测超时
          target.click();
          return true;
        }
        return false;
      });

      if (renewClicked) {
        console.log('👉 成功点击 [Renew now] 按钮！');
        break;
      }
      await page.waitForTimeout(1500);
    }

    if (!renewClicked) {
      throw new Error('未找到 [Renew now] 按钮');
    }

    // 4. 进入正牌续费弹窗，处理 [60 hours] 选项
    console.log('⏳ 等待续费选择弹窗 (Keep your server online) 渲染...');
    await page.waitForTimeout(3500);

    console.log('📋 模拟点击 60 hours 免费续期选项...');
    const clickResult = await page.evaluate(() => {
      const isLockedTextPresent = document.body.innerText.includes('Free renewals open 46h before expiry') ||
                                  document.body.innerText.includes('come back later');

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
              return { clicked: true, locked: isLockedTextPresent };
            }
          }
        }
        targetText.click();
        return { clicked: true, locked: isLockedTextPresent };
      }
      return { clicked: false, locked: isLockedTextPresent };
    });

    await page.waitForTimeout(3000);

    // 检查续费弹窗是否依然存在
    const isModalStillOpen = await page.evaluate(() => {
      return document.body.innerText.includes('Keep your server online');
    });

    const screenshotPath = 'screenshots/renew_result.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // 5. 判断续期结果并通知 Telegram
    if (clickResult.locked || isModalStillOpen) {
      const notReadyMsg = '⏳ Freemchost 续期未生效：免费续期（60 hours）尚未解锁（需等剩余时间小于 46 小时）。';
      console.log('⚠️ ' + notReadyMsg);
      await sendTelegramPhoto(tgToken, tgChatId, screenshotPath, notReadyMsg);
    } else {
      const successMsg = '🎉 Freemchost 服务器已成功提交 60 小时免费续期！';
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
