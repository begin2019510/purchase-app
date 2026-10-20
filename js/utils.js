// === App Namespace ===
const App = { utils: {}, auth: {}, api: {}, stats: {}, expense: {}, items: {}, ai: {}, budget: {}, app: {} };

// ===== Platform Detection =====
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const API_BASE = IS_NATIVE ? 'https://121212121.top' : '';

// utils.js - Version, Changelog, Utilities
const APP_VERSION = "4.0.47";
function showVersion(){document.getElementById('versionBadge').textContent='v'+APP_VERSION}
const CHANGELOG=[
{v:'4.0.47',date:'2026-10-17',items:['审批确认弹层 iOS 化：商品名居中、总价大数字、状态流转胶囊（去掉红点与橙色提示语）、弹层顶部加拖拽把手']},
{v:'4.0.46',date:'2026-10-17',items:['采购审批弹窗/详情弹窗移动端适配：全部弹窗统一 iOS 底部弹层（不再是大号居中卡片）','确认/取消按钮统一 48px 高 16px 字号等宽大按钮；详情弹窗内容独立滚动','审批流状态推进（审批→下单→收货→归档）全程同一体感']},
{v:'4.0.45',date:'2026-10-17',items:['修复：分期采购刚提交（未审批/未下单）就立即扣占预算 —— 现在只有「已下单」及之后的分期才计入预算扣减与每月还款统计']},
{v:'4.0.44',date:'2026-10-17',items:['新建/编辑待办弹层 iOS 重做：保存按钮加大约 48px 高、固定底部不再随内容滚动、取消+保存双按钮','输入框统一 16px 字号（修复 iOS 聚焦自动放大页面）、间距加大、子任务添加按钮重做']},
{v:'4.0.43',date:'2026-10-17',items:['强制阶段规则：项目固定 P0~P5 六段（缺失自动补齐）；P5 为最终阶段，不可跳过，只有 P5 完成项目才通关']},
{v:'4.0.42',date:'2026-10-17',items:['项目与采购/记账深度耦合：项目可设目标预算并显示已花/剩余/进度条','阶段内直接查看已挂的采购/记账明细（点击可进详情），可一键「记采购/记账」自动关联当前项目阶段','极速采购弹窗也可选择所属项目与阶段']},
{v:'4.0.41',date:'2026-10-17',items:['新建项目界面重做：渐变头图、主题色板（8 色圆点）、更清晰的表单层级','阶段（里程碑）支持规划时间：可设置开始/完成日期，完成阶段自动记录实际完成时间并在详情显示','项目卡片显示当前阶段的计划里程碑']},
{v:'4.0.40',date:'2026-10-17',items:['项目模块按规划文档落地 P0~P5 阶段通关制：六阶段条、阶段详情（改名/备注/交付物）、完成/跳过/回退完全可逆、最后阶段完成自动通关','采购/记账表单可关联「项目+阶段」，项目详情聚合总花费与各阶段花费','旧项目已清空；Todo 完成度不再自动改项目状态','项目列表加入本地缓存，打开秒显']},
{v:'4.0.39',date:'2026-10-17',items:['项目模块大改第一版：列表按状态分组、项目卡片带进度条与子项目、详情页环形进度+子项目/关联待办+操作网格','项目新建/编辑弹窗重做：修复错别字与破损布局，改为底部弹层']},
{v:'4.0.38',date:'2026-10-17',items:['追加预算支持来源说明：预设 工资结余/年终奖/兼职/红包/理财/退款/节省开支 + 自定义来源，历史追加记录可查看与删除','网页端更新自愈：检测到新版本自动重载一次']},
{v:'4.0.37',date:'2026-10-17',items:['修复全站弹层滚动：二级页面打开后背景不再跟着滚（iOS position:fixed 锁定），弹层内可正常滑动','新建/编辑待办改为 iOS 底部弹层：标题与关闭按钮同行、内容区滚动、保存按钮固定底部']},
{v:'4.0.36',date:'2026-10-17',items:['修复 Service Worker 缓存版本号未随版本更新的问题（此前新旧缓存混用，导致界面更新不生效）']},
{v:'4.0.35',date:'2026-10-17',items:['更新机制改进：页面壳改为网络优先（2.5 秒超时回退缓存），以后打开 App 立即拿到最新界面，不再等缓存静默更新']},
{v:'4.0.34',date:'2026-10-17',items:['待办界面第三版：iOS 提醒事项式分组无缝列表 + 环形完成度 + 日期标题，去掉每张卡片独立阴影，更接近原生质感']},
{v:'4.0.33',date:'2026-10-17',items:['极速采购弹窗补齐虚拟商品支持：平台/分类新增云与 AI 选项，勾选虚拟商品，选 AI/云平台自动勾选并联动分类']},
{v:'4.0.32',date:'2026-10-17',items:['虚拟商品平台选项补充：MiMo、DeepSeek（AI API 服务）']},
{v:'4.0.31',date:'2026-10-17',items:['采购支持虚拟商品：买 API 服务/服务器资源/会员/软件等，表单新增「虚拟商品」开关与专属徽章','平台新增 阿里云/腾讯云/OpenAI/AWS，分类新增 云服务/API/会员/软件']},
{v:'4.0.30',date:'2026-10-17',items:['待办模块视觉大改：按日期分组（已过期/今天/明天/本周/以后/无日期/已完成）、新卡片与勾选圆环、顶部完成度概览、筛选胶囊横滑','修复待办/项目/统计页下拉刷新失效（代码里被误禁用）','待办到期推送与早间摘要接入服务端调度（APNs），修复订阅用户名截断 bug']},
{v:'4.0.29',date:'2026-10-16',items:['登录界面升级：紫色渐变上新增动态粒子背景（漂浮光点+连线+鼠标/触摸联动），登录屏收起自动停帧省电','支持系统「减弱动态效果」设置，开启后不显示粒子']},
{v:'4.0.28',date:'2026-10-16',items:['登录/注册页底部同步展示 ICP 备案号（管局审核入口页要求）']},
{v:'4.0.27',date:'2026-10-16',items:['按管局要求全站页脚展示 ICP 备案号：皖ICP备2026035353号（主App/帮助/隐私政策页底部，点击可跳转工信部核验）']},
{v:'4.0.26',date:'2026-10-15',items:['修复 iOS 主屏 App 重装后不自动申请通知权限：首次打开自动检测并触发订阅，确保推送正常送达']},
{v:'4.0.25',date:'2026-10-13',items:['重制应用图标：靛紫渐变底+白色房子（原文件是纯绿占位图）；主屏删除旧图标重新添加即可生效']},
{v:'4.0.24',date:'2026-10-12',items:['数据缓存改为永不过期：隔很多天打开也秒开（先出旧数据，后台静默刷新）','iOS 主屏图标：改用规范 180×180 apple-touch-icon；需删除旧图标后重新添加到主屏幕']},
{v:'4.0.23',date:'2026-10-12',items:['周报口径对齐：改为与周视图相同的「当月4段（每段7~8天）」，段结束后晚8点推送第N周账单','定时调整为每月1/9/17/25日 20:05（每段结束次日）；月报仍为1日20:00','统计页无报告时显示说明占位；弹层标题显示第N周']},
{v:'4.0.22',date:'2026-10-12',items:['周报/月报升级为专属底部弹层界面：大数字、环比、分类排行条、最高一天、预算环，iOS/电脑一致','报告生成后首次进入 App 自动弹出，每期只弹一次；统计页卡片点击同样进入','修复月报区间：1日生成时正确统计上一个完整月，不再是空报告']},
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
