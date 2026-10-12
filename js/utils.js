// === App Namespace ===
const App = { utils: {}, auth: {}, api: {}, stats: {}, expense: {}, items: {}, ai: {}, budget: {}, app: {} };

// ===== Platform Detection =====
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const API_BASE = IS_NATIVE ? 'https://121212121.top' : '';

// utils.js - Version, Changelog, Utilities
const APP_VERSION = "4.0.21";
function showVersion(){document.getElementById('versionBadge').textContent='v'+APP_VERSION}
const CHANGELOG=[
{v:'4.0.21',date:'2026-10-12',items:['修复移动端极速免审角标遮挡商品名（padding 被媒体查询 !important 覆盖）','极速免审限额：单笔合计 ≤ ¥50，超出提示走完整采购','周报/月报：统计页展示最新报告；周日20:00周报推送、每月1日20:00月报推送（苹果APNs）']},
{v:'4.0.20',date:'2026-10-12',items:['黑屏修复：应用壳（HTML/JS/CSS）改缓存优先秒开，后台静默更新，不再每次打开全量走网络','版本更新静默接管：去掉打开时清缓存整页重载（此前部署后双重加载导致黑屏数秒）','加载期底色浅灰/深黑跟主题，替代 iOS 默认纯黑']},
{v:'4.0.19',date:'2026-10-12',items:['冷加载提速：缓存有效期5分钟→7天（重开秒开、骨架仅首次真冷启动可见）','首绘只等采购+记账两路数据，待办/项目/预算后台补齐；数据无变化不重渲染不闪','iOS 版本自动更新：回前台/聚焦时强制检查 Service Worker 新版本']},
{v:'4.0.18',date:'2026-10-12',items:['系统通知诊断：不支持时显示缺少哪项能力/UA/主屏状态（通知须在 iPhone 主屏 App 内开启）']},
{v:'4.0.17',date:'2026-10-12',items:['iOS 灵动岛适配：viewport-fit、状态栏全屏、头部/下拉刷新避让刘海安全区','系统通知：接入 Web Push（苹果官方 APNs 通道），设置→系统通知一键开启；iOS 需先添加到主屏幕','服务器定时发送（每日 12:05/18:05），订阅过期自动清理']},
{v:'4.0.16',date:'2026-10-11',items:['静默刷新：回窗口/前台轮询仅比对数据，无变动完全不打扰，有变动自动更新（手机电脑通用）','刷新不再闪骨架屏（仅首次冷启动显示）；电脑端顶部新增 🔄 手动刷新按钮，无变动不提示']},
{v:'4.0.15',date:'2026-10-11',items:['下拉刷新重做：iOS 风悬浮圆徽章（箭头随手旋转180°到位变绿→转圈→✓），拖动1:1跟手不再黏滞，替换原文字符号横条','电脑支持鼠标下拉刷新；切回窗口超5分钟自动刷新','防误触：输入框/文字选中/小幅移动不触发']},
{v:'4.0.14',date:'2026-10-11',items:['采购/记账页底部双按钮：主FAB保持原功能，上方叠加⚡极速副FAB（拇指区可达，手机端尺寸自适应）','极速弹窗移动端优化：自动聚焦、回车即存、记住上次平台/分类、金额数字键盘']},
{v:'4.0.13',date:'2026-10-11',items:['已到状态详情页新增「↩️ 退货」按钮（极速单直接出生在已到，此前无退货入口，只能进编辑改状态）','退货后统计自动剔除：预算池/采购消耗/分类饼图均不含已退（沿用现有口径）']},
{v:'4.0.12',date:'2026-10-10',items:['⚡极速采购：免审直通单，最少字段直接生成「已到」状态采购记录（记账页/采购页均有入口）','采购卡片左上角绿色「极速免审」角标，详情页同步显示','统计走现有采购链路：预算池/分类饼图/月汇总自动计入，零改动零双算']},
{v:'4.0.11',date:'2026-10-10',items:['修复分类"已存在"误报：管理页打开时强制刷新数据，加载完成后自动重绘列表（此前页面显示旧空列表但内存已有，重加即误报）','保存增加 HTTP 状态校验（404 不再静默成功）；401/失败响应不再清空本地分类；防双击重复提交']},
{v:'4.0.10',date:'2026-10-10',items:['修复：上传的分类图标在记账里不显示——周视图明细行加上图标位（默认视图之前只有色点）','分类数据加载完成后自动重渲染；改图标立即刷新记录列表']},
{v:'4.0.9',date:'2026-10-10',items:['分类图标支持粘贴/拖拽：截图后 Ctrl+V 直接生效，无需打开文件管理器','点图标=选中目标（高亮），双击才弹文件选择；新增分类区粘贴即预览']},
{v:'4.0.8',date:'2026-10-10',items:['分类集中管理中心：默认+自定义分类统一列表，全部可点图标上传图片、✏️改 emoji、✖️清除图片','图标覆盖存 KV（icons 字段），仅影响当前用户，默认分类数据不动']},
{v:'4.0.7',date:'2026-10-10',items:['分类支持上传图片做图标：自动裁剪压缩为 96×96 小图标，列表/明细直接显示','管理页点已有分类的图标可随时更换图片或改用 emoji']},
{v:'4.0.6',date:'2026-10-10',items:['记账分类可自定义：设置→记账分类 可增删（带 emoji 图标），记一笔下拉直接「➕新分类」','自定义分类自动获得颜色（按名哈希），图表/明细/统计全兼容','新增后端 /api/cats 持久化到 KV']},
{v:'4.0.5',date:'2026-10-10',items:['周明细改为简报样式：一行统计 + 每日迷你条形图 + 最多5条单行明细，「展开全部」再看完整列表，展开区域大幅收窄']},
{v:'4.0.4',date:'2026-10-10',items:['周视图重做：点击周卡片在卡片内展开该周明细（按日分组+跨周分摊），不再跳转日视图','明细行点击可直接编辑记账，再点标题收起']},
{v:'4.0.3',date:'2026-10-10',items:['周视图：点击周卡片可进入该周明细（此前有按压反馈但未绑定点击）','周卡片加 › 指示可点']},
{v:'4.0.2',date:'2026-10-10',items:['修复：记账月预算剩余与统计不一致（如预算2000含分期500、已用1000，应剩500却显示1000）——列表视图改用与统计相同的预算池口径：剩余=总预算−固定−分期−支出']},
{v:'4.0.1',date:'2026-10-10',items:['修复：分期还款不自动进位（9月第1期，10月仍显示第1期）——已还期数改为按时间自动推进，取存储值与月份差的较大者']},
{v:'4.0.0',date:'2026-10-10',items:['UI全站改版：Apple 风精简设计语言，删除粉色贴纸风图层','设计 Token 系统：圆角/间距/阴影/色板统一','背景主题可调：设置里 8 种背景色可选','记账/统计新增月份切换，历史数据可查','待办/项目/采购卡片对齐新组件，徽章统一']},
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
let viewMonth=null; // null = 本月; 'YYYY-MM' = 用户浏览的历史月
function getViewMonth(){return viewMonth||getThisMonth()}
function shiftViewMonth(delta){
  const cur=getViewMonth().split('-').map(Number);
  let y=cur[0],m=cur[1]+delta;
  if(m<1){m=12;y--} if(m>12){m=1;y++}
  const next=y+'-'+String(m).padStart(2,'0');
  viewMonth=(next===getThisMonth())?null:next;
  if(typeof render==='function')render();
}
function monthLabel(m){const p=m.split('-');return p[0]+'年'+Number(p[1])+'月'}
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
