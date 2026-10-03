const crypto = require("crypto");
const { ethers } = require("ethers");

const SUBSCRIPTION_ABI = [
  "function paySubscription(bytes32 subscriptionKey,bytes32 customerKey,uint256 periodStart,uint256 amount)",
  "function paid(bytes32) view returns(bool)",
  "function token() view returns(address)",
  "function treasury() view returns(address)",
  "event SubscriptionPaid(bytes32 indexed subscriptionKey,bytes32 indexed customerKey,address indexed payer,address token,uint256 amount,uint256 periodStart)"
];

function subscriptionsEnabled() { return process.env.SUBSCRIPTIONS_ENABLED === "true"; }

function provider() {
  const rpc = process.env.BSC_RPC_URL || process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-dataseed.bnbchain.org";
  return new ethers.JsonRpcProvider(rpc);
}
function normalizeAddress(value) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value || ""))) throw new Error("Invalid EVM address");
  return ethers.getAddress(value);
}
function monthStart(value = new Date()) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function periodKey(date) {
  return date.toISOString().slice(0, 7);
}
function fiatForCountry(country) {
  return country === "BW" ? { currency: "P", minor: 500 } : { currency: "E", minor: 500 };
}
function configuredTokenAmount(country) {
  const raw = country === "BW" ? process.env.SUBSCRIPTION_BW_TOKEN_AMOUNT : process.env.SUBSCRIPTION_SZ_TOKEN_AMOUNT;
  if (!raw || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error("Monthly stablecoin amount is not configured for this country");
  return BigInt(raw);
}
function tokenAddress() {
  return normalizeAddress(process.env.SUBSCRIPTION_TOKEN_ADDRESS || process.env.TEST_TOKEN_CONTRACT);
}
function subscriptionAddress() {
  return normalizeAddress(process.env.SUBSCRIPTION_CONTRACT_ADDRESS);
}
function customerKey(userId) {
  return ethers.keccak256(ethers.toUtf8Bytes("LIHOLISWANO-CUSTOMER:" + String(userId)));
}
function makeSubscriptionKey(userId, period) {
  return ethers.keccak256(ethers.toUtf8Bytes("LIHOLISWANO-SUBSCRIPTION:" + String(userId) + ":" + period));
}
function periodStartUnix(periodDate) {
  return Math.floor(periodDate.getTime() / 1000);
}
function explorerTx(tx) {
  const base = process.env.BSC_EXPLORER_TX_BASE || "https://testnet.bscscan.com/tx/";
  return base + tx;
}


async function prepareSubscriptionForUser(db, user) {
  const current = monthStart();
  const period = periodKey(current);
  const account = fiatForCountry(user.country);
  const token = tokenAddress();
  const contract = subscriptionAddress();
  const tokenAmount = configuredTokenAmount(user.country);
  const decimals = Number(process.env.SUBSCRIPTION_TOKEN_DECIMALS || 6);
  const wallet = await db.query(
    "select address,chain_id from wallets where user_id=$1 and chain_id=$2 and is_primary=true and verified_at is not null limit 1",
    [user.id, Number(process.env.BSC_CHAIN_ID || 97)]
  );
  if (!wallet.rowCount) throw new Error("Primary verified BNB wallet required");
  const existing = await db.query("select * from subscription_payments where user_id=$1 and period_key=$2 limit 1",[user.id,period]);
  if (existing.rowCount) {
    const existingPayment = existing.rows[0];
    if (existingPayment.status === "confirmed") return { payment: existingPayment, alreadyPaid: true, walletAddress: wallet.rows[0].address };
    if (String(existingPayment.wallet_address).toLowerCase() !== String(wallet.rows[0].address).toLowerCase()) {
      await db.query("update subscription_payments set wallet_address=$2,updated_at=now() where id=$1",[existingPayment.id,wallet.rows[0].address]);
      existingPayment.wallet_address=wallet.rows[0].address;
    }
    return { payment: existingPayment, alreadyPaid: false, walletAddress: wallet.rows[0].address };
  }
  const key = makeSubscriptionKey(user.id, period);
  const ckey = customerKey(user.id);
  const rate = user.country === "BW" ? (process.env.SUBSCRIPTION_RATE_BW_P_PER_USD || null) : (process.env.SUBSCRIPTION_RATE_SZ_E_PER_USD || null);
  const ins = await db.query(
    "insert into subscription_payments(user_id,period_start,period_key,currency,fiat_amount_minor,token_address,token_amount_base_units,token_decimals,chain_id,subscription_contract,subscription_key,customer_key,wallet_address,status,exchange_rate,rate_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'prepared',$14,$15) returning *",
    [user.id,current,period,account.currency,account.minor,token,tokenAmount.toString(),decimals,Number(process.env.BSC_CHAIN_ID || 97),contract,key,ckey,wallet.rows[0].address,rate,rate ? "configured" : null]
  );
  await db.query("insert into subscription_events(payment_id,event_type,metadata) values($1,'prepared',$2)",[ins.rows[0].id,JSON.stringify({wallet:wallet.rows[0].address})]);
  return { payment: ins.rows[0], alreadyPaid:false, walletAddress:wallet.rows[0].address };
}

async function createAuthorization(db,userId,paymentId) {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await db.query("update subscription_authorizations set used_at=now() where user_id=$1 and used_at is null",[userId]);
  await db.query("insert into subscription_authorizations(user_id,payment_id,token_hash,expires_at) values($1,$2,$3,now()+interval '30 minutes')",[userId,paymentId,hash]);
  return token;
}

function installSubscriptions({ app, db, auth, requireRole, audit }) {
  app.get("/api/subscription", auth, async (req, res) => {
    if (!subscriptionsEnabled()) return res.json({enabled:false,status:"disabled",message:"Monthly subscription payments are temporarily disabled while the Testnet platform is being validated.",activationRequired:"SUBSCRIPTIONS_ENABLED=true"});
    const account = fiatForCountry(req.user.country);
    const current = monthStart();
    const p = periodKey(current);
    const q = await db().query(
      "select * from subscription_payments where user_id=$1 order by period_start desc limit 12",
      [req.user.id]
    );
    const paidCurrent = q.rows.find(x => x.period_key === p && x.status === "confirmed");
    res.json({
      currency: account.currency,
      fiatAmount: account.minor / 100,
      fiatAmountMinor: account.minor,
      fiatLabel: account.currency === "P" ? "P5.00" : "E5.00",
      period: p,
      status: paidCurrent ? "paid" : "due",
      payments: q.rows
    });
  });

  app.post("/api/subscription/prepare", auth, async (req, res) => {
    if (!subscriptionsEnabled()) return res.status(409).json({enabled:false,error:"Monthly subscription payments are temporarily disabled while the Testnet platform is being validated."});
    try {
      const result = await prepareSubscriptionForUser(db(), req.user);
      res.status(result.alreadyPaid ? 200 : 201).json({
        payment: result.payment,
        alreadyPaid: result.alreadyPaid,
        authorization: {
          contract: result.payment.subscription_contract,
          token: result.payment.token_address,
          customerKey: result.payment.customer_key,
          subscriptionKey: result.payment.subscription_key,
          periodStart: periodStartUnix(monthStart(result.payment.period_start)),
          amount: String(result.payment.token_amount_base_units),
          decimals: Number(result.payment.token_decimals),
          chainId: Number(result.payment.chain_id)
        }
      });
    } catch (e) {
      console.error("subscription prepare", e);
      res.status(503).json({ error: e.message || "Subscription is not configured" });
    }
  });

  app.post("/api/subscription/record", auth, async (req, res) => {
    if (!subscriptionsEnabled()) return res.status(409).json({enabled:false,error:"Monthly subscription payments are temporarily disabled while the Testnet platform is being validated."});
    try {
      const paymentId = String(req.body.paymentId || "");
      const txHash = String(req.body.txHash || "");
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash) || !paymentId) return res.status(400).json({ error: "paymentId and transaction hash are required" });
      const q = await db().query("select * from subscription_payments where id=$1 and user_id=$2", [paymentId, req.user.id]);
      if (!q.rowCount) return res.status(404).json({ error: "Subscription payment not found" });
      const payment = q.rows[0];
      if (payment.status === "confirmed" && payment.tx_hash === txHash) return res.json({ payment });
      const network = await provider().getNetwork();
      if (Number(network.chainId) !== Number(payment.chain_id)) return res.status(409).json({ error: "Blockchain network mismatch" });
      const tx = await provider().getTransaction(txHash);
      const receipt = await provider().getTransactionReceipt(txHash);
      if (!tx || !receipt) return res.status(409).json({ error: "Transaction is not confirmed yet" });
      if (String(tx.from).toLowerCase() !== String(payment.wallet_address || req.user.wallet_address || "").toLowerCase()) {
        const w = await db().query("select address from wallets where user_id=$1 and is_primary=true and verified_at is not null limit 1",[req.user.id]);
        if (!w.rowCount || String(tx.from).toLowerCase() !== String(w.rows[0].address).toLowerCase()) return res.status(403).json({ error: "Transaction sender is not your verified wallet" });
      }
      if (String(tx.to || "").toLowerCase() !== payment.subscription_contract.toLowerCase()) return res.status(403).json({ error: "Transaction target is not the subscription contract" });
      if (receipt.status !== 1) {
        await db().query("update subscription_payments set status='reverted',tx_hash=$2,error_message='On-chain transaction reverted' where id=$1",[paymentId,txHash]);
        return res.status(409).json({ error: "Subscription transaction reverted", txHash });
      }
      const iface = new ethers.Interface(SUBSCRIPTION_ABI);
      let matched = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (!parsed || parsed.name !== "SubscriptionPaid") continue;
          if (parsed.args.subscriptionKey.toLowerCase() !== payment.subscription_key.toLowerCase()) continue;
          if (parsed.args.customerKey.toLowerCase() !== payment.customer_key.toLowerCase()) continue;
          if (parsed.args.payer.toLowerCase() !== tx.from.toLowerCase()) continue;
          if (parsed.args.token.toLowerCase() !== payment.token_address.toLowerCase()) continue;
          if (parsed.args.amount !== BigInt(payment.token_amount_base_units)) continue;
          if (Number(parsed.args.periodStart) !== Math.floor(new Date(payment.period_start).getTime()/1000)) continue;
          matched = true;
        } catch {}
      }
      if (!matched) return res.status(409).json({ error: "Confirmed transaction does not contain the expected subscription event" });
      const u = await db().query(
        "update subscription_payments set status='confirmed',tx_hash=$2,confirmed_at=now(),updated_at=now(),error_message=null where id=$1 and status<>'confirmed' returning *",
        [paymentId,txHash]
      );
      await db().query("update subscription_accounts set next_due_date=(date_trunc('month', $2::date)+interval '1 month')::date,updated_at=now() where user_id=$1",[req.user.id,payment.period_start]);
      await db().query("insert into subscription_events(payment_id,event_type,metadata) values($1,'confirmed',$2)",[paymentId,JSON.stringify({txHash,explorer:explorerTx(txHash)})]);
      await audit(req.user.id,"subscription.payment_confirmed","subscription_payment",paymentId,{txHash,period:payment.period_key});
      res.json({ payment: u.rows[0], explorer: explorerTx(txHash) });
    } catch (e) {
      console.error("subscription record", e);
      res.status(500).json({ error: "Unable to verify subscription transaction" });
    }
  });

  app.get("/api/whatsapp/authorization/:token", async (req,res) => {
    if (!subscriptionsEnabled()) return res.status(409).json({enabled:false,error:"Subscription payments are temporarily disabled."});
    try {
      const raw = String(req.params.token || "");
      if (!/^[a-f0-9]{64}$/.test(raw)) return res.status(400).json({error:"Invalid authorization token"});
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      const q = await db().query("select a.id as authorization_id,a.payment_id,a.user_id,a.expires_at,p.period_key,p.currency,p.fiat_amount_minor,p.token_address,p.token_amount_base_units,p.token_decimals,p.chain_id,p.subscription_contract,p.subscription_key,p.customer_key,u.phone from subscription_authorizations a join subscription_payments p on p.id=a.payment_id join users u on u.id=a.user_id where a.token_hash=$1 and a.used_at is null and a.expires_at>now() limit 1",[hash]);
      if (!q.rowCount) return res.status(404).json({error:"Authorization link is invalid or expired"});
      const x=q.rows[0];
      res.json({
        requestId:x.payment_id,paymentId:x.payment_id,period:x.period_key,fiatLabel:x.currency==="P"?"P5.00":"E5.00",
        token:x.token_address,tokenAmount:String(x.token_amount_base_units),decimals:Number(x.token_decimals),
        chainId:Number(x.chain_id),contract:x.subscription_contract,subscriptionKey:x.subscription_key,customerKey:x.customer_key,
        periodStart:periodStartUnix(monthStart(new Date(x.period_key+"-01T00:00:00Z"))),
        walletAddress:(await db().query("select address from wallets where user_id=$1 and chain_id=$2 and is_primary=true and verified_at is not null limit 1",[x.user_id,x.chain_id])).rows[0]?.address || null
      });
    } catch (e) { res.status(500).json({error:"Unable to load authorization request"}); }
  });

  app.post("/api/whatsapp/authorization/:token/record", async (req,res) => {
    if (!subscriptionsEnabled()) return res.status(409).json({enabled:false,error:"Subscription payments are temporarily disabled."});
    const client=await db().connect();
    try{
      const raw=String(req.params.token||""),txHash=String(req.body.txHash||"");
      if(!/^[a-f0-9]{64}$/.test(raw)||!/^0x[a-fA-F0-9]{64}$/.test(txHash))return res.status(400).json({error:"Authorization token and transaction hash are required"});
      await client.query("begin");
      const hash=crypto.createHash("sha256").update(raw).digest("hex");
      const q=await client.query("select a.id as authorization_id,a.user_id,a.payment_id,a.expires_at,p.* from subscription_authorizations a join subscription_payments p on p.id=a.payment_id where a.token_hash=$1 and a.used_at is null and a.expires_at>now() for update",[hash]);
      if(!q.rowCount){await client.query("rollback");return res.status(404).json({error:"Authorization link is invalid, expired, or already used"});}
      const payment=q.rows[0];
      if(payment.status==="confirmed"){await client.query("update subscription_authorizations set used_at=now() where id=$1",[payment.authorization_id]);await client.query("commit");return res.json({confirmed:true,payment});}
      const p=provider(),network=await p.getNetwork();
      if(Number(network.chainId)!==Number(payment.chain_id))throw new Error("Blockchain network mismatch");
      const tx=await p.getTransaction(txHash),receipt=await p.getTransactionReceipt(txHash);
      if(!tx||!receipt)throw new Error("Transaction is not confirmed yet");
      if(String(tx.from).toLowerCase()!==String((await client.query("select address from wallets where user_id=$1 and chain_id=$2 and is_primary=true and verified_at is not null limit 1",[payment.user_id,payment.chain_id])).rows[0]?.address||"").toLowerCase())throw new Error("Transaction sender does not match the verified wallet");
      if(String(tx.to||"").toLowerCase()!==String(payment.subscription_contract).toLowerCase())throw new Error("Transaction target does not match the subscription contract");
      if(receipt.status!==1)throw new Error("Subscription transaction reverted");
      const iface=new ethers.Interface(SUBSCRIPTION_ABI);let matched=false;
      for(const log of receipt.logs){try{const parsed=iface.parseLog(log);if(parsed&&parsed.name==="SubscriptionPaid"&&parsed.args.subscriptionKey.toLowerCase()===payment.subscription_key.toLowerCase()&&parsed.args.customerKey.toLowerCase()===payment.customer_key.toLowerCase()&&parsed.args.payer.toLowerCase()===tx.from.toLowerCase()&&parsed.args.token.toLowerCase()===payment.token_address.toLowerCase()&&parsed.args.amount===BigInt(payment.token_amount_base_units)&&Number(parsed.args.periodStart)===Math.floor(new Date(payment.period_start).getTime()/1000))matched=true;}catch{}}
      if(!matched)throw new Error("Confirmed transaction does not contain the expected subscription event");
      const u=await client.query("update subscription_payments set status='confirmed',tx_hash=$2,confirmed_at=now(),updated_at=now(),error_message=null where id=$1 and status<>'confirmed' returning *",[payment.payment_id,txHash]);
      await client.query("update subscription_accounts set next_due_date=(date_trunc('month', $2::date)+interval '1 month')::date,updated_at=now() where user_id=$1",[payment.user_id,payment.period_start]);
      await client.query("insert into subscription_events(payment_id,event_type,metadata) values($1,'confirmed',$2)",[payment.payment_id,JSON.stringify({txHash,source:"whatsapp_authorization"})]);
      await client.query("update subscription_authorizations set used_at=now() where id=$1",[payment.authorization_id]);
      await client.query("commit");
      try{await audit(payment.user_id,"subscription.payment_confirmed","subscription_payment",payment.payment_id,{txHash,source:"whatsapp_authorization"});}catch{}
      res.json({confirmed:true,payment:u.rows[0],explorer:explorerTx(txHash)});
    }catch(e){try{await client.query("rollback");}catch{}res.status(409).json({error:e.message||"Unable to verify subscription transaction"});}finally{client.release();}
  });

  app.get("/api/admin/subscriptions/summary", auth, requireRole(["admin","compliance","support"]), async (req,res) => {
    const q=await db().query(`select
      count(*) filter(where period_key=to_char(date_trunc('month',now()),'YYYY-MM') and status='confirmed')::int as paid_current,
      count(distinct user_id) filter(where period_key=to_char(date_trunc('month',now()),'YYYY-MM'))::int as current_customers,
      coalesce(sum(token_amount_base_units) filter(where status='confirmed'),0)::text as confirmed_token_base_units,
      coalesce(sum(fiat_amount_minor) filter(where status='confirmed'),0)::bigint as confirmed_fiat_minor
      from subscription_payments`);
    const due=await db().query(`select count(*)::int as due_current from subscription_accounts a
      where a.active=true and not exists(select 1 from subscription_payments p where p.user_id=a.user_id and p.period_key=to_char(date_trunc('month',now()),'YYYY-MM') and p.status='confirmed')`);
    res.json({summary:{...q.rows[0],due_current:due.rows[0].due_current}});
  });

  app.get("/api/admin/subscriptions", auth, requireRole(["admin","compliance","support"]), async (req, res) => {
    const q = await db().query("select s.*,u.email,u.country,u.phone from subscription_payments s join users u on u.id=s.user_id order by s.period_start desc,s.created_at desc limit 1000");
    res.json({ payments: q.rows });
  });
}
module.exports = { installSubscriptions, prepareSubscriptionForUser, createAuthorization, SUBSCRIPTION_ABI, monthStart, periodKey, makeSubscriptionKey, customerKey };
