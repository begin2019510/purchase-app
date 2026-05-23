const APP_VERSION='3.0.0';
function showVersion(){document.getElementById('versionBadge').textContent='v'+APP_VERSION}
const CHANGELOG=[
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
document.getElementById('versionBadge').addEventListener('click',openChangelog);
let currentImageData='';let currentImageKey='';
function toggleDarkMode(){const isDark=document.body.classList.toggle('dark');localStorage.setItem('dark_mode',isDark?'1':'0');document.getElementById('darkModeBtn').textContent=isDark?'☀️':'🌙'}
(function(){if(localStorage.getItem('dark_mode')==='1'){document.body.classList.add('dark');document.getElementById('darkModeBtn').textContent='☀️'}})();
function handleImageUpload(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){const img=new Image();img.onload=function(){const canvas=document.createElement("canvas");const MAX=800;let w=img.width,h=img.height;if(w>MAX){h=h*MAX/w;w=MAX}if(h>MAX){w=w*MAX/h;h=MAX}canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,w,h);let q=0.7;let dataUrl=canvas.toDataURL("image/jpeg",q);while(dataUrl.length>500000&&q>0.2){q-=0.1;dataUrl=canvas.toDataURL("image/jpeg",q)}currentImageData=dataUrl;currentImageKey="";const preview=document.getElementById("eImagePreview");preview.src=dataUrl;preview.style.display="block";const info=document.getElementById("imageSizeInfo");info.textContent="[Compressed: "+String((dataUrl.length/1024).toFixed(0))+"KB]";info.style.display="block";};img.src=e.target.result;};reader.readAsDataURL(file)}
function showFullscreenImg(src){document.getElementById('imgFullscreenImg').src=src;document.getElementById('imgFullscreen').classList.add('active')}
const API='/api/items';
const EXPENSE_API='/api/expenses';
let items=[], expenses=[];
let currentStatusFilter='全部',currentCatFilter='全部';
let batchMode=false,selectedIds=new Set();
let currentTab='purchase';
let expenseViewMode='list'; // 'list' | 'calendar'
let calYear, calMonth; // 0-indexed month
let calSelectedDate=null; // 'YYYY-MM-DD'



function getPin(){return localStorage.getItem('purchase_pin')||''}
function setPin(p){localStorage.setItem('purchase_pin',p)}
function submitPin(){const pin=document.getElementById('pinInput').value.trim();if(!pin){document.getElementById('pinError').textContent='请输入密码';return}setPin(pin);verifyAndLoad()}
async function verifyAndLoad(){try{const r=await fetch(API,{headers:{'X-API-Key':getPin()}});if(r.status===401){document.getElementById('pinError').textContent='密码错误';document.getElementById('pinInput').value='';return}if(!r.ok)throw new Error();document.getElementById('pinScreen').style.display='none';loadAll()}catch{document.getElementById('pinError').textContent='连接失败'}}
document.getElementById('pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')submitPin()});
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
// 无需浏览器权限，配置飞书机器人 webhook 即可
// 配置方法：Cloudflare 环境变量 FEISHU_BOT_WEBHOOK
async function setupPush(){
  const msg = '推送使用飞书机器人\n\n操作步骤：\n1. 飞书打开一个群聊\n2. 群设置 → 群机器人 → 添加机器人\n3. 选择自定义机器人 → 复制 Webhook 地址\n4. 在 Cloudflare Pages 设置中添加环境变量：\n   FEISHU_BOT_WEBHOOK = 复制的地址\n5. 然后 GitHub Actions 每天 20:00 自动发提醒';
  alert(msg);
}

function getBudgets(){try{return JSON.parse(localStorage.getItem('purchase_budgets')||'{}')}catch{return{}}}
function setBudgets(b){localStorage.setItem('purchase_budgets',JSON.stringify(b))}
function getBudget(m){return getBudgets()[m]||0}

// Init moved to index.html bottom
