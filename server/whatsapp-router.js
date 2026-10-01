const {menu}=require("./whatsapp");
async function userByPhone(db,phone){const q=await db.query("select id,email,country,phone,kyc_status from users where phone=$1",[phone]);return q.rows[0]||null;}
async function handleCommand({phone,text,db}){
 const input=String(text||"").trim(), normalized=input.toLowerCase(), user=await userByPhone(db,phone);
 if(["hi","hello","menu","start"].includes(normalized)) return menu();
 if(!user)return "Your WhatsApp number is not linked to a Liholiswano account yet. Please complete account setup first.";
 if(normalized==="1"||normalized==="account") return "Account\nEmail: "+user.email+"\nCountry: "+user.country+"\nKYC: "+user.kyc_status;
 if(normalized==="2"||normalized==="join") return "To join a ROSCA, send: JOIN <group ID>. Your account must have approved KYC.";
 if(normalized==="3"||normalized==="groups"){const q=await db.query("select g.name,g.onchain_group_id,g.country,m.status from group_memberships m join groups g on g.id=m.group_id where m.user_id=$1 order by m.joined_at desc",[user.id]);return q.rowCount?q.rows.map((x,i)=>((i+1)+". "+x.name+" ["+x.status+"]")).join("\n"):"You are not currently in a ROSCA.";}
 if(normalized==="4"||normalized==="contribute")return "To contribute, send: CONTRIBUTE <group ID> <amount>. A transaction request will only be created after eligibility checks.";
 if(normalized==="5"||normalized==="balance"){const q=await db.query("select asset_symbol,sum(case when direction='credit' then amount else -amount end) balance from ledger_entries where user_id=$1 and status='confirmed' group by asset_symbol order by asset_symbol",[user.id]);return q.rowCount?q.rows.map(x=>x.asset_symbol+": "+x.balance).join("\n"):"No confirmed ledger balance yet.";}
 if(normalized==="6"||normalized==="payout")return "Your next payout will be calculated from the on-chain ROSCA state after the group is indexed.";
 if(normalized==="7"||normalized==="transactions"){const q=await db.query("select action,status,tx_hash,created_at from blockchain_transactions where user_id=$1 order by submitted_at desc limit 10",[user.id]);return q.rowCount?q.rows.map(x=>x.action+" • "+x.status+" • "+x.tx_hash).join("\n"):"No blockchain transactions yet.";}
 if(normalized==="8"||normalized==="support")return "Send SUPPORT followed by your message.";
 if(normalized.startsWith("support ")){const description=input.slice(8).trim();if(description.length<2)return "Please send SUPPORT followed by your message.";const q=await db.query("insert into support_tickets(user_id,subject,description,priority) values($1,$2,$3,'normal') returning id",[user.id,"WhatsApp support",description]);return "Support ticket "+q.rows[0].id+" has been created.";}
 if(normalized.startsWith("join ")){if(user.kyc_status!=="approved")return "KYC approval is required before joining a ROSCA.";const id=input.slice(5).trim();const q=await db.query("select id,name from groups where onchain_group_id=$1 and status not in ('suspended','completed')",[id]);return q.rowCount?"Group "+q.rows[0].name+" found. The wallet transaction step will be enabled after managed-wallet configuration.":"ROSCA group not found.";}
 return "I did not understand that. Reply MENU to see the available options.";
}
module.exports={handleCommand};