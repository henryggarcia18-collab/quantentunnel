const APP_VERSION='withdraw-active-plan-quantentunnel-final-deposit-fix-20260824-2';
const API='/api';
const DASHBOARD_SLIDES=[
  '/assets/dashboard-slides/slide-1.webp',
  '/assets/dashboard-slides/slide-2.webp',
  '/assets/dashboard-slides/slide-3.webp',
  '/assets/dashboard-slides/slide-4.webp',
  '/assets/dashboard-slides/slide-5.webp',
  '/assets/dashboard-slides/slide-6.webp'
];
// Global 24-hour rotation start. Each slide stays visible for a full 24 hours.
const DASHBOARD_SLIDE_EPOCH=1787519220;
function initDashboardSlides(){
  const img=document.getElementById('dashboardSlide');
  if(!img)return;
  const update=()=>{
    const elapsed=Math.max(0,Math.floor(Date.now()/1000)-DASHBOARD_SLIDE_EPOCH);
    const index=Math.floor(elapsed/86400)%DASHBOARD_SLIDES.length;
    img.src=DASHBOARD_SLIDES[index];
    img.alt=`QuantenTunnel featured update ${index+1}`;
    Array.from({length:DASHBOARD_SLIDES.length},(_,i)=>i+1).forEach((n,i)=>{const dot=document.getElementById('slideDot'+n);if(dot)dot.classList.toggle('active',i===index)});
    const next=((Math.floor(elapsed/86400)+1)*86400+DASHBOARD_SLIDE_EPOCH)*1000-Date.now();
    setTimeout(update,Math.max(1000,next+500));
  };
  const preloadSlides=()=>DASHBOARD_SLIDES.slice(1).forEach(src=>{const pre=new Image();pre.decoding='async';pre.src=src});
  if('requestIdleCallback' in window) requestIdleCallback(preloadSlides,{timeout:3000}); else setTimeout(preloadSlides,2000);
  update();
}
const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(n)||0);
const token=()=>localStorage.getItem('rv_token');
async function api(path,opts={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(API+path,{...opts,cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...(token()?{Authorization:'Bearer '+token()}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}catch(e){if(e.name==='AbortError')throw new Error('The server took too long to load your investments. Please refresh and try again.');throw e}finally{clearTimeout(timer)}}
function saveSession(d){localStorage.setItem('rv_token',d.token);localStorage.setItem('rv_user',JSON.stringify(d.user));}
function logout(){localStorage.removeItem('rv_token');localStorage.removeItem('rv_user');location.href='/';}
function msg(text){const x=document.getElementById('msg');if(x)x.textContent=text}
const login=document.getElementById('login');
if(login)login.addEventListener('submit',async e=>{e.preventDefault();try{const f=new FormData(login);const d=await api('/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});saveSession(d);location.href=d.user.role==='admin'?'/admin.html':'/dashboard.html'}catch(err){msg(err.message)}});
const register=document.getElementById('register');
if(register)register.addEventListener('submit',async e=>{e.preventDefault();try{const f=new FormData(register);const d=await api('/auth/register',{method:'POST',body:JSON.stringify({...Object.fromEntries(f), referralCode:String(f.get('referralCode')||'').trim().toUpperCase()})});saveSession(d);location.href='/dashboard.html'}catch(err){msg(err.message)}});
initDashboardSlides();
async function loadDash(){if(!token()){location.href='/login.html';return}try{const {user}=await api('/me');const welcome=document.getElementById('welcome');if(welcome)welcome.textContent=`Welcome, ${user.name.split(' ')[0]}`;const wallet=document.getElementById('wallet');if(wallet)wallet.textContent=money(user.wallet);const profit=document.getElementById('profit');if(profit)profit.textContent=money(user.profit);const emailEl=document.getElementById('email');if(emailEl)emailEl.textContent=user.email;const nameEl=document.getElementById('profileName');if(nameEl)nameEl.textContent=user.name;const avatar=document.getElementById('avatar');if(avatar)avatar.textContent=(user.name||'R').trim().charAt(0).toUpperCase();const userId=document.getElementById('userId');if(userId)userId.textContent=`User ID ${user.user_id||'—'}`;const inv=await api('/investments');const active=document.getElementById('active');if(active)active.textContent=inv.items.filter(x=>x.status==='active').length;const invested=inv.items.reduce((sum,x)=>sum+Number(x.amount||0),0);const investedEl=document.getElementById('invested');if(investedEl)investedEl.textContent=money(invested);const tx=await api('/transactions');const txEl=document.getElementById('transactions');if(txEl)txEl.innerHTML=tableTx(tx.items)}catch(e){if(e.message.includes('session'))logout()}}
function tableTx(items){if(!items.length)return '<p class="muted">No transactions yet.</p>';return `<table><thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr></thead><tbody>${items.map(x=>`<tr><td>${x.type}</td><td>${money(x.amount)}</td><td>${statusChip(x.status)}</td><td>${x.reference||'—'}</td><td>${new Date(x.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>`}
async function loadPlans(){const el=document.getElementById('plans');if(!el)return;try{const d=await api('/plans');el.innerHTML=d.items.map(p=>{const available=Boolean(p.available)&&Number(p.dailyRate)>0;const running=Boolean(p.running);const minimum=p.minimum==null?'—':money(p.minimum).replace(/\+/g,'');const dailyProfit=p.minimum==null?'—':money(Number(p.minimum)*Number(p.dailyRate)).replace(/\+/g,'');const rate=Number(p.dailyRate)*100;const rateText=Number.isInteger(rate)?`${rate}%`:`${rate.toFixed(1)}%`;const details=available?`${rateText} daily · ${p.termDays} days`:'Not available at this time';const limit=`<span class="plan-limit ${running?'running':''}">${running?'1/1':'0/1'}</span>`;const action=available?`<button class="btn ${running?'ghost':''}" ${running?'disabled':''} onclick="invest('${p.name}',${p.minimum},${p.dailyRate})">${running?'RUNNING':'Invest Now'}</button>`:`<button class="btn" disabled>NOT AVAILABLE</button>`;return `<article><div class="plan-head"><div class="plan-title"><b>${p.name}</b></div>${limit}</div><div class="plan-amount-row"><strong>${minimum}</strong><strong>${dailyProfit}</strong></div><p>${details}</p>${action}</article>`}).join('')}catch(e){el.innerHTML='<p class="muted">Unable to load plans.</p>'}}
async function invest(plan,amount,dailyRate){try{await api('/investments',{method:'POST',body:JSON.stringify({plan,amount,dailyRate})});toast('Investment activated. Open Active Investments to start your 24-hour claim cycle.');setTimeout(()=>location.href='/active-investments.html',700)}catch(e){toast(e.message)}}
async function walletAction(type,form,providedPayload){try{const f=new FormData(form);const payload=providedPayload||Object.fromEntries(f);if(type==='deposit'&&!document.getElementById('confirmedPaid')?.checked)throw new Error('Confirm that you have paid before submitting');await api('/wallet/'+type,{method:'POST',body:JSON.stringify(payload)});form.reset();toast(type==='deposit'?'Deposit marked as paid and sent to admin for review':'Withdrawal request submitted for review');if(type==='deposit'){localStorage.removeItem('rv_pending_deposit_amount');setTimeout(()=>location.href='/wallet.html',500)}else loadDash()}catch(e){toast(e.message)}}
async function loadWithdraw(){if(!token()){location.href='/login.html';return}try{const {user}=await api('/me');const wallet=document.getElementById('wallet');if(wallet)wallet.textContent=money(user.wallet);const profit=document.getElementById('profit');if(profit)profit.textContent=money(user.profit);const userId=document.getElementById('userId');if(userId)userId.textContent=`User ID ${user.user_id||'—'}`;const name=document.getElementById('profileName');if(name)name.textContent=user.name;const av=document.getElementById('avatar');if(av)av.textContent=(user.name||'R').trim().charAt(0).toUpperCase();const d=await api('/security');const s=d.security||{};const hasBank=Boolean(s.bankName&&s.bankAccountName&&s.bankAccountNumber);const form=document.getElementById('withdraw');if(!hasBank){if(form){form.innerHTML=`<div class=\"empty-state\"><strong>Bank account required</strong><p class=\"muted\">Please bind your bank account in Security before you can request a withdrawal.</p><a class=\"btn gold xl full\" href=\"/security.html\">Bind Bank Account</a></div>`;}toast('Please bind your bank account in Security before withdrawing.');}else{const bankInfo=document.getElementById('boundBankInfo');if(bankInfo){bankInfo.innerHTML=`<strong>${esc(s.bankName)}</strong><br><span>${esc(s.bankAccountName)}</span><br><span>Account: ${esc(s.bankAccountNumber)}</span>`;}}await loadTransactionsPage()}catch(e){if(e.message.includes('session'))logout();else toast(e.message)}}
async function loadDepositPage(){if(!token()){location.href='/login.html';return}const params=new URLSearchParams(location.search);const queryAmount=Number(params.get('amount'));const storedAmount=Number(localStorage.getItem('rv_pending_deposit_amount'));const amount=Number.isFinite(queryAmount)&&queryAmount>0?queryAmount:(Number.isFinite(storedAmount)&&storedAmount>0?storedAmount:0);if(!amount){location.href='/wallet.html';return}const exact=document.getElementById('depositExactAmount');if(exact)exact.textContent=money(amount);try{const d=await api('/wallet/deposit-info');const bank=document.getElementById('depositBankName'),name=document.getElementById('depositAccountName'),acct=document.getElementById('depositAccountNumber');if(bank)bank.textContent=d.bankName||'—';if(name)name.textContent=d.accountName||'—';if(acct)acct.textContent=d.accountNumber||'—';await loadTransactionsPage()}catch(e){const bank=document.getElementById('depositBankName');if(bank)bank.textContent='Unable to load';toast(e.message)}}
async function loadDepositInfo(){const bank=document.getElementById('depositBankName');if(!bank)return;try{const d=await api('/wallet/deposit-info');document.getElementById('depositBankName').textContent=d.bankName;document.getElementById('depositAccountName').textContent=d.accountName;document.getElementById('depositAccountNumber').textContent=d.accountNumber}catch(e){toast(e.message)}}


function withdrawalHoursOpen(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',hour12:false}).formatToParts(new Date());const h=Number(parts.find(p=>p.type==='hour')?.value);return Number.isFinite(h)&&h>=10&&h<16;}

function toast(t){const x=document.getElementById('toast');if(!x)return alert(t);x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',3000)}
function formatCountdown(seconds){seconds=Math.max(0,Number(seconds)||0);const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
let activeInvestmentTimer=null;
function renderActiveInvestments(items){
  const el=document.getElementById('activeInvestments');
  if(!el)return;

  const activeItems=items.filter(x=>x.status==='active');
  const completedItems=items.filter(x=>x.status==='completed');

  const activeMarkup=activeItems.length
    ? activeItems.map(x=>{
      const circumference=2*Math.PI*48;
      const cycleSeconds=86400;
      const seconds=Number(x.seconds_remaining||0);
      const offset=x.claimable?0:Math.min(circumference,circumference*(seconds/cycleSeconds));
      const status='ACTIVE';
      const displayDay=Math.min(Number(x.current_day||1),Number(x.term_days||0));
      const claim=x.claimable
        ? `<button class="btn gold full" onclick="claimInvestment('${x.id}')">CLAIM NOW</button>`
        : `<button class="btn ghost full" disabled>CLAIM IN ${formatCountdown(seconds)}</button>`;
      return `<article class="active-investment-card" data-id="${x.id}" data-created="${new Date(x.created_at).getTime()}" data-term="${x.term_days}" data-next="${new Date(x.next_claim_at).getTime()}" data-claimable="${x.claimable?'1':'0'}" data-status="active"><div class="active-card-head"><div><span class="eyebrow">${esc(x.plan)}</span><h3>${money(x.amount)}</h3><p class="muted">${(Number(x.daily_rate)*100).toFixed(1)}% daily · ${x.term_days} days</p></div><span class="status-chip">${status}</span></div><div class="claim-circle" style="--ring-offset:${offset}"><svg viewBox="0 0 110 110" aria-hidden="true"><circle class="ring-bg" cx="55" cy="55" r="48"></circle><circle class="ring-progress" cx="55" cy="55" r="48"></circle></svg><div class="claim-circle-text"><b class="countdown">${x.claimable?'READY':formatCountdown(seconds)}</b><small>${x.claimable?'Profit ready':'Next claim'}</small></div></div><div class="claim-stats"><div><small>Daily Profit</small><b>${money(x.daily_profit)}</b></div><div><small>Day</small><b class="investment-day">${displayDay}/${x.term_days}</b></div><div><small>Total Earned</small><b>${money(x.total_earned)}</b></div></div>${claim}</article>`;
    }).join('')
    : `<div class="empty-state">You have no active investments yet. Choose a plan to get started.</div>`;

  const historyMarkup=completedItems.length
    ? `<section class="completed-history"><div class="panelhead completed-history-head"><div><span class="eyebrow">COMPLETED HISTORY</span><h2>Completed Plans</h2><p class="muted">Your successfully completed investment plans.</p></div></div><div class="completed-history-list">${completedItems.map(x=>`<article class="completed-plan-card"><div class="completed-plan-title">${esc(x.plan)} plan</div><p>You have successfully completed your ${esc(String(x.plan).toLowerCase())} plan!</p><div class="completed-done">✅ Done</div></article>`).join('')}</div></section>`
    : '';

  el.innerHTML=`<div class="active-investments-list">${activeMarkup}</div>${historyMarkup}`;
  startActiveInvestmentTimer();
}

function startActiveInvestmentTimer(){
  if(activeInvestmentTimer)clearInterval(activeInvestmentTimer);
  activeInvestmentTimer=setInterval(()=>{
    document.querySelectorAll('.active-investment-card').forEach(card=>{
      const next=Number(card.dataset.next);
      const created=Number(card.dataset.created);
      const term=Number(card.dataset.term||0);
      const elapsed=Math.max(0,Math.floor((Date.now()-created)/1000));
      const day=Math.min(Math.floor(elapsed/86400)+1,term);
      const seconds=Math.max(0,Math.ceil((next-Date.now())/1000));
      const countdown=card.querySelector('.countdown');
      const dayEl=card.querySelector('.investment-day');
      const button=card.querySelector('.btn');
      if(dayEl)dayEl.textContent=`${day}/${term}`;
      if(seconds<=0&&card.dataset.claimable!=='1'){
        card.dataset.claimable='1';
        if(countdown)countdown.textContent='READY';
        if(card.querySelector('.claim-circle-text small'))card.querySelector('.claim-circle-text small').textContent='Profit ready';
        const ring=card.querySelector('.ring-progress');
        if(ring)ring.style.strokeDashoffset='0';
        if(button){button.disabled=false;button.textContent='CLAIM NOW';button.className='btn gold full';button.onclick=()=>claimInvestment(card.dataset.id);}
      }else if(seconds>0&&countdown){
        countdown.textContent=formatCountdown(seconds);
        const ring=card.querySelector('.ring-progress');
        if(ring)ring.style.strokeDashoffset=(301.59*(seconds/86400)).toFixed(2);
      }
    });
  },1000);
}

async function claimInvestment(id){try{const d=await api('/investments/'+id+'/claim',{method:'POST'});toast(`Claimed ${money(d.profit)} profit`);await loadActiveInvestments();if(typeof loadDash==='function')loadDash()}catch(e){toast(e.message);await loadActiveInvestments()}}
async function loadActiveInvestments(){const el=document.getElementById('activeInvestments');if(!el)return;try{const d=await api('/investments');renderActiveInvestments(d.items);}catch(e){el.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function loadUserInvestments(){return loadActiveInvestments();}
async function loadTransactionsPage(){const el=document.getElementById('transactions');if(!el)return;try{const d=await api('/transactions');el.innerHTML=tableTx(d.items)}catch(e){el.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function loadProfilePage(){try{const {user}=await api('/me');const userId=document.getElementById('profileUserId');if(userId)userId.textContent=user.user_id||'—';const name=document.getElementById('profileFullName');if(name)name.textContent=user.name;const email=document.getElementById('email');if(email)email.textContent=user.email;document.querySelectorAll('#kyc,#kycBig').forEach(x=>x.textContent='KYC '+user.kyc_status);const m=document.getElementById('kycMessage');if(m)m.textContent=user.kyc_status==='verified'?'Your account is verified.':''}catch(e){if(e.message.includes('session'))logout()}}
function pageUserNav(){const path=location.pathname.split('/').pop()||'dashboard.html';document.querySelectorAll('.side-nav a,.bottom-nav a').forEach(a=>{a.classList.toggle('active',a.getAttribute('href')==='/'+path)})}
async function loadReferrals(){if(!token()){location.href='/login.html';return}try{const d=await api('/referrals');const ref=document.getElementById('refCode');if(ref)ref.textContent=d.referralCode||'—';const referralLink=document.getElementById('referralLink');if(referralLink){referralLink.textContent=`${location.origin}/register.html?ref=${encodeURIComponent(d.referralCode||'')}`;}const copyReferralLink=document.getElementById('copyReferralLink');if(copyReferralLink){copyReferralLink.onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}/register.html?ref=${encodeURIComponent(d.referralCode||'')}`);toast('Referral link copied');}catch(e){toast('Unable to copy link');}};}const l1=document.getElementById('l1Count');if(l1)l1.textContent=Number(d.levels?.level1?.count||0);const l2=document.getElementById('l2Count');if(l2)l2.textContent=Number(d.levels?.level2?.count||0);const total=document.getElementById('refTotal');if(total)total.textContent=money(d.commissions.total);const render=(items)=>items.length?`<table><thead><tr><th>Name</th><th>Email</th><th>Registration</th><th>Investment Plan</th><th>Total Invested</th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td><td>${date(x.created_at)}</td><td>${esc(x.investment_plan)}</td><td>${money(x.total_invested)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No downline users yet.</div>';const a=document.getElementById('level1');if(a)a.innerHTML=render(d.levels.level1.items);const b=document.getElementById('level2');if(b)b.innerHTML=render(d.levels.level2.items);const ch=document.getElementById('commissionHistory');if(ch){const items=d.commissions.items||[];ch.innerHTML=items.length?`<table><thead><tr><th>Type</th><th>From</th><th>Plan</th><th>Rate</th><th>Amount</th><th>Date</th></tr></thead><tbody>${items.map(x=>`<tr><td>Level ${x.level} Referral Bonus</td><td><b>${esc(x.source_name)}</b></td><td>${esc(x.plan||'—')}</td><td>${(Number(x.rate)*100).toFixed(1)}%</td><td>${money(x.amount)}</td><td>${date(x.created_at)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No referral commissions yet.</div>';}const cs=document.getElementById('commissionSummary');if(cs)cs.innerHTML=d.commissions.byLevel.length?`<table><thead><tr><th>Level</th><th>Rate</th><th>Commissions</th><th>Total Earned</th></tr></thead><tbody>${d.commissions.byLevel.map(x=>`<tr><td>Level ${x.level}</td><td>${(x.level===1?5:2)}%</td><td>${x.count}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No referral commissions yet.</div>';const name=await api('/me');const av=document.getElementById('avatar');if(av)av.textContent=(name.user.name||'R').charAt(0).toUpperCase();const pn=document.getElementById('profileName');if(pn)pn.textContent=name.user.name;}catch(e){if(e.message.includes('session'))logout();else toast(e.message)}}

let adminState={users:[],transactions:[],investments:[],activity:[],tiers:[],giftcodes:[],vip:[],bankAccounts:[],referralRankings:[]};
async function loadAdmin(){
  try{
    const [st,tx,u,inv,act,ba]=await Promise.all([api('/admin/stats'),api('/admin/transactions'),api('/admin/users'),api('/admin/investments'),api('/admin/activity'),api('/admin/bank-accounts')]);
    adminState={...adminState,users:u.items||[],transactions:tx.items||[],investments:inv.items||[],activity:act.items||[],bankAccounts:ba.items||[]};
    document.getElementById('sUsers').textContent=st.users; document.getElementById('sInvested').textContent=money(st.invested); document.getElementById('sPending').textContent=st.pending; document.getElementById('sWallet').textContent=money(st.wallet); document.getElementById('sApprovedDeposits').textContent=money(st.approvedDeposits); document.getElementById('sApprovedWithdrawals').textContent=money(st.approvedWithdrawals);
    renderUsers();renderTransactions();renderInvestments();renderActivity();renderOverview();renderBankAccounts();loadSettings();loadHealth();
  }catch(e){alert(e.message);if(e.message.includes('access')||e.message.includes('Authentication')||e.message.includes('session'))logout()}
}
function showSection(name){document.querySelectorAll('.admin-section').forEach(x=>x.classList.remove('active'));const sec=document.getElementById('section-'+name);if(sec)sec.classList.add('active');document.querySelectorAll('.admin-nav').forEach(x=>x.classList.toggle('active',x.dataset.section===name));const titles={overview:'Dashboard',users:'Users','referral-rankings':'Referral Rankings',investments:'Investments',deposits:'Deposits',withdrawals:'Withdrawals','bank-accounts':'Bank Accounts',kyc:'KYC Review',tiers:'Task Tiers',giftcodes:'Gift Codes',products:'Products',support:'Support',reports:'Reports',settings:'Settings & Website',roles:'Roles',vip:'VIP Levels',income:'Income Cron',health:'System Health',notifications:'Notifications',telegram:'Telegram Bot',activity:'Logs'};document.getElementById('sectionTitle').textContent=titles[name]||'Dashboard';if(name==='bank-accounts')loadBankAccounts();if(name==='referral-rankings')loadReferralRankings();window.scrollTo({top:0,behavior:'smooth'});}
document.querySelectorAll('.admin-nav').forEach(x=>x.addEventListener('click',()=>showSection(x.dataset.section)));
function statusChip(s){return `<span class="status-chip ${s}">${s}</span>`}
async function loadReferralRankings(){try{const d=await api('/admin/referral-rankings');adminState.referralRankings=d.items||[];renderReferralRankings();}catch(e){const el=document.getElementById('referralRankingsTable');if(el)el.innerHTML='<div class="empty-state">Unable to load referral rankings.</div>';}}
function renderReferralRankings(){const el=document.getElementById('referralRankingsTable');if(!el)return;const q=(document.getElementById('referralRankingSearch')?.value||'').trim().toLowerCase();const all=adminState.referralRankings||[];const items=q?all.filter(x=>String(x.user_id||'').toLowerCase().includes(q)||String(x.id||'').toLowerCase().includes(q)||String(x.email||'').toLowerCase().includes(q)):all;el.innerHTML=items.length?`<table><thead><tr><th>#</th><th>User Email / ID</th><th>Ref. Earnings</th><th>Level 1</th><th>Level 2</th></tr></thead><tbody>${items.map((x,i)=>`<tr><td><b>${i+1}</b></td><td><b>${esc(x.email||'—')}</b><br><small>ID: ${esc(x.user_id||x.id||'—')}</small></td><td><b>${money(x.referral_earnings)}</b></td><td>${x.level1_count}</td><td>${x.level2_count}</td></tr>`).join('')}</tbody></table>`:(q?'<div class="empty-state">No users found for that ID or email.</div>':'<div class="empty-state">No referral data found.</div>')}
function renderUsers(){const q=(document.getElementById('userSearch')?.value||'').toLowerCase();const k=document.getElementById('kycFilter')?.value||'all';let items=adminState.users.filter(x=>(!q||`${x.user_id||''} ${x.id||''} ${x.name||''} ${x.email||''}`.toLowerCase().includes(q))&&(!document.getElementById('section-kyc').classList.contains('active')||k==='all'||x.kyc_status===k));const usersEl=document.getElementById('users');if(usersEl)usersEl.innerHTML=items.length?`<table><thead><tr><th>User</th><th>User ID</th><th>Role</th><th>KYC</th><th>Wallet</th><th>Profit</th><th>Current Investment</th><th>WhatsApp/Telegram</th><th>Joined</th><th>Actions</th><th>Account Recovery</th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.email)}</small></td><td><b>${esc(x.user_id||'—')}</b></td><td>${x.role}</td><td>${statusChip(x.kyc_status)}</td><td>${money(x.wallet)}</td><td>${money(x.profit)}</td><td>${(x.current_investments&&x.current_investments.length)?x.current_investments.map(i=>`<b>${esc(i.plan||'Investment')}</b><br><small>${money(i.amount)}</small>`).join('<hr style="margin:6px 0;border:0;border-top:1px solid var(--line)">'):'—'}</td><td><b>WhatsApp:</b> ${esc(x.whatsapp_link||'—')}<br><b>Telegram:</b> ${esc(x.telegram_link||'—')}</td><td>${date(x.created_at)}</td><td>${x.role==='user'?`<div class="row-actions"><button class="smallbtn" onclick="kyc(${x.id},'verified')">Verify</button><button class="smallbtn danger" onclick="kyc(${x.id},'rejected')">Reject</button></div>`:'—'}</td><td>${x.role==='user'?`<div class="row-actions recovery-actions"><button class="smallbtn" onclick="clearUserPin(${x.id})">Clear PIN</button><button class="smallbtn" onclick="generateUserPassword(${x.id})">Generate Password</button></div>`:'—'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No users match this filter.</div>';const kyc=document.getElementById('kycTable');if(kyc)kyc.innerHTML=items.filter(x=>x.role==='user').length?`<table><thead><tr><th>User</th><th>Email</th><th>Status</th><th>Wallet</th><th>Action</th></tr></thead><tbody>${items.filter(x=>x.role==='user').map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${statusChip(x.kyc_status)}</td><td>${money(x.wallet)}</td><td><div class="row-actions"><button class="smallbtn" onclick="kyc(${x.id},'verified')">Verify</button><button class="smallbtn danger" onclick="kyc(${x.id},'rejected')">Reject</button></div></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No KYC records match this filter.</div>'}
async function loadBankAccounts(){try{const d=await api('/admin/bank-accounts');adminState.bankAccounts=d.items||[];renderBankAccounts();}catch(e){const el=document.getElementById('bankAccountsTable');if(el)el.innerHTML='<div class="empty-state">Unable to load bound bank accounts.</div>';}}
function renderBankAccounts(){const el=document.getElementById('bankAccountsTable');if(!el)return;const items=adminState.bankAccounts||[];el.innerHTML=items.length?`<table><thead><tr><th>User</th><th>Bind Account</th><th>Date</th><th>Wallet</th><th>Password</th><th>Withdrawal PIN</th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.email)}</small><br><small>ID: ${esc(x.user_id||'—')}</small></td><td><b>Bank: ${esc(x.bank_name||'—')}</b><br><small>Account Name: ${esc(x.bank_account_name||'—')}</small><br><small>Account Number: ${esc(x.bank_account_number||'—')}</small></td><td>${date(x.bank_bound_at||x.created_at)}</td><td><b>${money(x.wallet)}</b></td><td>${x.has_password?'Set ✓':'Not Set'}</td><td>${x.has_withdrawal_pin?'Set ✓':'Not Set'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No users have bound a bank account yet.</div>'}
function renderTransactions(){const depFilter=document.getElementById('depositFilter')?.value||'all', witFilter=document.getElementById('withdrawalFilter')?.value||'all';const deposits=adminState.transactions.filter(x=>x.type==='deposit'&&(depFilter==='all'||x.status===depFilter));const withdrawals=adminState.transactions.filter(x=>x.type==='withdrawal'&&(witFilter==='all'||x.status===witFilter));const depEl=document.getElementById('depositsTable'),witEl=document.getElementById('withdrawalsTable');if(depEl)depEl.innerHTML=transactionTable(deposits,'deposit');if(witEl)witEl.innerHTML=transactionTable(withdrawals,'withdrawal');}
function transactionTable(items,type){if(!items.length)return '<div class="empty-state">No requests found.</div>';return `<table><thead><tr><th>User</th><th>Amount</th><th>${type==='deposit'?'Payer / Method':'Bank / Account'}</th><th>Reference</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.email)}</small></td><td><b>${money(x.amount)}</b></td><td>${type==='deposit'?`${esc(x.payer_account_name||'—')}<br><small>Acct: ${esc(x.payer_account_number||'—')} • ${esc(x.payment_method||'bank transfer')}</small>`:`${esc(x.bank_name||'—')}<br><small>${esc(x.account_name||'')} ${x.account_number?'• '+esc(x.account_number):''}</small>`}</td><td>${esc(x.reference||'—')}</td><td>${date(x.created_at)}</td><td>${statusChip(x.status)}</td><td>${x.status==='pending'?`<div class="row-actions approval-actions"><button class="smallbtn" onclick="review(${x.id},'approve')">Approve</button><span class="approval-separator">|</span><button class="smallbtn danger" onclick="review(${x.id},'reject')">Reject</button></div>`:'—'}</td></tr>`).join('')}</tbody></table>`}
function renderInvestments(){const f=document.getElementById('investmentFilter')?.value||'all';const items=adminState.investments.filter(x=>f==='all'||x.status===f);const el=document.getElementById('investmentsTable');if(!el)return;el.innerHTML=items.length?`<table><thead><tr><th>User</th><th>Plan</th><th>Amount</th><th>Daily rate</th><th>Earned</th><th>Claims completed</th><th>Term</th><th>Status</th><th>Started</th><th>Action</th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.email)}</small></td><td>${esc(x.plan)}</td><td>${money(x.amount)}</td><td>${(Number(x.daily_rate)*100).toFixed(2)}%</td><td>${money(x.total_earned)}</td><td><b>${Number(x.claim_count||0)}</b></td><td>${x.term_days} days</td><td>${statusChip(x.status)}</td><td>${date(x.created_at)}</td><td>${x.status==='active'?`<button type="button" class="smallbtn danger" onclick="endInvestment(${x.id})">End Plan</button>`:'Completed'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No investments found.</div>'}
function renderActivity(){const el=document.getElementById('activityTable');if(!el)return;el.innerHTML=adminState.activity.length?`<table><thead><tr><th>Action</th><th>Admin</th><th>Target</th><th>Details</th><th>Date</th></tr></thead><tbody>${adminState.activity.map(x=>`<tr><td><b>${esc(x.action)}</b></td><td>${esc(x.name||'Administrator')}<br><small>${esc(x.email||'')}</small></td><td>${esc(x.target_type||'—')} ${esc(x.target_id||'')}</td><td>${esc(x.details||'—')}</td><td>${date(x.created_at)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No admin activity has been recorded yet.</div>'}
function renderOverview(){const pending=adminState.transactions.filter(x=>x.status==='pending');(document.getElementById('overviewPending') || {}).innerHTML=pending.length?`<div class="compact-table table"><table><thead><tr><th>User</th><th>Type</th><th>Amount</th><th>Action</th></tr></thead><tbody>${pending.slice(0,6).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.type}</td><td>${money(x.amount)}</td><td><button class="smallbtn" onclick="review(${x.id},'approve')">Approve</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">No pending requests.</div>';(document.getElementById('overviewActivity') || {}).innerHTML=adminState.activity.length?`<div class="activity-mini">${adminState.activity.slice(0,6).map(x=>`<p><b>${esc(x.action)}</b><br><small>${esc(x.details||'')} · ${date(x.created_at)}</small></p>`).join('')}</div>`:'<div class="empty-state">No recent admin activity.</div>'}
async function endInvestment(id){const inv=adminState.investments.find(x=>String(x.id)===String(id));if(!inv)return;const plan=inv.plan||'investment';const email=inv.email||'this user';if(!confirm(`End the ${plan} investment for ${email} now?\n\nThe plan will be marked completed immediately and the user will NOT receive any remaining daily profits.`))return;try{await api('/admin/investments/'+id+'/complete',{method:'POST'});await loadAdmin();toast('Investment ended and marked completed')}catch(e){alert(e.message)}}
async function review(id,a){try{await api('/admin/transactions/'+id+'/'+a,{method:'POST'});await loadAdmin();toast(a==='approve'?'Request approved':'Request rejected')}catch(e){alert(e.message)}}
async function kyc(id,status){try{await api('/admin/users/'+id+'/kyc',{method:'POST',body:JSON.stringify({status})});await loadAdmin();toast('KYC status updated')}catch(e){alert(e.message)}}
async function loadTiers(){try{const d=await api('/admin/task-tiers');adminState.tiers=d.items||[];(document.getElementById('tiersTable') || {}).innerHTML=adminState.tiers.length?`<table><thead><tr><th>Tier</th><th>Price (₦)</th><th>Tasks/Day</th><th>Pay/Task (₦)</th><th>Daily Earning</th><th>Save</th></tr></thead><tbody>${adminState.tiers.map(x=>`<tr><td><b>${esc(x.label)}</b><br><small>${esc(x.tier_key)}</small></td><td><input id="tier-price-${esc(x.tier_key)}" type="number" value="${Number(x.price)}"></td><td><input id="tier-tasks-${esc(x.tier_key)}" type="number" min="0" value="${Number(x.tasks_per_day)}"></td><td><input id="tier-pay-${esc(x.tier_key)}" type="number" min="0" value="${Number(x.pay_per_task)}"></td><td>${money(Number(x.tasks_per_day)*Number(x.pay_per_task))}</td><td><button class="smallbtn" onclick="saveTier('${esc(x.tier_key)}')">Save</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No task tiers found.</div>'}catch(e){(document.getElementById('tiersTable') || {}).innerHTML='<div class="empty-state">Unable to load task tiers.</div>';}}
async function saveTier(key){try{const p=Number(document.getElementById('tier-price-'+key).value),t=Number(document.getElementById('tier-tasks-'+key).value),pay=Number(document.getElementById('tier-pay-'+key).value);await api('/admin/task-tiers/'+encodeURIComponent(key),{method:'PUT',body:JSON.stringify({price:p,tasksPerDay:t,payPerTask:pay})});await loadTiers();toast('Task tier updated')}catch(e){alert(e.message)}}
async function loadGiftCodes(){try{const d=await api('/admin/gift-codes');adminState.giftcodes=d.items||[];(document.getElementById('giftTable') || {}).innerHTML=adminState.giftcodes.length?`<table><thead><tr><th>Code</th><th>Amount</th><th>Used</th><th>Max Uses</th><th>Status</th></tr></thead><tbody>${adminState.giftcodes.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${money(x.amount)}</td><td>${x.used_count}</td><td>${x.max_uses}</td><td>${x.active?'Active':'Inactive'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No gift codes yet.</div>'}catch(e){(document.getElementById('giftTable') || {}).innerHTML='<div class="empty-state">Unable to load gift codes.</div>';}}
async function createGiftCode(){try{const code=document.getElementById('giftCode').value,amount=Number(document.getElementById('giftAmount').value),maxUses=Number(document.getElementById('giftUses').value);await api('/admin/gift-codes',{method:'POST',body:JSON.stringify({code,amount,maxUses})});document.getElementById('giftCode').value='';document.getElementById('giftAmount').value='';await loadGiftCodes();toast('Gift code created')}catch(e){alert(e.message)}}
function renderProducts(){
  const plans=adminState._settings?.plans||{};
  const names=['Starter','Growth','Premium','Advance','Mentor','Supreme'];
  const rows=names.map(name=>[name,plans[name]]);
  const activeUserCounts={};
  adminState.investments.filter(i=>i.status==='active').forEach(i=>{
    const plan=String(i.plan||'');
    if(!activeUserCounts[plan]) activeUserCounts[plan]=new Set();
    if(i.user_id!=null) activeUserCounts[plan].add(String(i.user_id));
    else if(i.email) activeUserCounts[plan].add(String(i.email).toLowerCase());
  });
  (document.getElementById('productsTable') || {}).innerHTML=`<table><thead><tr><th>Name</th><th>Minimum</th><th>Daily ROI</th><th>Term</th><th>No. of Users</th><th>Status</th></tr></thead><tbody>${rows.map(([name,p])=>{
    const available=Boolean(p?.available);
    const userCount=activeUserCounts[name]?.size||0;
    return `<tr><td><b>${name}</b></td><td>${p?.minimum==null?'—':money(p.minimum)}</td><td>${available?(Number(p.dailyRate)*100).toFixed(1)+'%':'—'}</td><td>${available?p.termDays+' days':'—'}</td><td><b>${userCount}</b></td><td class="status">${available?'AVAILABLE':'NOT AVAILABLE'}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderRoles(){const admins=adminState.users.filter(x=>x.role==='admin');(document.getElementById('rolesTable') || {}).innerHTML=admins.length?`<table><thead><tr><th>Name</th><th>Email</th><th>ID</th></tr></thead><tbody>${admins.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.id)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No admins found.</div>'}
async function promoteAdmin(){try{const id=document.getElementById('promoteUserId').value.trim();if(!id)throw new Error('Enter a user ID');await api('/admin/users/'+encodeURIComponent(id)+'/promote',{method:'POST'});await loadAdmin();renderRoles();toast('User promoted to admin')}catch(e){alert(e.message)}}
async function clearUserPin(id){if(!confirm('Clear this user withdrawal PIN? The user will need to create a new PIN in Security.'))return;try{const d=await api('/admin/users/'+encodeURIComponent(id)+'/clear-withdrawal-pin',{method:'POST'});alert(d.message||'Withdrawal PIN cleared.');}catch(e){alert(e.message)}}
async function generateUserPassword(id){if(!confirm('Generate a new login password for this user? Their current password will stop working.'))return;try{const d=await api('/admin/users/'+encodeURIComponent(id)+'/generate-password',{method:'POST'});alert(`NEW LOGIN PASSWORD\n\n${d.temporaryPassword}\n\nGive this password to the user. They can change it anytime from Security.`);try{await navigator.clipboard.writeText(d.temporaryPassword);toast('New password generated and copied to clipboard')}catch(_){}}catch(e){alert(e.message)}}
async function loadVip(){try{const d=await api('/admin/vip-levels');adminState.vip=d.items||[];(document.getElementById('vipTable') || {}).innerHTML=adminState.vip.length?`<table><thead><tr><th>Level</th><th>Min deposit</th><th>Min investments</th><th>Min referrals</th><th>Daily bonus</th></tr></thead><tbody>${adminState.vip.map(x=>`<tr><td>${esc(x.level)}</td><td>${money(x.min_deposit)}</td><td>${x.min_investments}</td><td>${x.min_referrals}</td><td>${Number(x.daily_bonus)}%</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">No VIP levels configured.</div>'}catch(e){(document.getElementById('vipTable') || {}).innerHTML='<div class="empty-state">Unable to load VIP levels.</div>';}}
async function saveVipLevel(){try{await api('/admin/vip-levels',{method:'POST',body:JSON.stringify({level:document.getElementById('vipLevel').value,minDeposit:Number(document.getElementById('vipDeposit').value||0),minInvestments:Number(document.getElementById('vipInvestments').value||0),minReferrals:Number(document.getElementById('vipReferrals').value||0),dailyBonus:Number(document.getElementById('vipBonus').value||0)})});await loadVip();toast('VIP level saved')}catch(e){alert(e.message)}}
async function loadSettings(){try{
  const d=await api('/admin/settings');
  adminState._settings=d;
  document.getElementById('settingWithdrawal').textContent=money(d.withdrawalMin);
  document.getElementById('settingTerm').textContent='Per plan';
  const active=Object.entries(d.plans).filter(([,p])=>p.available).map(([name,p])=>`${name} ${(Number(p.dailyRate)*100).toFixed(1)}% · ${p.termDays}d`);
  document.getElementById('settingPlans').textContent=active.join(' · ')||'None configured';
  renderProducts();
}catch(e){document.getElementById('settingWithdrawal').textContent='Unavailable'}}
async function loadHealth(){try{const d=await api('/admin/health');document.getElementById('healthApi').textContent=d.api==='online'?'Online':'Unavailable';document.getElementById('healthDb').textContent=d.database==='connected'?'Connected':'Error';document.getElementById('healthAuth').textContent=d.auth==='configured'?'Configured':'Missing';}catch(e){document.getElementById('healthApi').textContent='Online';document.getElementById('healthDb').textContent='Error';document.getElementById('healthAuth').textContent='Configured'}}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}function date(v){return v?new Date(v).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}):'—'}
function csv(rows,filename){if(!rows.length)return;const keys=Object.keys(rows[0]);const body=[keys,...rows.map(r=>keys.map(k=>String(r[k]??'').replace(/"/g,'""')))];const out=body.map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([out],{type:'text/csv'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function reportRows(type){
  if(type==='users') return adminState.users.map(x=>({id:x.id,name:x.name,email:x.email,role:x.role,kyc:x.kyc_status,wallet:x.wallet,profit:x.profit,created_at:x.created_at}));
  if(type==='transactions') return adminState.transactions.map(x=>({id:x.id,user:x.email,type:x.type,amount:x.amount,status:x.status,reference:x.reference,created_at:x.created_at}));
  return adminState.investments.map(x=>({id:x.id,user:x.email,plan:x.plan,amount:x.amount,daily_rate:x.daily_rate,total_earned:x.total_earned,term_days:x.term_days,status:x.status,created_at:x.created_at}));
}
function reportTable(rows){
  if(!rows.length) return '<div class="empty-state">No records available for this report.</div>';
  const keys=Object.keys(rows[0]);
  return '<div class="report-preview-scroll"><table><thead><tr>'+keys.map(k=>`<th>${esc(k.replace(/_/g,' '))}</th>`).join('')+'</tr></thead><tbody>'+
    rows.map(r=>'<tr>'+keys.map(k=>`<td>${esc(r[k]??'—')}</td>`).join('')+'</tr>').join('')+
    '</tbody></table></div><div class="report-count">'+rows.length+' record'+(rows.length===1?'':'s')+'</div>';
}
function toggleReportPreview(type){
  const id='reportPreview'+type.charAt(0).toUpperCase()+type.slice(1);
  const el=document.getElementById(id);
  if(!el) return;
  if(!el.hidden){el.hidden=true;return;}
  el.innerHTML=reportTable(reportRows(type));
  el.hidden=false;
}
function downloadUsersCSV(){csv(reportRows('users'),'quantentunnel-users.csv')}
function downloadTransactionsCSV(){csv(reportRows('transactions'),'quantentunnel-transactions.csv')}
function downloadInvestmentsCSV(){csv(reportRows('investments'),'quantentunnel-investments.csv')}

if(document.body.classList.contains('admin')){loadAdmin();setTimeout(()=>{loadTiers();loadGiftCodes();loadVip();renderRoles();},500);}if(document.querySelector('.dash')&&!document.body.classList.contains('admin')){if(!token())location.href='/login.html';pageUserNav();const path=location.pathname.split('/').pop()||'dashboard.html';if(path==='dashboard.html')loadDash();if(path==='wallet.html'){loadDash();}
if(path==='deposit.html'){loadDepositPage();}if(path==='withdraw.html'){loadWithdraw();}if(path==='investments.html'){loadPlans();}if(path==='active-investments.html'){loadActiveInvestments();}if(path==='transactions.html')loadTransactionsPage();if(path==='profile.html')loadProfilePage();if(path==='referrals.html')loadReferrals();}const dep=document.getElementById('deposit');if(dep)dep.addEventListener('submit',e=>{e.preventDefault();const amount=Number(new FormData(dep).get('amount'));if(!Number.isFinite(amount)||amount<=0){toast('Enter a valid deposit amount');return}if(amount<3000){toast('Minimum deposit is ₦3,000');return}localStorage.setItem('rv_pending_deposit_amount',String(amount));location.href='/deposit.html?amount='+encodeURIComponent(amount)});const depConfirm=document.getElementById('depositConfirm');if(depConfirm)depConfirm.addEventListener('submit',e=>{e.preventDefault();const params=new URLSearchParams(location.search);const queryAmount=Number(params.get('amount'));const storedAmount=Number(localStorage.getItem('rv_pending_deposit_amount'));const amount=Number.isFinite(queryAmount)&&queryAmount>0?queryAmount:storedAmount;const f=new FormData(depConfirm);const payload=Object.fromEntries(f);payload.amount=amount;walletAction('deposit',depConfirm,payload)});const wit=document.getElementById('withdraw');if(wit)wit.addEventListener('submit',e=>{e.preventDefault();walletAction('withdraw',wit)});

function setAmount(id,value){const el=document.getElementById(id);if(el){el.value=value;el.focus();}}

async function loadSecurityPage(){
  if(!token()){location.href='/login.html';return}
  try{
    const {user}=await api('/me');
    const name=document.getElementById('profileName'); if(name)name.textContent=user.name;
    const av=document.getElementById('avatar'); if(av)av.textContent=(user.name||'R').trim().charAt(0).toUpperCase();
    const d=await api('/security'); const s=d.security||{};
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||''};
    set('bankName',s.bankName);set('bankAccountName',s.bankAccountName);set('bankAccountNumber',s.bankAccountNumber);set('whatsappLink',s.whatsappLink);set('telegramLink',s.telegramLink);
    const bankPinField=document.getElementById('bankCurrentPinField'); const bankPin=document.getElementById('bankCurrentWithdrawalPin');
    const hasBank=Boolean(s.bankName||s.bankAccountName||s.bankAccountNumber);
    if(bankPinField && bankPin){ bankPinField.style.display=hasBank?'grid':'none'; bankPin.required=hasBank; bankPin.disabled=!hasBank; }
    const pin=document.getElementById('pinStatus'); if(pin)pin.textContent=`Withdrawal PIN: ${s.hasWithdrawalPin?'set':'not set'}`;
    const currentPinField=document.getElementById('currentPinField');
    const currentPin=document.getElementById('currentWithdrawalPin');
    if(currentPinField && currentPin){
      currentPinField.style.display=s.hasWithdrawalPin?'grid':'none';
      currentPin.required=Boolean(s.hasWithdrawalPin);
      currentPin.disabled=!s.hasWithdrawalPin;
    }
    const socialPinField=document.getElementById('socialCurrentPinField'); const socialPin=document.getElementById('socialCurrentWithdrawalPin');
    const hasSocial=Boolean(s.whatsappLink||s.telegramLink);
    if(socialPinField && socialPin){ socialPinField.style.display=hasSocial?'grid':'none'; socialPin.required=hasSocial; socialPin.disabled=!hasSocial; }
  }catch(e){if(e.message.includes('session'))logout();else toast(e.message)}
}
function bindSecurityForms(){
  const bank=document.getElementById('bankSecurityForm');
  if(bank)bank.addEventListener('submit',async e=>{e.preventDefault();try{await api('/security/bank',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(bank)))});toast('Bank account information saved');await loadSecurityPage();}catch(err){toast(err.message)}});
  const pin=document.getElementById('pinSecurityForm');
  if(pin)pin.addEventListener('submit',async e=>{e.preventDefault();try{const f=Object.fromEntries(new FormData(pin));await api('/security/pin',{method:'PUT',body:JSON.stringify(f)});pin.reset();const currentPin=document.getElementById('currentWithdrawalPin');const currentPinField=document.getElementById('currentPinField');if(currentPin){currentPin.required=true;currentPin.disabled=false;}if(currentPinField)currentPinField.style.display='grid';const st=document.getElementById('pinStatus');if(st)st.textContent='Withdrawal PIN: set';toast('Withdrawal PIN saved');}catch(err){toast(err.message)}});
  const social=document.getElementById('socialSecurityForm');
  if(social)social.addEventListener('submit',async e=>{e.preventDefault();try{await api('/security/socials',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(social)))});toast('Messaging links saved');await loadSecurityPage();}catch(err){toast(err.message)}});
  const password=document.getElementById('passwordSecurityForm');
  if(password)password.addEventListener('submit',async e=>{e.preventDefault();try{const f=Object.fromEntries(new FormData(password));if(f.newPassword!==f.confirmPassword)throw new Error('New passwords do not match');await api('/security/password',{method:'PUT',body:JSON.stringify({currentPassword:f.currentPassword,newPassword:f.newPassword})});password.reset();toast('Password changed successfully. Please sign in again.');setTimeout(logout,1000);}catch(err){toast(err.message)}});
}
if(document.getElementById('securityGrid')){loadSecurityPage();bindSecurityForms();}
