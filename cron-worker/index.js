// Cloudflare Worker - 采购管家定时任务
// 替代 GitHub Actions，直接在 Cloudflare 上运行

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    const now = new Date();
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjDay = now.getUTCDay();
    const bjDate = now.getUTCDate();

    let task = 'unknown';
    let url = '';

    if (cron === '0 4 * * *') {
      // 北京 12:00 - 每日记账提醒
      task = '记账提醒(午)';
      url = `${env.API_BASE}/api/push/trigger?token=${env.CRON_SECRET}`;
    } else if (cron === '0 10 * * *') {
      // 北京 18:00 - 每日记账提醒
      task = '记账提醒(晚)';
      url = `${env.API_BASE}/api/push/trigger?token=${env.CRON_SECRET}`;
    } else if (cron === '0 2 * * *') {
      // 北京 10:00 - 归档检查
      task = '归档检查';
      url = `${env.API_BASE}/api/push/archive-check?token=${env.CRON_SECRET}`;
    } else if (cron === '3 4 * * 0') {
      // 北京 12:03 周日 - 周度汇总
      task = '周度汇总';
      url = `${env.API_BASE}/api/push/summary?type=weekly&token=${env.CRON_SECRET}`;
    } else if (cron === '5 4 1 * *') {
      // 北京 12:05 每月1号 - 月度汇总
      task = '月度汇总';
      url = `${env.API_BASE}/api/push/summary?type=monthly&token=${env.CRON_SECRET}`;
    }

    console.log(`[${now.toISOString()}] 任务: ${task}, cron: ${cron}`);

    if (!url) {
      console.log('未匹配的 cron:', cron);
      return;
    }

    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log(`[${task}] 响应:`, JSON.stringify(data));
    } catch (e) {
      console.error(`[${task}] 失败:`, e.message);
    }
  },
};
