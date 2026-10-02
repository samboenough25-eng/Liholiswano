const crypto = require("crypto");
const { ethers } = require("ethers");

const SUBSCRIPTION_ABI = [
  "function paySubscription(bytes32 subscriptionKey,bytes32 customerKey,uint256 periodStart,uint256 amount)",
  "function paid(bytes32) view returns(bool)",
  "function token() view returns(address)",
  "function treasury() view returns(address)",
  "event SubscriptionPaid(bytes32 indexed subscriptionKey,bytes32 indexed customerKey,address indexed payer,address token,uint256 amount,uint256 periodStart)"
];

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

function installSubscriptions({ app, db, auth, requireRole, audit }) {
  app.get("/api/subscription", auth, async (req, res) => {
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
    try {
      const current = monthStart();
      const period = periodKey(current);
      const account = fiatForCountry(req.user.country);
      const token = tokenAddress();
      const contract = subscriptionAddress();
      const tokenAmount = configuredTokenAmount(req.user.country);
      const decimals = Number(process.env.SUBSCRIPTION_TOKEN_DECIMALS || 6);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Invalid stablecoin decimals");
      const wallet = await db().query(
        "select address,chain_id from wallets where user_id=$1 and chain_id=$2 and is_primary=true and verified_at is not null limit 1",
        [req.user.id, Number(process.env.BSC_CHAIN_ID || 97)]
      );
      if (!wallet.rowCount) return res.status(400).json({ error: "Primary verified BNB wallet required" });
      const existing = await db().query(
        "select * from subscription_payments where user_id=$1 and period_key=$2 limit 1",
        [req.user.id, period]
      );
      if (existing.rowCount && existing.rows[0].status === "confirmed") return res.json({ payment: existing.rows[0], alreadyPaid: true });
      if (existing.rowCount && ["prepared","signed","submitted","reconciliation_required"].includes(existing.rows[0].status)) {
        return res.json({ payment: existing.rows[0], resume: true });
      }
      const key = makeSubscriptionKey(req.user.id, period);
      const ckey = customerKey(req.user.id);
      const rate = process.env.SUBSCRIPTION_RATE_BW_P_PER_USD || process.env.SUBSCRIPTION_RATE_SZ_E_PER_USD || null;
      const ins = await db().query(
        "insert into subscription_payments(user_id,period_start,period_key,currency,fiat_amount_minor,token_address,token_amount_base_units,token_decimals,chain_id,subscription_contract,subscription_key,customer_key,status,exchange_rate,rate_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'prepared',$13,$14) returning *",
        [req.user.id,current,period,account.currency,account.minor,token,tokenAmount.toString(),decimals,Number(process.env.BSC_CHAIN_ID || 97),contract,key,ckey,rate,rate ? "configured" : null]
      );
      await db().query("insert into subscription_events(payment_id,event_type,metadata) values($1,'prepared',$2)",[ins.rows[0].id,JSON.stringify({wallet:wallet.rows[0].address})]);
      res.status(201).json({
        payment: ins.rows[0],
        authorization: {
          contract,
          token,
          customerKey: ckey,
          subscriptionKey: key,
          periodStart: periodStartUnix(current),
          amount: tokenAmount.toString(),
          decimals,
          chainId: Number(process.env.BSC_CHAIN_ID || 97),
          explorer: null
        }
      });
    } catch (e) {
      console.error("subscription prepare", e);
      res.status(503).json({ error: e.message || "Subscription is not configured" });
    }
  });

  app.post("/api/subscription/record", auth, async (req, res) => {
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
      await db().query("insert into subscription_events(payment_id,event_type,metadata) values($1,'confirmed',$2)",[paymentId,JSON.stringify({txHash,explorer:explorerTx(txHash)})]);
      await audit(req.user.id,"subscription.payment_confirmed","subscription_payment",paymentId,{txHash,period:payment.period_key});
      res.json({ payment: u.rows[0], explorer: explorerTx(txHash) });
    } catch (e) {
      console.error("subscription record", e);
      res.status(500).json({ error: "Unable to verify subscription transaction" });
    }
  });

  app.get("/api/admin/subscriptions", auth, requireRole(["admin","compliance","support"]), async (req, res) => {
    const q = await db().query("select s.*,u.email,u.country,u.phone from subscription_payments s join users u on u.id=s.user_id order by s.period_start desc,s.created_at desc limit 1000");
    res.json({ payments: q.rows });
  });
}
module.exports = { installSubscriptions, SUBSCRIPTION_ABI, monthStart, periodKey, makeSubscriptionKey, customerKey };
