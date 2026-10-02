const {menu}=require("./whatsapp");
const {groupState,memberState}=require("./blockchain");
const {assertAddress}=require("./wallet");

async function userByPhone(db,phone){
  const q=await db.query("select id,email,country,phone,phone_verified_at,kyc_status from users where phone=$1",[phone]);
  return q.rows[0]||null;
}
async function handleCommand({phone,text,db}){
  const input=String(text||"").trim();
  const normalized=input.toLowerCase();
  const user=await userByPhone(db,phone);

  if(normalized.startsWith("link ")){
    const code=input.slice(5).trim();
    if(!/^\\d{6}$/.test(code)) return "Use: LINK <6-digit code>.";
    const crypto=require("crypto");
    const hash=crypto.createHash("sha256").update(code).digest("hex");
    const q=await db.query("select id,user_id from whatsapp_link_tokens where phone=$1 and token_hash=$2 and used_at is null and expires_at>now() order by created_at desc limit 1",[phone,hash]);
    if(!q.rowCount) return "That linking code is invalid or expired. Start a new link request in your Liholiswano account.";
    const conflict=await db.query("select id from users where lower(phone)=lower($1) and id<>$2 limit 1",[phone,q.rows[0].user_id]);
    if(conflict.rowCount) return "This WhatsApp number is already linked to another account. Contact support.";
    await db.query("update whatsapp_link_tokens set used_at=now() where id=$1",[q.rows[0].id]);
    await db.query("update users set phone=$1,phone_verified_at=now(),updated_at=now() where id=$2",[phone,q.rows[0].user_id]);
    await db.query("update whatsapp_contacts set user_id=$1,verified_at=now(),updated_at=now() where phone=$2",[q.rows[0].user_id,phone]);
    return "Your WhatsApp number is now verified and linked to your Liholiswano account. Reply MENU to continue.";
  }

  if(["hi","hello","menu","start"].includes(normalized)) return menu();
  if(!user) return "Your WhatsApp number is not linked to a Liholiswano account yet. Please complete account setup first.";
  if(!user.phone_verified_at) return "This WhatsApp number is registered but not verified for Liholiswano. Use the linking code sent from your Liholiswano account: LINK <6-digit code>.";

  if(normalized==="1"||normalized==="account")
    return "Account\nEmail: "+user.email+"\nCountry: "+user.country+"\nKYC: "+user.kyc_status;

  if(normalized==="2"||normalized==="join")
    return "To join a ROSCA, send: JOIN <group ID>. Your account must have approved KYC and a primary BNB wallet.";

  if(normalized==="3"||normalized==="groups"){
    const q=await db.query("select g.name,g.onchain_group_id,g.country,m.status from group_memberships m join groups g on g.id=m.group_id where m.user_id=$1 order by m.joined_at desc",[user.id]);
    return q.rowCount?q.rows.map((x,i)=>(i+1)+". "+x.name+" ["+x.status+"]").join("\n"):"You are not currently in a ROSCA.";
  }

  if(normalized==="4"||normalized==="contribute")
    return "To contribute, send: CONTRIBUTE <group ID>. The contribution amount is determined by the on-chain group.";

  if(normalized==="5"||normalized==="balance"){
    const q=await db.query("select asset_symbol,sum(case when direction='credit' then amount else -amount end) balance from ledger_entries where user_id=$1 and status='confirmed' group by asset_symbol order by asset_symbol",[user.id]);
    return q.rowCount?q.rows.map(x=>x.asset_symbol+": "+x.balance).join("\n"):"No confirmed ledger balance yet.";
  }

  if(normalized==="6"||normalized==="payout")
    return "Your next payout is determined from the current on-chain ROSCA rotation.";

  if(normalized==="7"||normalized==="transactions"){
    const q=await db.query("select action,status,tx_hash,created_at from blockchain_transactions where user_id=$1 order by submitted_at desc limit 10",[user.id]);
    return q.rowCount?q.rows.map(x=>x.action+" • "+x.status+" • "+x.tx_hash).join("\n"):"No blockchain transactions yet.";
  }

  if(normalized==="8"||normalized==="support")
    return "Send SUPPORT followed by your message.";

  if(normalized.startsWith("support ")){
    const description=input.slice(8).trim();
    if(description.length<2) return "Please send SUPPORT followed by your message.";
    const q=await db.query("insert into support_tickets(user_id,subject,description,priority) values($1,$2,$3,'normal') returning id",[user.id,"WhatsApp support",description]);
    return "Support ticket "+q.rows[0].id+" has been created.";
  }

  if(normalized.startsWith("state ")){
    const id=input.slice(6).trim();
    try{
      const s=await groupState(process.env.BNB_CONTRACT_ADDRESS,id);
      return "ROSCA state\nRound: "+s.round+"\nMembers: "+s.memberCount+"\nContribution: "+s.contribution+"\nDeadline: "+new Date(s.roundDeadline*1000).toISOString();
    }catch{return "Unable to retrieve that ROSCA state.";}
  }

  if(normalized.startsWith("join ")){
    if(user.kyc_status!=="approved") return "KYC approval is required before joining a ROSCA.";
    const id=input.slice(5).trim();
    try{
      const s=await groupState(process.env.BNB_CONTRACT_ADDRESS,id);
      if(!s.exists) return "ROSCA group not found.";
      const wallet=await db.query("select address from wallets where user_id=$1 and is_primary=true",[user.id]);
      if(!wallet.rowCount) return "Please link a primary BNB wallet before joining.";
      assertAddress(wallet.rows[0].address);
      const existing=await db.query("select 1 from group_memberships gm join groups g on g.id=gm.group_id where gm.user_id=$1 and g.onchain_group_id=$2",[user.id,id]);
      if(existing.rowCount) return "You are already recorded as a member of this ROSCA.";
      return "ROSCA "+id+" is available. Transaction signing is waiting for managed-wallet configuration; no funds have moved.";
    }catch{return "Unable to prepare the ROSCA join request.";}
  }

  if(normalized.startsWith("contribute ")){
    if(user.kyc_status!=="approved") return "KYC approval is required before contributing.";
    const parts=input.split(/\s+/);
    if(parts.length!==2) return "Use: CONTRIBUTE <group ID>";
    try{
      const s=await groupState(process.env.BNB_CONTRACT_ADDRESS,parts[1]);
      const wallet=await db.query("select address from wallets where user_id=$1 and is_primary=true",[user.id]);
      if(!wallet.rowCount) return "Please link a primary BNB wallet first.";
      const member=await memberState(process.env.BNB_CONTRACT_ADDRESS,parts[1],wallet.rows[0].address);
      if(!member.active) return "Your wallet is not an active member of this ROSCA.";
      return "Contribution request prepared for "+s.contribution+" token units. Transaction signing is waiting for managed-wallet configuration; no funds have moved.";
    }catch{return "Unable to prepare the contribution request.";}
  }

  return "I did not understand that. Reply MENU to see the available options.";
}
module.exports={handleCommand};
