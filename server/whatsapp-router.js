const crypto = require("crypto");
const { menu } = require("./whatsapp");
const { groupState, memberState } = require("./blockchain");
const { assertAddress } = require("./wallet");

async function userByPhone(db, phone) {
  const q = await db.query(
    "select id,email,country,phone,phone_verified_at,kyc_status from users where phone=$1",
    [phone]
  );
  return q.rows[0] || null;
}

async function conversation(db, phone, contactId) {
  const q = await db.query(
    "select c.id,c.state,c.context from whatsapp_conversations c join whatsapp_contacts wc on wc.id=c.contact_id where wc.phone=$1 limit 1",
    [phone]
  );
  if (q.rowCount) return q.rows[0];
  if (!contactId) return null;
  const created = await db.query(
    "insert into whatsapp_conversations(contact_id,state,context) values($1,'menu','{}') returning id,state,context",
    [contactId]
  );
  return created.rows[0];
}

async function setConversation(db, id, state, context = {}) {
  await db.query(
    "update whatsapp_conversations set state=$2,context=$3,updated_at=now() where id=$1",
    [id, state, JSON.stringify(context)]
  );
}

function help() {
  return [
    "Liholiswano help",
    "",
    "MENU — main menu",
    "ACCOUNT — account status",
    "GROUPS — your ROSCAs",
    "JOIN <group ID> — request to join",
    "CONTRIBUTE <group ID> — request contribution",
    "BALANCE — confirmed balance",
    "PAYOUT <group ID> — current payout status",
    "TX <group ID> — recent transactions",
    "SUPPORT <message> — open support ticket",
    "",
    "Financial requests are not completed until the required wallet authorization and blockchain confirmation succeed."
  ].join("\n");
}

async function accountText(user) {
  return [
    "My account",
    "Email: " + user.email,
    "Country: " + user.country,
    "Phone: " + user.phone,
    "Phone verified: " + Boolean(user.phone_verified_at),
    "KYC status: " + user.kyc_status
  ].join("\n");
}

async function listGroups(db, user) {
  const q = await db.query(
    "select g.name,g.onchain_group_id,g.country,m.status from group_memberships m join groups g on g.id=m.group_id where m.user_id=$1 order by m.joined_at desc",
    [user.id]
  );
  if (!q.rowCount) return "You are not currently in a ROSCA.";
  return ["My groups", ...q.rows.map((x,i) =>
    (i + 1) + ". " + x.name + " [" + x.status + "]\n   " + x.onchain_group_id
  )].join("\n");
}

async function balanceText(db, user) {
  const q = await db.query(
    "select asset_symbol,sum(case when direction='credit' then amount else -amount end) balance from ledger_entries where user_id=$1 and status='confirmed' group by asset_symbol order by asset_symbol",
    [user.id]
  );
  return q.rowCount
    ? ["Confirmed balance", ...q.rows.map(x => x.asset_symbol + ": " + x.balance)].join("\n")
    : "No confirmed ledger balance yet.";
}

async function transactionText(db, user, groupId) {
  const params = [user.id];
  let sql = "select action,status,tx_hash,submitted_at,confirmed_at from blockchain_transactions where user_id=$1";
  if (groupId) {
    sql += " and group_id=$2";
    params.push(groupId);
  }
  sql += " order by submitted_at desc nulls last limit 10";
  const q = await db.query(sql, params);
  if (!q.rowCount) return "No blockchain transactions found.";
  return ["Transactions", ...q.rows.map(x =>
    x.action + " • " + x.status + (x.tx_hash ? " • " + x.tx_hash : "")
  )].join("\n");
}

async function prepareFinancialRequest(db, user, operation, groupId) {
  if (user.kyc_status !== "approved")
    return "KYC approval is required before this financial action.";

  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(groupId))
    return "Use the on-chain group ID exactly as provided by Liholiswano.";

  const wallet = await db.query(
    "select address,chain_id from wallets where user_id=$1 and is_primary=true and verified_at is not null limit 1",
    [user.id]
  );
  if (!wallet.rowCount) return "A verified primary BNB wallet is required before this action.";
  assertAddress(wallet.rows[0].address);

  const state = await groupState(process.env.BNB_CONTRACT_ADDRESS, groupId);
  if (!state.exists) return "ROSCA group not found.";
  if (operation === "contribute") {
    const member = await memberState(process.env.BNB_CONTRACT_ADDRESS, groupId, wallet.rows[0].address);
    if (!member.active) return "Your verified wallet is not an active member of this ROSCA.";
  }

  const idempotencyKey = crypto.randomUUID();
  const group = await db.query("select id from groups where onchain_group_id=$1", [groupId]);
  const contractAddress = String(process.env.BNB_CONTRACT_ADDRESS || "");
  const requestJson = {
    operation,
    onchainGroupId: groupId,
    walletAddress: wallet.rows[0].address,
    chainId: Number(wallet.rows[0].chain_id || process.env.BSC_CHAIN_ID || 97),
    contractAddress,
    status: "prepared",
    source: "whatsapp"
  };

  const inserted = await db.query(
    "insert into transaction_requests(user_id,group_id,operation,idempotency_key,wallet_address,chain_id,contract_address,onchain_group_id,request_json,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'prepared') returning id,created_at",
    [
      user.id,
      group.rowCount ? group.rows[0].id : null,
      operation,
      idempotencyKey,
      wallet.rows[0].address,
      requestJson.chainId,
      contractAddress,
      groupId,
      JSON.stringify(requestJson)
    ]
  );

  if (process.env.WALLET_MODE === "managed") {
    return [
      "Request created: " + inserted.rows[0].id,
      "Action: " + operation.toUpperCase(),
      "ROSCA: " + groupId,
      "Amount: enforced by the smart contract",
      "",
      "The wallet authorization service is required to sign this request. No funds have moved."
    ].join("\n");
  }

  return [
    "Request created: " + inserted.rows[0].id,
    "Action: " + operation.toUpperCase(),
    "ROSCA: " + groupId,
    "",
    "Wallet authorization is not configured yet. No funds have moved.",
    "A production WhatsApp-only customer experience requires a secure wallet-signing service or supported wallet handoff."
  ].join("\n");
}

async function handleCommand({ phone, text, db, contactId }) {
  const input = String(text || "").trim();
  const normalized = input.toLowerCase();
  const user = await userByPhone(db, phone);
  const conv = await conversation(db, phone, contactId);

  if (normalized.startsWith("link ")) {
    const code = input.slice(5).trim();
    if (!/^\d{6}$/.test(code)) return "Use: LINK <6-digit code>.";
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    const q = await db.query(
      "select id,user_id from whatsapp_link_tokens where phone=$1 and token_hash=$2 and used_at is null and expires_at>now() order by created_at desc limit 1",
      [phone, hash]
    );
    if (!q.rowCount) return "That linking code is invalid or expired. Start a new link request.";
    const conflict = await db.query(
      "select id from users where lower(phone)=lower($1) and id<>$2 limit 1",
      [phone, q.rows[0].user_id]
    );
    if (conflict.rowCount) return "This WhatsApp number is already linked to another account. Contact support.";
    await db.query("update whatsapp_link_tokens set used_at=now() where id=$1", [q.rows[0].id]);
    await db.query(
      "update users set phone=$1,phone_verified_at=now(),updated_at=now() where id=$2",
      [phone, q.rows[0].user_id]
    );
    await db.query(
      "update whatsapp_contacts set user_id=$1,verified_at=now(),updated_at=now() where phone=$2",
      [q.rows[0].user_id, phone]
    );
    if (conv) await setConversation(db, conv.id, "menu", {});
    return "Your WhatsApp number is verified and linked. Reply MENU to continue.";
  }

  if (["hi","hello","menu","start"].includes(normalized)) {
    if (conv) await setConversation(db, conv.id, "menu", {});
    return menu();
  }

  if (!user)
    return "Your WhatsApp number is not linked to a Liholiswano account yet. Complete account setup and WhatsApp linking first.";

  if (!user.phone_verified_at)
    return "This WhatsApp number is registered but not verified. Use LINK <6-digit code> from your Liholiswano account.";

  if (normalized === "help") return help();
  if (normalized === "1" || normalized === "account") return accountText(user);
  if (normalized === "2") return "Send JOIN <group ID>.";
  if (normalized === "3" || normalized === "groups") return listGroups(db, user);
  if (normalized === "4") return "Send CONTRIBUTE <group ID>.";
  if (normalized === "5" || normalized === "balance") return balanceText(db, user);
  if (normalized === "6") return "Send PAYOUT <group ID>.";
  if (normalized === "7" || normalized === "transactions") return transactionText(db, user);
  if (normalized === "8" || normalized === "support") return "Send SUPPORT followed by your message.";

  if (normalized.startsWith("support ")) {
    const description = input.slice(8).trim();
    if (description.length < 2) return "Please send SUPPORT followed by your message.";
    const q = await db.query(
      "insert into support_tickets(user_id,subject,description,priority) values($1,$2,$3,'normal') returning id",
      [user.id, "WhatsApp support", description]
    );
    return "Support ticket " + q.rows[0].id + " has been created.";
  }

  if (normalized.startsWith("state ")) {
    const id = input.slice(6).trim();
    try {
      const s = await groupState(process.env.BNB_CONTRACT_ADDRESS, id);
      return [
        "ROSCA state",
        "Round: " + s.round,
        "Members: " + s.memberCount,
        "Contribution: " + s.contribution,
        "Deadline: " + new Date(Number(s.roundDeadline) * 1000).toISOString()
      ].join("\n");
    } catch {
      return "Unable to retrieve that ROSCA state.";
    }
  }

  if (normalized.startsWith("join ")) {
    const id = input.slice(5).trim();
    try {
      const result = await prepareFinancialRequest(db, user, "join", id);
      if (conv) await setConversation(db, conv.id, "awaiting_wallet_authorization", { operation: "join", groupId: id });
      return result;
    } catch (e) {
      return "Unable to prepare the ROSCA join request: " + String(e.message || e);
    }
  }

  if (normalized.startsWith("contribute ")) {
    const parts = input.split(/\s+/);
    if (parts.length !== 2) return "Use: CONTRIBUTE <group ID>.";
    try {
      const result = await prepareFinancialRequest(db, user, "contribute", parts[1]);
      if (conv) await setConversation(db, conv.id, "awaiting_wallet_authorization", { operation: "contribute", groupId: parts[1] });
      return result;
    } catch (e) {
      return "Unable to prepare the contribution request: " + String(e.message || e);
    }
  }

  if (normalized.startsWith("payout ")) {
    const id = input.slice(7).trim();
    try {
      const s = await groupState(process.env.BNB_CONTRACT_ADDRESS, id);
      return [
        "Payout status",
        "ROSCA: " + id,
        "Round: " + s.round,
        "Rotation: " + s.rotation,
        "Escrow: " + s.escrowBalance,
        "Deadline: " + new Date(Number(s.roundDeadline) * 1000).toISOString()
      ].join("\n");
    } catch {
      return "Unable to retrieve payout status for that ROSCA.";
    }
  }

  if (normalized.startsWith("tx ")) return transactionText(db, user, input.slice(3).trim());

  return "I did not understand that. Reply MENU or HELP.";
}

module.exports = { handleCommand };
