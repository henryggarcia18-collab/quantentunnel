const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Vercel routes /api/* to this Express function. Strip the /api prefix
// before Express matches the application routes (e.g. /api/auth/login -> /auth/login).
app.use((req, res, next) => {
  if (req.url === '/api') req.url = '/';
  else if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
  next();
});

const DATABASE_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEPOSIT_BANK_NAME = process.env.DEPOSIT_BANK_NAME || 'YOUR BANK NAME';
const DEPOSIT_ACCOUNT_NAME = process.env.DEPOSIT_ACCOUNT_NAME || 'YOUR ACCOUNT NAME';
const DEPOSIT_ACCOUNT_NUMBER = process.env.DEPOSIT_ACCOUNT_NUMBER || '0000000000';
const DEPOSIT_PHONE_NUMBER = process.env.DEPOSIT_PHONE_NUMBER || 'YOUR PHONE NUMBER';
const WITHDRAWAL_MIN = Number(process.env.WITHDRAWAL_MIN || 2000);
const DEPOSIT_MIN = 3000;

function isWithdrawalWindowOpen() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  return Number.isFinite(hour) && hour >= 10 && hour < 16;
}

const INVESTMENT_DAILY_RATE = Number(process.env.INVESTMENT_DAILY_RATE || 0);
const INVESTMENT_TERM_DAYS = Number(process.env.INVESTMENT_TERM_DAYS || 30);

// Investment plans: Starter, Growth and Premium are configured by default.
// Advance, Mentor and Supreme remain unavailable until explicitly enabled.
const PLAN_STARTER_RATE = Number(process.env.PLAN_STARTER_RATE ?? 0.10);
const PLAN_GROWTH_RATE = Number(process.env.PLAN_GROWTH_RATE ?? 0.05);
const PLAN_PREMIUM_RATE = 0.04;
const PLAN_STARTER_TERM_DAYS = Number(process.env.PLAN_STARTER_TERM_DAYS ?? 15);
const PLAN_GROWTH_TERM_DAYS = Number(process.env.PLAN_GROWTH_TERM_DAYS ?? 31);
const PLAN_PREMIUM_TERM_DAYS = 41;
const CRON_SECRET = process.env.CRON_SECRET || '';
const REFERRAL_LEVEL1_RATE = 0.05;
const REFERRAL_LEVEL2_RATE = 0.02;

if (!DATABASE_URL) console.warn('Missing POSTGRES_URL/DATABASE_URL');
if (!JWT_SECRET) console.warn('Missing JWT_SECRET');

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL && !DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false
});

let schemaPromise;
function initSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!DATABASE_URL) throw new Error('Database is not configured');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        kyc_status TEXT NOT NULL DEFAULT 'pending',
        wallet NUMERIC(18,2) NOT NULL DEFAULT 0,
        profit NUMERIC(18,2) NOT NULL DEFAULT 0,
        referral_code TEXT UNIQUE,
        referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS investments (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        daily_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        last_credited_at TIMESTAMPTZ,
        total_earned NUMERIC(18,2) NOT NULL DEFAULT 0,
        term_days INTEGER NOT NULL DEFAULT 30,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reference TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE investments ADD COLUMN IF NOT EXISTS claim_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE investments ADD COLUMN IF NOT EXISTS last_claimed_at TIMESTAMPTZ;
      ALTER TABLE investments ADD COLUMN IF NOT EXISTS last_claim_cycle INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_investments_user ON investments(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        admin_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
      CREATE TABLE IF NOT EXISTS task_tiers (
        id BIGSERIAL PRIMARY KEY,
        tier_key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        price NUMERIC(18,2) NOT NULL DEFAULT 0,
        tasks_per_day INTEGER NOT NULL DEFAULT 0,
        pay_per_task NUMERIC(18,2) NOT NULL DEFAULT 0,
        sort_order INTEGER UNIQUE NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gift_codes (
        id BIGSERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS vip_levels (
        id BIGSERIAL PRIMARY KEY,
        level TEXT UNIQUE NOT NULL,
        min_deposit NUMERIC(18,2) NOT NULL DEFAULT 0,
        min_investments INTEGER NOT NULL DEFAULT 0,
        min_referrals INTEGER NOT NULL DEFAULT 0,
        daily_bonus NUMERIC(10,4) NOT NULL DEFAULT 0
      );
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_account_name TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_account_number TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_note TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_name TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_name TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_number TEXT;
      -- Keep investment purchases in the transaction history. This also backfills
      -- investment records created before this transaction entry was added.
      INSERT INTO transactions(user_id,type,amount,status,reference,payment_method,payment_note,created_at)
      SELECT i.user_id,'investment',i.amount,'approved','INV-' || i.id,'wallet',('Investment purchase - ' || i.plan),i.created_at
      FROM investments i
      WHERE NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.user_id=i.user_id AND t.reference='INV-' || i.id
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_pin_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_link TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_bound_at TIMESTAMPTZ;
      CREATE SEQUENCE IF NOT EXISTS royalvest_user_id_seq START WITH 100000 MINVALUE 100000 MAXVALUE 999999 NO CYCLE;
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT id FROM users WHERE user_id IS NULL ORDER BY id LOOP
          UPDATE users SET user_id = LPAD(nextval('royalvest_user_id_seq')::text, 6, '0') WHERE id = r.id;
        END LOOP;
      END $$;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
      CREATE OR REPLACE FUNCTION royalvest_assign_user_id() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id IS NULL OR NEW.user_id = '' THEN
          NEW.user_id := LPAD(nextval('royalvest_user_id_seq')::text, 6, '0');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_users_user_id ON users;
      CREATE TRIGGER trg_users_user_id BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION royalvest_assign_user_id();
      UPDATE users SET referral_code = 'ROYAL' || LPAD(id::text, 6, '0') WHERE referral_code IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
      CREATE TABLE IF NOT EXISTS referral_commissions (
        id BIGSERIAL PRIMARY KEY,
        source_investment_id BIGINT NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
        beneficiary_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        level INTEGER NOT NULL CHECK(level IN (1,2)),
        rate NUMERIC(10,4) NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(source_investment_id, beneficiary_user_id, level)
      );
      CREATE INDEX IF NOT EXISTS idx_referral_commissions_beneficiary ON referral_commissions(beneficiary_user_id);
    `);
    if (ADMIN_EMAIL && ADMIN_PASSWORD) {
      const existing = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [ADMIN_EMAIL]);
      if (!existing.rowCount) {
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
        await pool.query(
          `INSERT INTO users(name,email,password_hash,role,kyc_status) VALUES($1,$2,$3,'admin','verified')`,
          ['Administrator', ADMIN_EMAIL, hash]
        );
      }
    }
  })().catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}

function tokenFor(u) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ id: String(u.id), role: u.role }, JWT_SECRET, { expiresIn: '7d' });
}
function publicUserRow(row) {
  if (!row) return null;
  return { ...row, id: String(row.id), user_id: row.user_id ? String(row.user_id) : null, wallet: Number(row.wallet), profit: Number(row.profit), referral_code: row.referral_code || null, referred_by: row.referred_by ? String(row.referred_by) : null };
}
async function getUser(id) {
  const r = await pool.query(`SELECT id,user_id,name,email,role,kyc_status,wallet,profit,referral_code,referred_by,created_at FROM users WHERE id=$1`, [id]);
  return publicUserRow(r.rows[0]);
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Authentication required' });
  try { req.auth = jwt.verify(t, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
}
function admin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
function fail(res, err) {
  console.error(err);
  return res.status(500).json({ error: 'Server error' });
}

async function audit(adminId, action, targetType='', targetId='', details='') {
  try { await pool.query('INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)', [adminId,action,targetType,String(targetId||''),details]); } catch(e) { console.error('Audit log failed', e); }
}

async function accrueUserInvestments(userId) {
  // Each investment stores its own daily_rate and term_days.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query(`SELECT * FROM investments WHERE user_id=$1 AND status='active' FOR UPDATE`, [userId]);
    let credited = 0;
    for (const inv of rows.rows) {
      const last = inv.last_credited_at ? new Date(inv.last_credited_at) : new Date(inv.created_at);
      const now = new Date();
      const elapsedDays = Math.floor((now-last)/86400000);
      if (elapsedDays < 1) continue;
      const daysRemaining = Math.max(0, Number(inv.term_days || INVESTMENT_TERM_DAYS) - Math.floor((now-new Date(inv.created_at))/86400000));
      const days = Math.min(elapsedDays, daysRemaining);
      if (days <= 0) {
        await client.query(`UPDATE investments SET status='completed' WHERE id=$1`, [inv.id]);
        continue;
      }
      const rate = Number(inv.daily_rate);
      const profit = Number(inv.amount) * rate * days;
      if (profit <= 0) {
        await client.query(`UPDATE investments SET last_credited_at=NOW() WHERE id=$1`, [inv.id]);
        continue;
      }
      await client.query(`UPDATE users SET wallet=wallet+$1, profit=profit+$1 WHERE id=$2`, [profit, userId]);
      await client.query(`UPDATE investments SET total_earned=total_earned+$1,last_credited_at=NOW(),status=CASE WHEN EXTRACT(EPOCH FROM (NOW()-created_at))/86400 >= term_days THEN 'completed' ELSE status END WHERE id=$2`, [profit, inv.id]);
      await client.query(`INSERT INTO transactions(user_id,type,amount,status,reference,payment_note) VALUES($1,'profit',$2,'approved',$3,'Investment earnings credited automatically')`, [userId, profit, 'EARN-'+Date.now()+'-'+inv.id]);
      credited += profit;
    }
    await client.query('COMMIT');
    return credited;
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); throw e; } finally { client.release(); }
}

app.get('/', (req,res) => res.json({ ok:true, service:'QuantenTunnel API' }));

app.post('/auth/register', async (req,res) => {
  try {
    await initSchema();
    const { name, email, password } = req.body || {};
    const referralCode = String(req.body?.referralCode || '').trim().toUpperCase();
    if (!name || !email || !password || String(password).length < 8)
      return res.status(400).json({ error:'Name, email and an 8+ character password are required' });
    let referredBy = null;
    if (referralCode) {
      const rr = await pool.query('SELECT id FROM users WHERE referral_code=$1 LIMIT 1', [referralCode]);
      if (!rr.rowCount) return res.status(400).json({ error:'Invalid referral code' });
      referredBy = rr.rows[0].id;
    }
    const hash = await bcrypt.hash(password, 12);
    const base = String(name).trim().replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0,8) || 'ROYAL';
    let code = `${base}${Math.floor(1000 + Math.random()*9000)}`;
    for (let i=0;i<10;i++) { const x=await pool.query('SELECT 1 FROM users WHERE referral_code=$1',[code]); if(!x.rowCount) break; code=`${base}${Math.floor(10000 + Math.random()*90000)}`; }
    const r = await pool.query(
      `INSERT INTO users(name,email,password_hash,referral_code,referred_by) VALUES($1,$2,$3,$4,$5) RETURNING id,user_id,name,email,role,kyc_status,wallet,profit,referral_code,referred_by,created_at`,
      [String(name).trim(), String(email).trim().toLowerCase(), hash, code, referredBy]
    );
    const u = publicUserRow(r.rows[0]);
    res.json({ token: tokenFor(u), user: u });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error:'An account with that email or referral code already exists' });
    return fail(res,e);
  }
});

app.post('/auth/login', async (req,res) => {
  try {
    await initSchema();
    const { email, password } = req.body || {};
    const r = await pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1', [(email||'').trim().toLowerCase()]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return res.status(401).json({ error:'Invalid email or password' });
    const safe = publicUserRow(u);
    res.json({ token: tokenFor(safe), user: safe });
  } catch (e) { return fail(res,e); }
});

app.get('/me', auth, async (req,res) => { try { await initSchema(); res.json({user:await getUser(req.auth.id)}); } catch(e){fail(res,e);} });
app.get('/security', auth, async (req,res) => {
  try {
    await initSchema();
    const r = await pool.query(`SELECT bank_name,bank_account_name,bank_account_number,whatsapp_link,telegram_link,(withdrawal_pin_hash IS NOT NULL) AS has_withdrawal_pin FROM users WHERE id=$1`, [req.auth.id]);
    if (!r.rowCount) return res.status(404).json({error:'User not found'});
    const u = r.rows[0];
    res.json({security:{
      bankName:u.bank_name||'', bankAccountName:u.bank_account_name||'', bankAccountNumber:u.bank_account_number||'',
      whatsappLink:u.whatsapp_link||'', telegramLink:u.telegram_link||'', hasWithdrawalPin:Boolean(u.has_withdrawal_pin)
    }});
  } catch(e) { fail(res,e); }
});

app.put('/security/bank', auth, async (req,res) => {
  try {
    await initSchema();
    const bankName=String(req.body?.bankName||'').trim();
    const accountName=String(req.body?.accountName||'').trim();
    const accountNumber=String(req.body?.accountNumber||'').trim();
    const currentPin=String(req.body?.currentPin||'').trim();
    if(!bankName||!accountName||!accountNumber) return res.status(400).json({error:'Bank name, account name and account number are required'});
    if(!/^[0-9]{6,20}$/.test(accountNumber)) return res.status(400).json({error:'Enter a valid bank account number'});
    const existing=await pool.query('SELECT bank_name,bank_account_name,bank_account_number,withdrawal_pin_hash FROM users WHERE id=$1',[req.auth.id]);
    if(!existing.rowCount) return res.status(404).json({error:'User not found'});
    const u=existing.rows[0];
    const hasBank=Boolean(u.bank_name||u.bank_account_name||u.bank_account_number);
    if(hasBank){
      if(!u.withdrawal_pin_hash) return res.status(403).json({error:'You must create a withdrawal PIN before changing your bound bank account.'});
      if(!/^[0-9]{6}$/.test(currentPin)) return res.status(400).json({error:'Enter your current withdrawal PIN before changing your bank account'});
      if(!(await bcrypt.compare(currentPin,u.withdrawal_pin_hash))) return res.status(403).json({error:'Incorrect current withdrawal PIN'});
    }
    await pool.query(`UPDATE users SET bank_name=$1,bank_account_name=$2,bank_account_number=$3,bank_bound_at=NOW() WHERE id=$4`,[bankName,accountName,accountNumber,req.auth.id]);
    res.json({ok:true,message:hasBank?'Bank account information changed successfully':'Bank account information saved'});
  } catch(e) { fail(res,e); }
});

app.put('/security/pin', auth, async (req,res) => {
  try {
    await initSchema();
    const currentPin=String(req.body?.currentPin||'').trim();
    const pin=String(req.body?.pin||'').trim();
    const password=String(req.body?.password||'');
    if(!/^[0-9]{6}$/.test(pin)) return res.status(400).json({error:'New withdrawal PIN must be exactly 6 digits'});
    if(!password) return res.status(400).json({error:'Enter your account password to confirm this change'});
    const r=await pool.query('SELECT password_hash,withdrawal_pin_hash FROM users WHERE id=$1',[req.auth.id]);
    if(!r.rowCount) return res.status(404).json({error:'User not found'});
    if(r.rows[0].withdrawal_pin_hash){
      if(!/^[0-9]{6}$/.test(currentPin)) return res.status(400).json({error:'Enter your current withdrawal PIN before changing it'});
      if(!(await bcrypt.compare(currentPin,r.rows[0].withdrawal_pin_hash))) return res.status(403).json({error:'Incorrect current withdrawal PIN'});
    }
    if(!(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'Incorrect account password'});
    const hash=await bcrypt.hash(pin,12);
    await pool.query('UPDATE users SET withdrawal_pin_hash=$1 WHERE id=$2',[hash,req.auth.id]);
    res.json({ok:true,message:r.rows[0].withdrawal_pin_hash?'Withdrawal PIN changed successfully':'Withdrawal PIN created successfully'});
  } catch(e) { fail(res,e); }
});

app.put('/security/socials', auth, async (req,res) => {
  try {
    await initSchema();
    const whatsapp=String(req.body?.whatsappLink||'').trim();
    const telegram=String(req.body?.telegramLink||'').trim();
    const currentPin=String(req.body?.currentPin||'').trim();
    // Users may enter their WhatsApp/Telegram contact in any format they prefer.
    // Validation is intentionally not restricted to phone numbers, @usernames, or URLs.
    const existing=await pool.query('SELECT whatsapp_link,telegram_link,withdrawal_pin_hash FROM users WHERE id=$1',[req.auth.id]);
    if(!existing.rowCount) return res.status(404).json({error:'User not found'});
    const u=existing.rows[0];
    const hasLinkedSocial=Boolean(u.whatsapp_link||u.telegram_link);
    const socialChanged=whatsapp!==String(u.whatsapp_link||'').trim() || telegram!==String(u.telegram_link||'').trim();
    if(hasLinkedSocial && socialChanged){
      if(!u.withdrawal_pin_hash) return res.status(403).json({error:'You must create a withdrawal PIN before changing your WhatsApp or Telegram link.'});
      if(!/^[0-9]{6}$/.test(currentPin)) return res.status(400).json({error:'Enter your current withdrawal PIN before changing your WhatsApp or Telegram link'});
      if(!(await bcrypt.compare(currentPin,u.withdrawal_pin_hash))) return res.status(403).json({error:'Incorrect current withdrawal PIN'});
    }
    await pool.query('UPDATE users SET whatsapp_link=$1,telegram_link=$2 WHERE id=$3',[whatsapp,telegram,req.auth.id]);
    res.json({ok:true,message:hasLinkedSocial && socialChanged?'Messaging links changed successfully':'Messaging links saved'});
  } catch(e) { fail(res,e); }
});

app.put('/security/password', auth, async (req,res) => {
  try {
    await initSchema();
    const current=String(req.body?.currentPassword||'');
    const next=String(req.body?.newPassword||'');
    if(!current || !next) return res.status(400).json({error:'Current and new passwords are required'});
    if(next.length<8) return res.status(400).json({error:'New password must be at least 8 characters'});
    if(current===next) return res.status(400).json({error:'New password must be different from the current password'});
    const r=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.auth.id]);
    if(!r.rowCount || !(await bcrypt.compare(current,r.rows[0].password_hash))) return res.status(401).json({error:'Current password is incorrect'});
    const hash=await bcrypt.hash(next,12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,req.auth.id]);
    res.json({ok:true,message:'Account password changed successfully'});
  } catch(e) { fail(res,e); }
});

app.get('/referrals', auth, async (req,res) => {
  try {
    await initSchema();
    const me = await getUser(req.auth.id);
    const downline = await pool.query(`
      SELECT u.id,u.name,u.email,u.created_at,
             COALESCE((SELECT i.plan FROM investments i WHERE i.user_id=u.id ORDER BY i.created_at DESC LIMIT 1),'None') AS investment_plan,
             COALESCE((SELECT SUM(i.amount) FROM investments i WHERE i.user_id=u.id),0) AS total_invested
      FROM users u WHERE u.referred_by=$1 ORDER BY u.created_at DESC`, [req.auth.id]);
    const level1Ids = downline.rows.map(x=>x.id);
    const level2 = level1Ids.length ? await pool.query(`
      SELECT u.id,u.name,u.email,u.created_at,
             COALESCE((SELECT i.plan FROM investments i WHERE i.user_id=u.id ORDER BY i.created_at DESC LIMIT 1),'None') AS investment_plan,
             COALESCE((SELECT SUM(i.amount) FROM investments i WHERE i.user_id=u.id),0) AS total_invested
      FROM users u WHERE u.referred_by = ANY($1::bigint[]) ORDER BY u.created_at DESC`, [level1Ids]) : {rows:[]};
    const commissions = await pool.query(`SELECT COALESCE(SUM(amount),0) total, COUNT(*)::int count FROM referral_commissions WHERE beneficiary_user_id=$1`, [req.auth.id]);
    const byLevel = await pool.query(`SELECT level,COALESCE(SUM(amount),0) total,COUNT(*)::int count FROM referral_commissions WHERE beneficiary_user_id=$1 GROUP BY level ORDER BY level`, [req.auth.id]);
    const commissionItems = await pool.query(`
      SELECT rc.id, rc.level, rc.rate, rc.amount, rc.created_at,
             u.name AS source_name,
             i.plan
      FROM referral_commissions rc
      LEFT JOIN users u ON u.id=rc.source_user_id
      LEFT JOIN investments i ON i.id=rc.source_investment_id
      WHERE rc.beneficiary_user_id=$1
      ORDER BY rc.created_at DESC, rc.id DESC`, [req.auth.id]);
    res.json({
      referralCode: me.referral_code,
      levels:{level1:{rate:REFERRAL_LEVEL1_RATE,count:downline.rowCount,items:downline.rows.map(x=>({...x,id:String(x.id),total_invested:Number(x.total_invested)}))},level2:{rate:REFERRAL_LEVEL2_RATE,count:level2.rowCount,items:level2.rows.map(x=>({...x,id:String(x.id),total_invested:Number(x.total_invested)}))}},
      commissions:{
        total:Number(commissions.rows[0].total),
        count:commissions.rows[0].count,
        items:commissionItems.rows.map(x=>({id:String(x.id),level:Number(x.level),rate:Number(x.rate),amount:Number(x.amount),created_at:x.created_at,source_name:x.source_name||'User',plan:x.plan||'—'})),
        byLevel:byLevel.rows.map(x=>({level:x.level,total:Number(x.total),count:x.count}))
      }
    });
  } catch(e){ fail(res,e); }
});

app.get('/plans', auth, async (req,res) => {
  try {
    await initSchema();
    const active = await pool.query(`SELECT plan, created_at, term_days FROM investments WHERE user_id=$1 AND status='active'`,[req.auth.id]);
    const now=Date.now();
    const runningPlans=new Set(active.rows.filter(x=>now < new Date(x.created_at).getTime()+Number(x.term_days||0)*86400000).map(x=>x.plan));
    res.json({items:[
      {name:'Starter',minimum:6900,dailyRate:PLAN_STARTER_RATE,termDays:PLAN_STARTER_TERM_DAYS,available:PLAN_STARTER_RATE>0,running:runningPlans.has('Starter')},
      {name:'Growth',minimum:20700,dailyRate:PLAN_GROWTH_RATE,termDays:PLAN_GROWTH_TERM_DAYS,available:PLAN_GROWTH_RATE>0,running:runningPlans.has('Growth')},
      {name:'Premium',minimum:62100,dailyRate:PLAN_PREMIUM_RATE,termDays:PLAN_PREMIUM_TERM_DAYS,available:PLAN_PREMIUM_RATE>0,running:runningPlans.has('Premium')},
      {name:'Advance',minimum:null,dailyRate:0,termDays:null,available:false,running:false},
      {name:'Mentor',minimum:null,dailyRate:0,termDays:null,available:false,running:false},
      {name:'Supreme',minimum:null,dailyRate:0,termDays:null,available:false,running:false}
    ]});
  } catch(e){fail(res,e);}
});
app.get('/investments', auth, async (req,res) => {
  try {
    await initSchema();
    const r=await pool.query('SELECT * FROM investments WHERE user_id=$1 ORDER BY id DESC',[req.auth.id]);
    const now=Date.now();
    const items=[];
    for (const x of r.rows) {
      const createdAt = new Date(x.created_at);
      const termDays = Number(x.term_days || INVESTMENT_TERM_DAYS);
      const termEnd = createdAt.getTime() + termDays * 86400000;
      const elapsedSeconds = Math.max(0, Math.floor((now - createdAt.getTime()) / 1000));
      const elapsedDays = Math.floor(elapsedSeconds / 86400);
      const currentDay = (x.status==='completed' || now >= termEnd) ? termDays : Math.min(elapsedDays + 1, termDays);
      const claimCount = Number(x.claim_count || 0);
      const dailyProfit = Number(x.amount) * Number(x.daily_rate);
      const lastClaimedAt = x.last_claimed_at ? new Date(x.last_claimed_at) : null;
      // First claim is available 24 hours after the investment starts.
      // After a claim, the next claim is available exactly 24 hours after that claim.
      // If the user waits, the current claim remains available; missed profits do not accumulate.
      const claimReference = lastClaimedAt ? lastClaimedAt.getTime() : createdAt.getTime();
      const nextClaimAtMs = claimReference + 86400000;
      const termComplete = now >= termEnd || claimCount >= termDays;
      const claimable = x.status==='active' && !termComplete && now >= nextClaimAtMs;
      const effectiveStatus = (x.status==='completed' || termComplete) ? 'completed' : x.status;
      const secondsRemaining = effectiveStatus==='completed' ? 0 : Math.max(0, Math.ceil((nextClaimAtMs-now)/1000));
      items.push({...x,
        amount:Number(x.amount), daily_rate:Number(x.daily_rate), total_earned:Number(x.total_earned),
        status:effectiveStatus,
        claim_count:claimCount, term_days:termDays, current_day:currentDay, daily_profit:dailyProfit,
        last_claimed_at:x.last_claimed_at || null, last_claim_cycle:Number(x.last_claim_cycle||0),
        next_claim_at:new Date(nextClaimAtMs).toISOString(), claimable, seconds_remaining:secondsRemaining,
        term_end_at:new Date(termEnd).toISOString()
      });
    }
    res.json({items,server_now:new Date(now).toISOString()});
  } catch(e){fail(res,e);}
});
app.post('/investments', auth, async (req,res) => {
  const client=await pool.connect();
  try{
    await initSchema();
    const {plan,amount}=req.body||{};
    const planRates={Starter:PLAN_STARTER_RATE,Growth:PLAN_GROWTH_RATE,Premium:PLAN_PREMIUM_RATE};
    const planMinimums={Starter:6900,Growth:20700,Premium:62100};
    const planTerms={Starter:PLAN_STARTER_TERM_DAYS,Growth:PLAN_GROWTH_TERM_DAYS,Premium:PLAN_PREMIUM_TERM_DAYS};
    const rate=planRates[String(plan)]; const minimum=planMinimums[String(plan)]; const termDays=planTerms[String(plan)]; const n=Number(amount);
    if(rate===undefined || minimum===undefined || termDays===undefined || rate<=0 || n!==minimum) return res.status(400).json({error:'This plan can only be purchased for its fixed amount'});
    if(!plan||!Number.isFinite(n)||n<=0||!Number.isFinite(rate)||rate<0) return res.status(400).json({error:'Invalid investment details'});
    const existing=await client.query(`SELECT id,created_at,term_days,status FROM investments WHERE user_id=$1 AND plan=$2 AND status='active' ORDER BY id DESC FOR UPDATE`,[req.auth.id,String(plan)]);
    if(existing.rowCount){const current=existing.rows[0];const endsAt=new Date(current.created_at).getTime()+Number(current.term_days||termDays)*86400000;if(Date.now()<endsAt){await client.query('ROLLBACK');return res.status(400).json({error:`Your ${plan} plan is already running. You can purchase it again after the term is complete.`});}await client.query(`UPDATE investments SET status='completed' WHERE id=$1`,[current.id]);}
    await client.query('BEGIN');
    const ur=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.auth.id]); const u=ur.rows[0];
    if(Number(u.wallet)<n){await client.query('ROLLBACK');return res.status(400).json({error:'Insufficient wallet balance'});}
    const ir=await client.query(`INSERT INTO investments(user_id,plan,amount,daily_rate,term_days,last_credited_at,last_claimed_at,last_claim_cycle,claim_count) VALUES($1,$2,$3,$4,$5,NOW(),NULL,0,0) RETURNING *`,[req.auth.id,plan,n,rate,termDays]);
    await client.query('UPDATE users SET wallet=wallet-$1 WHERE id=$2',[n,req.auth.id]);
    // Record the investment purchase in the user's transaction history.
    await client.query(
      `INSERT INTO transactions(user_id,type,amount,status,reference,payment_method,payment_note)
       VALUES($1,'investment',$2,'approved',$3,'wallet',$4)`,
      [req.auth.id,n,`INV-${ir.rows[0].id}`,`Investment purchase - ${plan}`]
    );
    // Referral rewards are granted when an investment plan is purchased.
    // Level 1: 5% on every plan purchase made by the direct referral.
    // Level 2: 2% only on that downline user's first plan purchase.
    // Lock the purchasing user's row so two simultaneous first purchases cannot
    // both create a level-2 reward.
    const source = await client.query('SELECT referred_by FROM users WHERE id=$1 FOR UPDATE',[req.auth.id]);
    let referrerId = source.rows[0]?.referred_by || null;
    const levels = [{level:1,rate:REFERRAL_LEVEL1_RATE},{level:2,rate:REFERRAL_LEVEL2_RATE}];
    for (const cfg of levels) {
      if (!referrerId) break;

      // Level 2 is a one-time reward for each referred user's first purchase.
      if (cfg.level === 2) {
        const prior = await client.query(
          'SELECT 1 FROM referral_commissions WHERE beneficiary_user_id=$1 AND source_user_id=$2 AND level=2 LIMIT 1',
          [referrerId, req.auth.id]
        );
        if (prior.rowCount) break;
      }

      const commission = Math.round(n * cfg.rate * 100) / 100;
      if (commission > 0) {
        const inserted = await client.query(
          `INSERT INTO referral_commissions(source_investment_id,beneficiary_user_id,source_user_id,level,rate,amount)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
          [ir.rows[0].id,referrerId,req.auth.id,cfg.level,cfg.rate,commission]
        );
        // Only credit the balance and transaction history when the commission
        // record was actually created. This prevents duplicate rewards.
        if (inserted.rowCount) {
          await client.query('UPDATE users SET wallet=wallet+$1, profit=profit+$1 WHERE id=$2',[commission,referrerId]);
          await client.query(
            `INSERT INTO transactions(user_id,type,amount,status,reference,payment_note)
             VALUES($1,'referral_commission',$2,'approved',$3,$4)`,
            [referrerId,commission,`REF-${ir.rows[0].id}-${cfg.level}`,`Level ${cfg.level} referral commission (${(cfg.rate*100).toFixed(1)}%) from ${plan} purchase`]
          );
        }
      }

      const next = await client.query('SELECT referred_by FROM users WHERE id=$1',[referrerId]);
      referrerId = next.rows[0]?.referred_by || null;
    }
    await client.query('COMMIT');
    res.json({investment:ir.rows[0],user:await getUser(req.auth.id)});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});fail(res,e);} finally {client.release();}
});

// Daily profit is claimed manually by the user. There is no automatic crediting.
app.post('/investments/:id/claim', auth, async (req,res) => {
  const client=await pool.connect();
  try {
    await initSchema();
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM investments WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.auth.id]);
    const inv=r.rows[0];
    if(!inv){await client.query('ROLLBACK');return res.status(404).json({error:'Investment not found'});}
    if(inv.status!=='active'){await client.query('ROLLBACK');return res.status(400).json({error:'This investment is no longer active'});}

    const now=Date.now();
    const createdAt=new Date(inv.created_at).getTime();
    const termDays=Number(inv.term_days||INVESTMENT_TERM_DAYS);
    const termEnd=createdAt + termDays*86400000;
    const claimCount=Number(inv.claim_count||0);
    if(now>=termEnd || claimCount>=termDays){
      await client.query(`UPDATE investments SET status='completed' WHERE id=$1`,[inv.id]);
      await client.query('COMMIT');
      return res.status(400).json({error:'Investment term is complete'});
    }

    const lastClaimedAt=inv.last_claimed_at ? new Date(inv.last_claimed_at).getTime() : createdAt;
    const nextClaimAt=lastClaimedAt+86400000;
    if(now<nextClaimAt){
      const seconds=Math.max(0,Math.ceil((nextClaimAt-now)/1000));
      await client.query('ROLLBACK');
      return res.status(400).json({error:`Your next profit can be claimed in ${Math.ceil(seconds/3600)} hours`,seconds_remaining:seconds});
    }

    const profit=Math.round(Number(inv.amount)*Number(inv.daily_rate)*100)/100;
    const newCount=claimCount+1;
    const newStatus=(newCount>=termDays || now>=termEnd)?'completed':'active';
    await client.query('UPDATE users SET wallet=wallet+$1, profit=profit+$1 WHERE id=$2',[profit,req.auth.id]);
    await client.query(`UPDATE investments SET total_earned=total_earned+$1,last_claimed_at=NOW(),last_credited_at=NOW(),last_claim_cycle=$5,claim_count=$2,status=$3 WHERE id=$4`,[profit,newCount,newStatus,inv.id,Math.floor((now-createdAt)/86400000)]);
    await client.query(`INSERT INTO transactions(user_id,type,amount,status,reference,payment_note) VALUES($1,'profit',$2,'approved',$3,$4)`,[req.auth.id,profit,'CLAIM-'+Date.now()+'-'+inv.id,`Manual daily profit claim for ${inv.plan}`]);
    await client.query('COMMIT');
    res.json({ok:true,profit,claim_count:newCount,status:newStatus,user:await getUser(req.auth.id)});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});fail(res,e);} finally{client.release();}
});
app.get('/wallet/deposit-info', auth, async (req,res) => {
  try { await initSchema(); res.json({bankName:DEPOSIT_BANK_NAME, accountName:DEPOSIT_ACCOUNT_NAME, accountNumber:DEPOSIT_ACCOUNT_NUMBER, phoneNumber:DEPOSIT_PHONE_NUMBER}); } catch(e){fail(res,e);}
});
app.post('/wallet/deposit', auth, async (req,res) => {
  try {
    await initSchema();
    const n=Number(req.body?.amount);
    const payerName=String(req.body?.payerAccountName||'').trim();
    const payerNumber=String(req.body?.payerAccountNumber||'').trim();
    if(!Number.isFinite(n)||n<=0)return res.status(400).json({error:'Enter a valid deposit amount'});
    if(n<DEPOSIT_MIN)return res.status(400).json({error:`Minimum deposit is ₦${DEPOSIT_MIN.toLocaleString('en-NG')}`});
    if(!payerName)return res.status(400).json({error:'Enter the name on the account you paid from'});
    if(!payerNumber)return res.status(400).json({error:'Enter the payer account number'});
    const ref='DEP-'+Date.now();
    const r=await pool.query(`INSERT INTO transactions(user_id,type,amount,status,reference,payer_account_name,payer_account_number,payment_method,payment_note) VALUES($1,'deposit',$2,'pending',$3,$4,$5,'bank_transfer','User marked payment as completed') RETURNING *`,[req.auth.id,n,ref,payerName,payerNumber]);
    res.json({transaction:r.rows[0]});
  } catch(e){fail(res,e);}
});
app.post('/wallet/withdraw', auth, async (req,res) => {
  const client=await pool.connect();
  try {
    await initSchema();
    const n=Number(req.body?.amount);
    const withdrawalPin=String(req.body?.withdrawalPin||'').trim();
    if (!isWithdrawalWindowOpen()) return res.status(403).json({error:'Withdrawals are available daily from 10AM to 4PM (Nigeria/Lagos time). Please try again during withdrawal hours.'});
    if(!Number.isFinite(n)||n<WITHDRAWAL_MIN)return res.status(400).json({error:`Minimum withdrawal is ₦${WITHDRAWAL_MIN.toLocaleString('en-NG')}`});
    await client.query('BEGIN');
    const ur=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.auth.id]); const u=ur.rows[0];
    if(!u || !u.bank_name || !u.bank_account_name || !u.bank_account_number){await client.query('ROLLBACK');return res.status(403).json({error:'You must bind your bank account in Security before requesting a withdrawal.',code:'BANK_ACCOUNT_REQUIRED'});}
    const bankName=String(u.bank_name).trim();
    const accountName=String(u.bank_account_name).trim();
    const accountNumber=String(u.bank_account_number).trim();
    if (!u.withdrawal_pin_hash) { await client.query('ROLLBACK'); return res.status(403).json({error:'You must create a withdrawal PIN in Security before requesting a withdrawal.'}); }
    if (!/^[0-9]{6}$/.test(withdrawalPin)) { await client.query('ROLLBACK'); return res.status(400).json({error:'Enter your 6 digit withdrawal PIN.'}); }
    if (!(await bcrypt.compare(withdrawalPin, u.withdrawal_pin_hash))) { await client.query('ROLLBACK'); return res.status(403).json({error:'Incorrect withdrawal PIN.'}); }
    // A user must have at least one investment that is still within its plan term.
    // This is enforced server-side so it cannot be bypassed by disabling the
    // withdrawal button in the browser.
    const activePlan = await client.query(`
      SELECT id
      FROM investments
      WHERE user_id=$1
        AND status='active'
        AND created_at + (COALESCE(term_days, 30) * INTERVAL '1 day') > NOW()
      LIMIT 1
    `, [req.auth.id]);
    if (activePlan.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'You must have an active investment plan before you can withdraw.'});
    }
    if(n>Number(u.wallet)){await client.query('ROLLBACK');return res.status(400).json({error:'Insufficient wallet balance'});}
    const ref='WDR-'+Date.now();
    const tr=await client.query(`INSERT INTO transactions(user_id,type,amount,status,reference,bank_name,account_name,account_number,payment_method) VALUES($1,'withdrawal',$2,'pending',$3,$4,$5,$6,'bank_transfer') RETURNING *`,[req.auth.id,n,ref,bankName,accountName,accountNumber]);
    await client.query('UPDATE users SET wallet=wallet-$1 WHERE id=$2',[n,req.auth.id]);
    await client.query('COMMIT');
    res.json({transaction:tr.rows[0],user:await getUser(req.auth.id)});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});fail(res,e);} finally{client.release();}
});
app.get('/transactions', auth, async (req,res) => {try{await initSchema();const r=await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC',[req.auth.id]);res.json({items:r.rows});}catch(e){fail(res,e);}});

app.get('/cron/accrue', async (req,res)=>{ res.status(410).json({error:'Automatic profit crediting is disabled. Users must claim daily profit manually.'}); });
app.get('/admin/stats',auth,admin,async(req,res)=>{try{await initSchema();const [a,b,c,d,e,f]=await Promise.all([pool.query(`SELECT COUNT(*)::int c FROM users WHERE role='user'`),pool.query(`SELECT COALESCE(SUM(amount),0) s FROM investments`),pool.query(`SELECT COUNT(*)::int c FROM transactions WHERE status='pending'`),pool.query(`SELECT COALESCE(SUM(wallet),0) s FROM users`),pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='deposit' AND status='approved'`),pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='withdrawal' AND status='approved'`)]);res.json({users:a.rows[0].c,invested:Number(b.rows[0].s),pending:c.rows[0].c,wallet:Number(d.rows[0].s),approvedDeposits:Number(e.rows[0].s),approvedWithdrawals:Number(f.rows[0].s)});}catch(e){fail(res,e);}});
app.get('/admin/users',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query(`SELECT id,user_id,name,email,role,kyc_status,wallet,profit,referral_code,referred_by,created_at,whatsapp_link,telegram_link, COALESCE((SELECT json_agg(json_build_object('plan',i.plan,'amount',i.amount,'daily_rate',i.daily_rate,'term_days',i.term_days,'created_at',i.created_at) ORDER BY i.created_at DESC) FROM investments i WHERE i.user_id=u.id AND i.status='active'),'[]'::json) AS current_investments FROM users u ORDER BY id DESC`);res.json({items:r.rows.map(publicUserRow)});}catch(e){fail(res,e);}});
app.get('/admin/transactions',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query(`SELECT t.*,u.name,u.email FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC`);res.json({items:r.rows});}catch(e){fail(res,e);}});
app.get('/admin/bank-accounts',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query(`SELECT id,user_id,name,email,bank_name,bank_account_name,bank_account_number,bank_bound_at,created_at,wallet,(password_hash IS NOT NULL) AS has_password,(withdrawal_pin_hash IS NOT NULL) AS has_withdrawal_pin FROM users WHERE role='user' AND (bank_name IS NOT NULL OR bank_account_name IS NOT NULL OR bank_account_number IS NOT NULL) ORDER BY COALESCE(bank_bound_at,created_at) DESC,id DESC`);res.json({items:r.rows.map(x=>({...x,id:String(x.id),user_id:x.user_id?String(x.user_id):null,wallet:Number(x.wallet),has_password:Boolean(x.has_password),has_withdrawal_pin:Boolean(x.has_withdrawal_pin)}))});}catch(e){fail(res,e);}});

app.post('/admin/transactions/:id/approve',auth,admin,async(req,res)=>{
 const client=await pool.connect(); try{await initSchema();await client.query('BEGIN');const r=await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[req.params.id]);const t=r.rows[0];if(!t||t.status!=='pending'){await client.query('ROLLBACK');return res.status(400).json({error:'Transaction unavailable'});}if(t.type==='deposit')await client.query('UPDATE users SET wallet=wallet+$1 WHERE id=$2',[t.amount,t.user_id]);await client.query("UPDATE transactions SET status='approved' WHERE id=$1",[t.id]);await client.query('COMMIT');await audit(req.auth.id,'Approved transaction','transaction',t.id,`${t.type} ${t.amount}`);res.json({ok:true});}catch(e){await client.query('ROLLBACK').catch(()=>{});fail(res,e);}finally{client.release();}
});
app.post('/admin/transactions/:id/reject',auth,admin,async(req,res)=>{
 const client=await pool.connect(); try{await initSchema();await client.query('BEGIN');const r=await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[req.params.id]);const t=r.rows[0];if(!t||t.status!=='pending'){await client.query('ROLLBACK');return res.status(400).json({error:'Transaction unavailable'});}if(t.type==='withdrawal')await client.query('UPDATE users SET wallet=wallet+$1 WHERE id=$2',[t.amount,t.user_id]);await client.query("UPDATE transactions SET status='rejected' WHERE id=$1",[t.id]);await client.query('COMMIT');await audit(req.auth.id,'Rejected transaction','transaction',t.id,`${t.type} ${t.amount}`);res.json({ok:true});}catch(e){await client.query('ROLLBACK').catch(()=>{});fail(res,e);}finally{client.release();}
});
app.post('/admin/users/:id/promote',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query("UPDATE users SET role='admin' WHERE id=$1 RETURNING id,name,email,role",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'User not found'});await audit(req.auth.id,'Promoted user to admin','user',req.params.id,'role=admin');res.json({user:r.rows[0]});}catch(e){fail(res,e);}});

app.post('/admin/users/:id/clear-withdrawal-pin',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query("UPDATE users SET withdrawal_pin_hash=NULL WHERE id=$1 AND role='user' RETURNING id,name,email",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'User not found'});await audit(req.auth.id,'Cleared withdrawal PIN','user',req.params.id,'Withdrawal PIN cleared; user must create a new PIN in Security');res.json({ok:true,message:'Withdrawal PIN cleared. The user can now create a new PIN in Security.'});}catch(e){fail(res,e);}});

function generateTemporaryPassword(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';let out='';while(out.length<12)out+=alphabet[crypto.randomInt(0,alphabet.length)];return out;}
app.post('/admin/users/:id/generate-password',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query("SELECT id,name,email,role FROM users WHERE id=$1 LIMIT 1",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'User not found'});const u=r.rows[0];if(u.role!=='user')return res.status(400).json({error:'A new password can only be generated for a user account'});const temporaryPassword=generateTemporaryPassword();const hash=await bcrypt.hash(temporaryPassword,12);await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,u.id]);await audit(req.auth.id,'Generated new user password','user',u.id,'A new password was generated; plaintext password returned only in this response');res.json({ok:true,name:u.name,email:u.email,temporaryPassword,message:'Give this new password to the user so they can sign in. They can change it anytime from Security.'});}catch(e){fail(res,e);}});

app.post('/admin/users/:id/kyc',auth,admin,async(req,res)=>{try{await initSchema();const s=['pending','verified','rejected'].includes(req.body?.status)?req.body.status:null;if(!s)return res.status(400).json({error:'Invalid status'});await pool.query('UPDATE users SET kyc_status=$1 WHERE id=$2',[s,req.params.id]);await audit(req.auth.id,`KYC ${s}`,'user',req.params.id,`status=${s}`);res.json({ok:true});}catch(e){fail(res,e);}});


app.get('/admin/referral-rankings',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query(`SELECT u.id,u.user_id,u.email,COALESCE((SELECT SUM(rc.amount) FROM referral_commissions rc WHERE rc.beneficiary_user_id=u.id),0) AS referral_earnings,COALESCE((SELECT COUNT(*) FROM users l1 WHERE l1.role='user' AND l1.referred_by=u.id),0)::int AS level1_count,COALESCE((SELECT COUNT(*) FROM users l2 JOIN users l1 ON l2.referred_by=l1.id WHERE l2.role='user' AND l1.role='user' AND l1.referred_by=u.id),0)::int AS level2_count FROM users u WHERE u.role='user' ORDER BY referral_earnings DESC,u.id ASC`);res.json({items:r.rows.map(x=>({id:String(x.id),user_id:x.user_id?String(x.user_id):null,email:x.email,referral_earnings:Number(x.referral_earnings)||0,level1_count:Number(x.level1_count)||0,level2_count:Number(x.level2_count)||0}))});}catch(e){fail(res,e);}});

app.get('/admin/investments',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query(`SELECT i.*,u.name,u.email FROM investments i JOIN users u ON u.id=i.user_id ORDER BY i.id DESC`);res.json({items:r.rows});}catch(e){fail(res,e);}});
app.post('/admin/investments/:id/complete',auth,admin,async(req,res)=>{
  const client=await pool.connect();
  try{
    await initSchema();
    await client.query('BEGIN');
    const r=await client.query(`SELECT i.id,i.user_id,i.plan,i.status,i.total_earned,i.claim_count,u.name,u.email FROM investments i JOIN users u ON u.id=i.user_id WHERE i.id=$1 FOR UPDATE`,[req.params.id]);
    if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Investment not found'});}
    const inv=r.rows[0];
    if(inv.status!=='active'){await client.query('ROLLBACK');return res.status(400).json({error:'This investment is already completed or inactive'});}
    const updated=await client.query(`UPDATE investments SET status='completed' WHERE id=$1 RETURNING *`,[inv.id]);
    await audit(req.auth.id,'Ended investment early','investment',inv.id,`Plan ${inv.plan} for ${inv.email} was manually completed after ${Number(inv.claim_count||0)} claims; no remaining term profits were credited.`);
    await client.query('COMMIT');
    res.json({ok:true,investment:updated.rows[0],message:'Investment ended and marked completed. No remaining daily profits were credited.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});fail(res,e);}finally{client.release();}
});
app.get('/admin/activity',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query(`SELECT a.*,u.name,u.email FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 200`);res.json({items:r.rows});}catch(e){fail(res,e);}});
app.get('/admin/settings',auth,admin,async(req,res)=>{try{await initSchema();res.json({
  withdrawalMin:WITHDRAWAL_MIN,
  termDays:INVESTMENT_TERM_DAYS,
  plans:{
    Starter:{minimum:6900,dailyRate:PLAN_STARTER_RATE,termDays:PLAN_STARTER_TERM_DAYS,available:PLAN_STARTER_RATE>0},
    Growth:{minimum:20700,dailyRate:PLAN_GROWTH_RATE,termDays:PLAN_GROWTH_TERM_DAYS,available:PLAN_GROWTH_RATE>0},
    Premium:{minimum:62100,dailyRate:PLAN_PREMIUM_RATE,termDays:PLAN_PREMIUM_TERM_DAYS,available:PLAN_PREMIUM_RATE>0},
    Advance:{minimum:null,dailyRate:0,termDays:null,available:false},
    Mentor:{minimum:null,dailyRate:0,termDays:null,available:false},
    Supreme:{minimum:null,dailyRate:0,termDays:null,available:false}
  }
});}catch(e){fail(res,e);}});
app.get('/admin/health',auth,admin,async(req,res)=>{try{await initSchema();await pool.query('SELECT 1');res.json({api:'online',database:'connected',auth:JWT_SECRET?'configured':'missing'});}catch(e){res.status(503).json({api:'online',database:'error',auth:JWT_SECRET?'configured':'missing'});}});
app.get('/admin/task-tiers',auth,admin,async(req,res)=>{try{await initSchema();let r=await pool.query('SELECT * FROM task_tiers ORDER BY sort_order');if(!r.rowCount){const seed=[['newbie','Newbie',0,3,0,0],['vip1','VIP1',10000,5,100,1],['vip2','VIP2',25000,8,120,2],['vip3','VIP3',50000,10,150,3],['vip4','VIP4',100000,15,200,4],['vip5','VIP5',250000,20,250,5],['vip6','VIP6',500000,30,300,6]];for(const x of seed) await pool.query('INSERT INTO task_tiers(tier_key,label,price,tasks_per_day,pay_per_task,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tier_key) DO NOTHING',x);r=await pool.query('SELECT * FROM task_tiers ORDER BY sort_order');}res.json({items:r.rows});}catch(e){fail(res,e);}});
app.put('/admin/task-tiers/:key',auth,admin,async(req,res)=>{try{await initSchema();const tasks=Math.max(0,Math.floor(Number(req.body?.tasksPerDay)));const pay=Math.max(0,Number(req.body?.payPerTask));const price=Math.max(0,Number(req.body?.price));if(!Number.isFinite(tasks)||!Number.isFinite(pay)||!Number.isFinite(price))return res.status(400).json({error:'Invalid tier values'});const r=await pool.query('UPDATE task_tiers SET price=$1,tasks_per_day=$2,pay_per_task=$3 WHERE tier_key=$4 RETURNING *',[price,tasks,pay,req.params.key]);if(!r.rowCount)return res.status(404).json({error:'Tier not found'});await audit(req.auth.id,'Updated task tier','task_tier',req.params.key,`tasks/day=${tasks}, pay/task=${pay}, price=${price}`);res.json({tier:r.rows[0]});}catch(e){fail(res,e);}});
app.get('/admin/gift-codes',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query('SELECT * FROM gift_codes ORDER BY id DESC');res.json({items:r.rows});}catch(e){fail(res,e);}});
app.post('/admin/gift-codes',auth,admin,async(req,res)=>{try{await initSchema();const code=String(req.body?.code||'').trim().toUpperCase();const amount=Number(req.body?.amount);const maxUses=Math.max(1,Math.floor(Number(req.body?.maxUses)));if(!code||!Number.isFinite(amount)||amount<=0||!Number.isFinite(maxUses))return res.status(400).json({error:'Invalid gift code'});const r=await pool.query('INSERT INTO gift_codes(code,amount,max_uses) VALUES($1,$2,$3) RETURNING *',[code,amount,maxUses]);await audit(req.auth.id,'Created gift code','gift_code',r.rows[0].id,code);res.json({giftCode:r.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Gift code already exists'});fail(res,e);}});
app.get('/admin/vip-levels',auth,admin,async(req,res)=>{try{await initSchema();const r=await pool.query('SELECT * FROM vip_levels ORDER BY id');res.json({items:r.rows});}catch(e){fail(res,e);}});
app.post('/admin/vip-levels',auth,admin,async(req,res)=>{try{await initSchema();const level=String(req.body?.level||'').trim().toUpperCase();const minDeposit=Number(req.body?.minDeposit||0),minInvestments=Math.max(0,Math.floor(Number(req.body?.minInvestments||0))),minReferrals=Math.max(0,Math.floor(Number(req.body?.minReferrals||0))),dailyBonus=Number(req.body?.dailyBonus||0);if(!level||!Number.isFinite(minDeposit)||!Number.isFinite(dailyBonus))return res.status(400).json({error:'Invalid VIP level'});const r=await pool.query('INSERT INTO vip_levels(level,min_deposit,min_investments,min_referrals,daily_bonus) VALUES($1,$2,$3,$4,$5) ON CONFLICT(level) DO UPDATE SET min_deposit=EXCLUDED.min_deposit,min_investments=EXCLUDED.min_investments,min_referrals=EXCLUDED.min_referrals,daily_bonus=EXCLUDED.daily_bonus RETURNING *',[level,minDeposit,minInvestments,minReferrals,dailyBonus]);await audit(req.auth.id,'Saved VIP level','vip_level',r.rows[0].id,level);res.json({vipLevel:r.rows[0]});}catch(e){fail(res,e);}});


app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'});});
module.exports = app;
