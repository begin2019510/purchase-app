// === App Namespace ===
const App = { utils: {}, auth: {}, api: {}, stats: {}, expense: {}, items: {}, ai: {}, budget: {}, app: {} };

// ===== Platform Detection =====
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const API_BASE = IS_NATIVE ? 'https://121212121.top' : '';

// utils.js - Version, Changelog, Utilities
const APP_VERSION = "3.9.4";
function showVersion(){document.getElementById('versionBadge').textContent='v'+APP_VERSION}
const CHANGELOG=[
  {v:'2.10.0',date:'2026-05-27',items:['采购评估流程优化：新增购买理由输入、评估摘要窗口、取消采购归档']},
  {v:'2.9.0',date:'2026-05-27',items:['安全加固：登录限流(5次/15分钟)、图片大小后端校验(2MB)、金额上限校验(999999)','XSS修复：内联onclick改为事件委托+data属性','AI提示注入防护：用户数据用<<<DATA>>>分隔符包裹','图片API移除URL中的PIN参数，仅用JWT认证','debug接口收紧为仅管理员可访问','飞书API错误日志增强','SW版本号v38更新']},
  {v:'2.8.5',date:'2026-05-26',items:['评估卡片显示预算+AI摘要','评估弹窗支持续聊+保存+跳转需求填写','评估页可跳过直接填写']},
  {v:'2.8.3',date:'2026-05-26',items:['需求评估多轮对话+提交进入待评估状态，不再直接填表单']},
  {v:'2.8.2',date:'2026-05-26',items:['AI需求评估支持预算区间输入，评估更精准']},
  {v:'2.8.0',date:'2026-05-25',items:['AI 需求评估：输入商品名AI分析历史采购数据+预算+价格趋势给购买建议']},
  {v:'2.7.0',date:'2026-05-24',items:['记账/采购导出增强：支持CSV/TSV格式选择','采购统计增强：分类饼图、平台分布、6个月趋势','离线体验优化：断网检测+黄色横幅提示','在线帮助文档页面']},
  {v:'2.6.0',date:'2026-05-23',items:['代码重构：JS提取为独立app.js文件','CSS已外置为style.css','版本号更新']},
  {v:'2.5.9',date:'2026-05-23',items:['AI智能分类：备注输入时自动推荐分类+标签','AI批量标签提炼：一键分析本月备注生成标签','分类基于历史数据学习用户习惯']},
  {v:'2.5.8',date:'2026-05-23',items:['AI自然语言记账：说句话自动解析金额/分类/时间','AI财务分析报告：消费异常/省钱建议/趋势洞察','AI代理后端：DeepSeek API + Cloudflare Pages Function']},
  {v:'2.5.7',date:'2026-05-23',items:['骨架屏加载动画，告别白屏等待','下拉刷新手势支持','卡片左滑删除、右滑改状态']},
  {v:'2.5.6',date:'2026-05-23',items:['统计页新增每日支出折线趋势图','每周支出柱状对比图','收入vs支出双线对比','支出分类排行柱状图']},
  {v:'2.5.5',date:'2026-05-23',items:['新增记账月历视图：日历网格展示每日收支','点击日期查看当天记账明细','支持月份切换导航','空日期可快捷记一笔','列表/日历视图自由切换']},
  {v:'2.5.4',date:'2026-05-22',items:['图片API返回二进制数据+pin认证','采购统计getMonth时间戳修复','退货金额减法修复','审批流已到打钩修复','记账删图功能','Cron Worker部署']},
  {v:'2.5.3',date:'2026-05-21',items:['图片上传分为拍照+相册两个按钮','拍照用capture=environment，相册无限制','兼容所有手机浏览器']},
  {v:'2.5.2',date:'2026-05-21',items:['图片存储升级：改用Cloudflare KV，告别32KB限制','图片压缩上限提升至800px/500KB','旧图片自动兼容，新图片存KV']},
  {v:'2.5.1',date:'2026-05-21',items:['记账精确时间戳：新建/编辑均支持选择具体时间','导出CSV增加独立时间列','卡片时间显示优化：🕐前缀+正常可见','点击版本号查看更新日志']},
  {v:'2.5.0',date:'2026-05-20',items:['归档功能：已到/已退3天后自动提醒归档','审批流完整流程：待审批→已审批→已下单→已到/已退→已归档','新增archive-check定时任务','Bitable新增归档时间字段']},
  {v:'2.4.2',date:'2026-05-20',items:['审批流分支结构修复：已到和已退是分支而非线性','详情弹窗改版：stepper流程展示+操作按钮','已到/已退终态显示归档按钮']},
  {v:'2.4.1',date:'2026-05-20',items:['详情弹窗重做：飞书审批流风格','竖向stepper时间线','卡片只显示状态+最新时间']},
  {v:'2.4.0',date:'2026-05-20',items:['采购审批流：5步状态管理','自动记录状态变更时间','暗色模式','记账图片附件支持','周度/月度汇总飞书推送']},
  {v:'2.3.0',date:'2026-05-20',items:['暗色模式（跟随系统+手动切换）','记账图片附件（拍照+压缩+全屏预览）','周度/月度汇总飞书推送']},
];
function openChangelog(){const c=document.getElementById('changelogContent');let html='';CHANGELOG.forEach(r=>{html+=`<div class='changelog-ver'>v${r.v}<span class='changelog-date'>${r.date}</span></div><ul class='changelog-list'>`;r.items.forEach(i=>{html+=`<li>${i}</li>`});html+='</ul>'});c.innerHTML=html;document.getElementById('changelogOverlay').classList.add('active')}
function closeChangelog(){document.getElementById('changelogOverlay').classList.remove('active')}

function validateAmount(input) {
  const v = parseFloat(input.value);
  if (v < 0) input.value = 0;
  if (v > 999999) input.value = 999999;
}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function stripMd(s){if(!s)return'';return s.replace(/\*\*(.+?)\*\*/g,'').replace(/\*(.+?)\*/g,'').replace(/`([^`]+)`/g,'').replace(/^#{1,6}\s+/gm,'').replace(/^>\s+/gm,'').replace(/^[-*]\s+/gm,'').replace(/^\d+\.\s+/gm,'').replace(/\n{3,}/g,'\n\n').trim()}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2200)}
function getMonth(d){if(!d)return null;try{const ts=typeof d==='number'?d:Date.parse(d);return new Date(ts+8*3600*1000).toISOString().slice(0,7)}catch{return null}}
function getThisMonth(){return new Date(Date.now()+8*3600*1000).toISOString().slice(0,7)}
function totalCost(l){return l.reduce((s,i)=>s+(i['单价']||0)*(i['数量']||1),0)}

function skelCards(n){
  let h='';for(let i=0;i<(n||3);i++)h+='<div class="card" style="padding:16px;margin-bottom:10px"><div style="height:14px;width:60%;background:var(--border);border-radius:4px;margin-bottom:8px"></div><div style="height:10px;width:40%;background:var(--border);border-radius:4px;margin-bottom:12px"></div><div style="height:10px;width:80%;background:var(--border);border-radius:4px"></div></div>';return h;
}
function skelStats(){
  return '<div class="stats-section"><div style="height:18px;width:100px;background:var(--border);border-radius:4px;margin-bottom:16px"></div><div style="height:120px;background:var(--border);border-radius:8px"></div></div>'.repeat(3);
}

// === App.utils namespace exports ===
App.utils.showVersion = showVersion;
App.utils.openChangelog = openChangelog;
App.utils.closeChangelog = closeChangelog;
App.utils.validateAmount = validateAmount;
App.utils.esc = esc;
App.utils.stripMd = stripMd;
App.utils.escAttr = escAttr;
App.utils.toast = toast;
App.utils.getMonth = getMonth;
App.utils.getThisMonth = getThisMonth;
App.utils.totalCost = totalCost;
App.utils.skelCards = skelCards;
App.utils.skelStats = skelStats;
App.utils.APP_VERSION = APP_VERSION;
App.utils.CHANGELOG = CHANGELOG;
