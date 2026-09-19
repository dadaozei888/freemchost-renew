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

// 🛡️ 出现弹窗时点击 [×] 或跳过/接受按钮
async function dismissPopupsIfPresent(page) {
  try {
    await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('button, svg, span, div, a'));
      allElements.forEach(el => {
        const txt = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (txt === '×' || txt === '✕' || txt === 'x' || aria.includes('close')) {
          try { el.click(); } catch(e) {}
        }
      });

      const actionBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
      actionBtns.forEach(el => {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (['maybe later', 'close', 'reject all', 'accept all'].includes(txt)) {
          try { el.click(); } catch(e) {}
        }
      });
    });
  } catch (e) {}
  await page.waitForTimeout(500);
}

// 🕒 精准获取页面上的剩余倒计时 (如: 3天 0小时 12分钟)
async function getExpiryTimeText(page) {
  try {
    const result = await page.evaluate(() => {
      // 1. 寻找包含 TIME UNTIL EXPIRY 的最底层文本节点/元素
      const allNodes = Array.from(document.querySelectorAll('*'));
      const expiryHeader = allNodes.find(el => 
        el.children.length === 0 && (el.textContent || '').toUpperCase().includes('TIME UNTIL EXPIRY')
      );

      if (expiryHeader) {
        // 向上找父级容器（通常是整块倒计时卡片）
        let container = expiryHeader.parentElement;
        for (let i = 0; i < 3; i++) {
          if (container && container.parentElement) {
            container = container.parentElement;
          }
        }
        const blockText = container ? container.innerText : '';
        // 提取连续数字 (天 时 分 秒)
        const nums = blockText.match(/\b\d{1,2}\b/g);
        if (nums && nums.length >= 2) {
          const days = parseInt(nums[0], 10);
          const hours = parseInt(nums[1], 10);
          const mins = nums[2] ? parseInt(nums[2], 10) : 0;
          return `${days}天 ${hours}小时 ${mins}分钟`;
        }
      }

      // 2. 全局正则保底提取
      const fullText = document.body.innerText || '';
      const match = fullText.match(/TIME UNTIL EXPIRY[\s\S]*?(\d{1,2})[\s\S]*?(\d{1,2})[\s\S]*?(\d{1,2})/i);
      if (match) {
        return `${parseInt(match[1], 10)}天 ${parseInt(match[2], 10)}小时 ${parseInt(match[3], 10)}分钟`;
      }

      return null;
    });

    return result || '未知';
  } catch (e) {
    return '未知';
  }
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

    // 1. 进入服务器页面
    if (serverPageUrl) {
      console.log('📂 正在进入指定服务器页面:', serverPageUrl);
      await page.goto(serverPageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    } else {
      console.log('📂 正在访问服务列表主页: https://freemchost.com/app');
      await page.goto('https://freemchost.com/app', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2000);
      
      const firstServerLink = page.locator('a[href*="/app/servers/"]').first();
      if (await firstServerLink.count() > 0) {
        console.log('👉 点击第一个服务器卡片...');
        await firstServerLink.click();
        await page.waitForLoadState('networkidle');
      }
    }

    await page.waitForTimeout(2000);
    await dismissPopupsIfPresent(page);

    // 2. 点击 [PLAN / Billing] 选项卡
    console.log('📌 正在点击 [PLAN / Billing] 选项卡...');
    const billingTab = page.getByText('Billing', { exact: false }).first();
    await billingTab.waitFor({ state: 'visible', timeout: 15000 });
    await billingTab.click();
    await page.waitForTimeout(1500);

    // 清理界面弹窗
    await dismissPopupsIfPresent(page);

    // 🕒 在点击续期按钮前，优先获取背景卡片上的剩余倒计时
    const currentExpiryTime = await getExpiryTimeText(page);
    console.log(`📌 抓取到的当前服务器剩余时间: ${currentExpiryTime}`);

    // 3. 点击红色的 [Renew now] 按钮
    console.log('🔄 正在寻找并点击红色 [Renew now] 按钮...');
    const renewBtn = page.getByText('Renew now', { exact: false }).first();
    await renewBtn.waitFor({ state: 'visible', timeout: 15000 });
    await renewBtn.click({ force: true });
    console.log('👉 已点击 [Renew now] 按钮！');

    await page.waitForTimeout(2000);

    // 4. 选择 [60 hours] 选项
    console.log('📋 正在寻找并选择 [60 hours] 续期选项...');
    const hours60Option = page.getByText('60 hours', { exact: false }).first();
    await hours60Option.waitFor({ state: 'visible', timeout: 10000 });
    await hours60Option.click({ force: true });
    console.log('👉 已成功点击 [60 hours] 选项！');

    await page.waitForTimeout(3000);

    // 5. 判断是否未到续期时间（检测提示语 "46h before expiry" 或 "come back later"）
    const isLocked = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return txt.includes('46h before expiry') || txt.includes('come back later');
    });

    await page.screenshot({ path: 'screenshots/renew_result.png', fullPage: true });

    if (isLocked) {
      const notTimeMsg = `⏳ <b>Freemchost 尚未到续期时间</b>\n\n必须在到期前 46 小时内开放免费续期。\n📌 当前服务器剩余时间: <b>${currentExpiryTime}</b>`;
      console.log('⚠️ ' + notTimeMsg.replace(/<[^>]+>/g, ''));
      await sendTelegramMessage(tgToken, tgChatId, notTimeMsg);
    } else {
      // 如果成功续期，重新读取一次更新后的倒计时
      await page.waitForTimeout(2000);
      const updatedExpiryTime = await getExpiryTimeText(page);
      const successMsg = `🎉 <b>Freemchost 服务器已成功续期！</b>\n\n📌 续期后剩余时间: <b>${updatedExpiryTime !== '未知' ? updatedExpiryTime : currentExpiryTime}</b>`;
      console.log('✅ ' + successMsg.replace(/<[^>]+>/g, ''));
      await sendTelegramMessage(tgToken, tgChatId, successMsg);
    }

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
