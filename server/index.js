require("dotenv").config();
const fs=require("fs");
const crypto=require("crypto");
const {verifyMessage}=require("ethers");
const path=require("path");
const express=require("express");
const {spawn}=require("child_process");
const helmet=require("helmet");
const cors=require("cors");
const rateLimit=require("express-rate-limit");
const {z}=require("zod");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");
const {normalizePhone,verifySignature,normalizeInbound,menu,sendText}=require("./whatsapp");
const {handleCommand}=require("./whatsapp-router");

const app=express();
const port=Number(process.env.PORT||3000);
const jwtSecret=process.env.JWT_SECRET;
if(!jwtSecret) console.warn("JWT_SECRET is not set; authenticated routes will reject requests.");

const pool=process.env.DATABASE_URL?new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false},
}):null;

app.set("trust proxy",1);
app.use(helmet());
app.use(cors({origin:process.env.CORS_ORIGIN?process.env.CORS_ORIGIN.split(",").map(s=>s.trim()):true,credentials:false}));
app.use(express.json({limit:"100kb",verify:(req,res,buf)=>{if(req.path==="/api/whatsapp/webhook")req.rawBody=Buffer.from(buf);}}));
app.use("/api/auth",rateLimit({windowMs:15*60*1000,max:25,standardHeaders:true,legacyHeaders:false}));

function db(){if(!pool) throw new Error("DATABASE_URL is not configured.");return pool;}
async function audit(actorUserId,action,entityType,entityId,metadata={}){await db().query("insert into audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,$5)",[actorUserId,action,entityType,entityId,JSON.stringify(metadata||{})]);}
const requireRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:"Insufficient permissions"});
function sign(user){if(!jwtSecret) throw new Error("JWT_SECRET is not configured.");return jwt.sign({sub:user.id,email:user.email,role:user.role},jwtSecret,{expiresIn:process.env.JWT_EXPIRES_IN||"2h",issuer:"liholiswano"});}
async function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
    if(!jwtSecret) return res.status(503).json({error:"Authentication is not configured"});
    const claims=jwt.verify(h.slice(7),jwtSecret,{issuer:"liholiswano"});
    const r=await db().query("select id,email,role,status,country,phone,kyc_status from users where id=$1",[claims.sub]);
    if(!r.rowCount) return res.status(401).json({error:"User not found"});
    if(r.rows[0].status!=="active") return res.status(403).json({error:"Account is not active"});
    req.user=r.rows[0]; next();
  }catch(e){return res.status(401).json({error:"Invalid or expired authentication token"});}
}


// Provider-neutral WhatsApp webhook. Provider credentials stay in environment variables.
app.get("/api/whatsapp/webhook",(req,res)=>{
  const mode=req.query["hub.mode"], token=req.query["hub.verify_token"], challenge=req.query["hub.challenge"];
  if(mode==="subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && token===process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(challenge||""));
  return res.sendStatus(403);
});
app.post("/api/whatsapp/webhook",async(req,res)=>{
  try{
    const raw=req.rawBody;
    if(!process.env.WHATSAPP_APP_SECRET) return res.status(503).json({error:"WhatsApp webhook security is not configured"});
    if(!raw || !verifySignature(raw,req.headers["x-hub-signature-256"],process.env.WHATSAPP_APP_SECRET)) return res.sendStatus(401);
    const msg=normalizeInbound(req.body);
    if(!msg) return res.sendStatus(200);
    const phone=msg.phone;
    const contact=await db().query("insert into whatsapp_contacts(phone,last_seen_at,updated_at) values($1,now(),now()) on conflict(phone) do update set last_seen_at=now(),updated_at=now() returning id,user_id",[phone]);
    const contactId=contact.rows[0].id;
    const existing=await db().query("select id from whatsapp_messages where provider_message_id=$1",[msg.messageId]);
    if(existing.rowCount) return res.sendStatus(200);
    await db().query("insert into whatsapp_messages(contact_id,provider_message_id,direction,message_type,body,status) values($1,$2,'inbound','text',$3,'received')",[contactId,msg.messageId,msg.text]);
    let reply;
    if(!contact.rows[0].user_id){
      const user=await db().query("select id from users where phone=$1",[phone]);
      if(user.rowCount){
        await db().query("update whatsapp_contacts set user_id=$1,verified_at=coalesce(verified_at,now()) where id=$2",[user.rows[0].id,contactId]);
        reply=await handleCommand({phone,text:msg.text,db:db()});
      } else reply="Your WhatsApp number is not linked to a Liholiswano account yet. Please complete account setup first.";
    } else reply=await handleCommand({phone,text:msg.text,db:db()});
    const outbound=await sendText({to:phone,text:reply});
    if(outbound.status==="sent") await db().query("insert into whatsapp_messages(contact_id,provider_message_id,direction,message_type,body,status) values($1,$2,'outbound','text',$3,'sent')",[contactId,"local:"+msg.messageId,reply]);
    res.sendStatus(200);
  }catch(e){console.error("WhatsApp webhook error",e);res.sendStatus(200);}
});

app.get("/api/system/status",auth,requireRole(["admin","compliance","support"]),async(req,res)=>{let chain={status:"not_configured"};try{const {chainInfo}=require("./blockchain");chain=await chainInfo();}catch(e){chain={status:"error",message:String(e.message).slice(0,200)}}res.json({api:"ok",database:pool?"configured":"not_configured",whatsapp:Boolean(process.env.WHATSAPP_API_URL&&process.env.WHATSAPP_ACCESS_TOKEN),kyc:Boolean(process.env.KYC_PROVIDER),compliance:Boolean(process.env.COMPLIANCE_API_URL&&process.env.COMPLIANCE_API_KEY),walletMode:process.env.WALLET_MODE||"managed",chain});});

app.get("/health",async(req,res)=>{
  let database="not_configured";
  if(pool){try{await pool.query("select 1");database="ok";}catch{database="error";}}
  res.json({service:"liholiswano-api",status:"ok",database,environment:process.env.NODE_ENV||"development"});
});

const registerSchema=z.object({
  email:z.string().trim().email().max(254),
  password:z.string().min(12).max(128),
  country:z.enum(["BW","SZ"]),
  phone:z.string().trim().min(7).max(30).optional()
});
app.post("/api/auth/register",async(req,res)=>{
  try{
    const body=registerSchema.parse(req.body);
    const email=body.email.toLowerCase();
    const passwordHash=await bcrypt.hash(body.password,12);
    const r=await db().query(
      "insert into users(email,password_hash,country,phone) values($1,$2,$3,$4) returning id,email,role,status,country,phone,kyc_status",
      [email,passwordHash,body.country,body.phone||null]
    );
    const user=r.rows[0];
    await db().query("insert into audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1,'user.registered','user',$1,$2)",[user.id,JSON.stringify({country:user.country})]);
    res.status(201).json({user,token:sign(user)});
  }catch(e){
    if(e.name==="ZodError") return res.status(400).json({error:"Invalid registration data",details:e.issues.map(x=>x.path.join(".")+": "+x.message)});
    if(e.code==="23505") return res.status(409).json({error:"An account with that email already exists"});
    console.error(e); res.status(500).json({error:"Registration failed"});
  }
});

app.post("/api/auth/login",async(req,res)=>{
  try{
    const body=z.object({email:z.string().email(),password:z.string().min(1).max(128)}).parse(req.body);
    const r=await db().query("select id,email,password_hash,role,status,country,phone,kyc_status from users where email=$1",[body.email.toLowerCase()]);
    if(!r.rowCount) return res.status(401).json({error:"Invalid email or password"});
    const user=r.rows[0];
    if(!(await bcrypt.compare(body.password,user.password_hash))) return res.status(401).json({error:"Invalid email or password"});
    if(user.status!=="active") return res.status(403).json({error:"Account is not active"});
    delete user.password_hash;
    await db().query("insert into audit_log(actor_user_id,action,entity_type,entity_id) values($1,'user.login','user',$1)",[user.id]);
    res.json({user,token:sign(user)});
  }catch(e){
    if(e.name==="ZodError") return res.status(400).json({error:"Invalid login data"});
    console.error(e);res.status(500).json({error:"Login failed"});
  }
});

app.get("/api/admin/reconciliation",auth,requireRole(["admin","compliance"]),async(req,res)=>{
  try{
    const runs=await db().query("select id,chain_id,contract_address,from_block,to_block,status,discrepancy_count,details,report,started_at,completed_at,finished_at from reconciliation_runs order by started_at desc limit 20");
    const open=await db().query("select id,run_id,severity,category,entity_type,entity_key,expected,actual,created_at from reconciliation_discrepancies where resolved_at is null order by created_at desc limit 200");
    res.json({runs:runs.rows,openDiscrepancies:open.rows});
  }catch(e){res.status(500).json({error:"Unable to load reconciliation status"});}
});
app.post("/api/admin/reconciliation/run",auth,requireRole(["admin"]),async(req,res)=>{
  try{
    const {run}=require("./reconcile");
    const result=await run();
    res.status(result.status==="failed"?409:200).json(result);
  }catch(e){console.error("reconciliation run failed",e);res.status(500).json({error:"Reconciliation failed",message:e.message});}
});
app.post("/api/admin/reconciliation/discrepancies/:id/resolve",auth,requireRole(["admin","compliance"]),async(req,res)=>{
  const note=String(req.body.note||"").trim().slice(0,2000);if(note.length<5)return res.status(400).json({error:"A resolution note of at least 5 characters is required"});
  const q=await db().query("update reconciliation_discrepancies set resolved_at=now(),resolution_note=$2 where id=$1 and resolved_at is null returning id",[req.params.id,note||"Resolved by authorized operator"]);
  if(!q.rowCount)return res.status(404).json({error:"Open discrepancy not found"});
  await audit(req.user.id,"reconciliation.discrepancy_resolved","reconciliation_discrepancy",q.rows[0].id,{note});
  res.json({resolved:true,id:q.rows[0].id});
});

app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));
app.get("/api/transactions/requests",auth,async(req,res)=>{const q=await db().query("select id,operation,wallet_address,chain_id,contract_address,onchain_group_id,status,tx_hash,request_json,error_message,created_at,updated_at,confirmed_at from transaction_requests where user_id=$1 order by created_at desc limit 100",[req.user.id]);res.json({requests:q.rows})});
app.post("/api/transactions/prepare",auth,async(req,res)=>{try{if(req.user.kyc_status!=="approved")return res.status(403).json({error:"KYC approval is required"});const b=req.body||{},operation=String(b.operation||"").trim(),onchainGroupId=String(b.onchainGroupId||"").trim(),key=String(req.headers["idempotency-key"]||b.idempotencyKey||"").trim();if(!["join","contribute","bid"].includes(operation)||!onchainGroupId||key.length<8||key.length>255)return res.status(400).json({error:"operation, onchainGroupId and a valid Idempotency-Key are required"});const prior=await db().query("select response from idempotency_keys where key=$1 and user_id=$2",[key,req.user.id]);if(prior.rowCount)return res.json(prior.rows[0].response);const w=await db().query("select address from wallets where user_id=$1 and chain_id=$2 and is_primary=true and verified_at is not null",[req.user.id,configuredChainId]);if(!w.rowCount)return res.status(400).json({error:"Primary BNB wallet required"});const contractAddress=String(process.env.BNB_CONTRACT_ADDRESS||"");if(!/^0x[a-f-f0-9]{40}$/i.test(contractAddress))return res.status(503).json({error:"BNB contract is not configured"});const g=await db().query("select id from groups where onchain_group_id=$1",[onchainGroupId]);const request={operation,onchainGroupId,walletAddress:w.rows[0].address,chainId:configuredChainId,contractAddress,status:"prepared"};const ins=await db().query("insert into transaction_requests(user_id,group_id,operation,idempotency_key,wallet_address,chain_id,contract_address,onchain_group_id,request_json) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,operation,status,onchain_group_id,wallet_address,chain_id,contract_address,created_at", [req.user.id,g.rowCount?g.rows[0].id:null,operation,key,w.rows[0].address,request.chainId,contractAddress,onchainGroupId,JSON.stringify(request)]);const response={request:ins.rows[0],signingStatus:"not_configured"};await db().query("insert into idempotency_keys(key,user_id,operation,response) values($1,$2,$3,$4)",[key,req.user.id,operation,JSON.stringify(response)]);await audit(req.user.id,"transaction.prepared","transaction_request",ins.rows[0].id,{operation,onchainGroupId});res.status(201).json(response);}catch(e){console.error(e);res.status(400).json({error:"Unable to prepare transaction request"})}});

app.get("/api/me/eligibility",auth,async(req,res)=>{
  const restricted=req.user.kyc_status==="approved";
  res.json({kycStatus:req.user.kyc_status,restrictedFinancialOperations:restricted,reason:restricted?null:"KYC approval is required for restricted financial operations"});
});



app.get("/api/groups",auth,async(req,res)=>{const q=await db().query("select g.id,g.chain_id,g.contract_address,g.onchain_group_id,g.name,g.country,g.status,g.metadata,g.created_at,count(m.id)::int member_count from groups g left join group_memberships m on m.group_id=g.id and m.status in ('active','pending') where g.status<>'suspended' group by g.id order by g.created_at desc");res.json({groups:q.rows})});
app.get("/api/groups/:id",auth,async(req,res)=>{const q=await db().query("select g.*,(select count(*) from group_memberships m where m.group_id=g.id)::int member_count from groups g where g.id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"Group not found"});const m=await db().query("select user_id,wallet_address,status,joined_at,left_at from group_memberships where group_id=$1 order by joined_at",[req.params.id]);res.json({group:q.rows[0],members:m.rows})});
app.post("/api/groups/:id/join",auth,async(req,res)=>{try{if(req.user.kyc_status!=="approved")return res.status(403).json({error:"KYC approval is required"});const a=String(req.body.walletAddress||"");if(!/^0x[a-fA-F0-9]{40}$/.test(a))return res.status(400).json({error:"Invalid wallet address"});const wallet=await db().query("select id from wallets where user_id=$1 and chain_id=$3 and lower(address)=lower($2) and verified_at is not null",[req.user.id,a,configuredChainId]);if(!wallet.rowCount)return res.status(403).json({error:"Verify ownership of this wallet before joining a group"});const q=await db().query("insert into group_memberships(group_id,user_id,wallet_address) values($1,$2,$3) returning *",[req.params.id,req.user.id,a.toLowerCase()]);await audit(req.user.id,"group.joined","group",req.params.id);res.status(201).json({membership:q.rows[0]})}catch(e){if(e.code==="23505")return res.status(409).json({error:"Already a member or wallet already used"});res.status(400).json({error:"Unable to join group"})}});



app.get("/api/profile",auth,async(req,res)=>{const q=await db().query("select u.id,u.email,u.country,u.phone,u.kyc_status,u.email_verified_at,p.first_name,p.last_name,p.date_of_birth,p.address,p.city,p.preferred_language from users u left join user_profiles p on p.user_id=u.id where u.id=$1",[req.user.id]);res.json({profile:q.rows[0]})});
app.put("/api/profile",auth,async(req,res)=>{try{const b=req.body||{};if(b.firstName&&String(b.firstName).length>80)return res.status(400).json({error:"Invalid first name"});if(b.lastName&&String(b.lastName).length>80)return res.status(400).json({error:"Invalid last name"});await db().query("insert into user_profiles(user_id,first_name,last_name,date_of_birth,address,city,preferred_language) values($1,$2,$3,$4,$5,$6,coalesce($7,'en')) on conflict(user_id) do update set first_name=coalesce(excluded.first_name,user_profiles.first_name),last_name=coalesce(excluded.last_name,user_profiles.last_name),date_of_birth=coalesce(excluded.date_of_birth,user_profiles.date_of_birth),address=coalesce(excluded.address,user_profiles.address),city=coalesce(excluded.city,user_profiles.city),preferred_language=coalesce(excluded.preferred_language,user_profiles.preferred_language),updated_at=now()",[req.user.id,b.firstName||null,b.lastName||null,b.dateOfBirth||null,b.address||null,b.city||null,b.preferredLanguage||null]);await audit(req.user.id,"profile.updated","user",req.user.id);res.json({updated:true})}catch(e){res.status(400).json({error:"Invalid profile data"})}});
app.get("/api/wallets",auth,async(req,res)=>{const q=await db().query("select id,chain_id,address,label,is_primary,verified_at,created_at from wallets where user_id=$1 order by is_primary desc,created_at desc",[req.user.id]);res.json({wallets:q.rows})});
app.post("/api/wallets/challenge",auth,async(req,res)=>{const a=String(req.body.address||"").trim();const chain=Number(req.body.chainId||configuredChainId);if(!/^0x[a-fA-F0-9]{40}$/.test(a)||chain!==configuredChainId)return res.status(400).json({error:"Invalid BNB wallet for the configured network"});const nonce=crypto.randomBytes(32).toString("hex");const expiresAt=new Date(Date.now()+10*60*1000);await db().query("insert into wallet_challenges(user_id,chain_id,address,nonce,expires_at) values($1,$2,$3,$4,$5)",[req.user.id,chain,a.toLowerCase(),nonce,expiresAt]);const message="Liholiswano wallet verification\\n\\nChain: "+networkLabel+"\\nAddress: "+a.toLowerCase()+"\\nNonce: "+nonce+"\\nExpires: "+expiresAt.toISOString()+"\\n\\nThis signature proves control of this wallet. It does not authorize a blockchain transaction.";res.json({message,expiresAt:expiresAt.toISOString()});});
app.post("/api/wallets",auth,async(req,res)=>{const a=String(req.body.address||"").trim();const chain=Number(req.body.chainId||configuredChainId);const message=String(req.body.message||"");const signature=String(req.body.signature||"");if(!/^0x[a-fA-F0-9]{40}$/.test(a)||chain!==configuredChainId||!message||!signature)return res.status(400).json({error:"Wallet ownership signature is required"});try{const challenge=await db().query("select id,nonce,expires_at from wallet_challenges where user_id=$1 and chain_id=$2 and lower(address)=lower($3) and used_at is null and expires_at>now() order by created_at desc limit 1",[req.user.id,chain,a]);if(!challenge.rowCount)return res.status(400).json({error:"Wallet verification challenge expired or not found"});const expected="Liholiswano wallet verification\\n\\nChain: "+networkLabel+"\\nAddress: "+a.toLowerCase()+"\\nNonce: "+challenge.rows[0].nonce+"\\nExpires: "+new Date(challenge.rows[0].expires_at).toISOString()+"\\n\\nThis signature proves control of this wallet. It does not authorize a blockchain transaction.";if(message!==expected)return res.status(400).json({error:"Invalid wallet verification message"});const recovered=verifyMessage(message,signature);if(recovered.toLowerCase()!==a.toLowerCase())return res.status(403).json({error:"Wallet signature does not match address"});await db().query("update wallet_challenges set used_at=now() where id=$1",[challenge.rows[0].id]);if(req.body.primary)await db().query("update wallets set is_primary=false where user_id=$1",[req.user.id]);const q=await db().query("insert into wallets(user_id,chain_id,address,label,is_primary,verified_at) values($1,$2,$3,$4,$5,now()) on conflict(chain_id,address) do nothing returning id,chain_id,address,label,is_primary,verified_at,created_at",[req.user.id,chain,a.toLowerCase(),String(req.body.label||"").slice(0,80)||null,!!req.body.primary]);if(!q.rowCount){const existing=await db().query("select id,chain_id,address,label,is_primary,verified_at,created_at from wallets where chain_id=$1 and lower(address)=lower($2)",[chain,a]);if(existing.rowCount)return res.json({wallet:existing.rows[0],alreadyLinked:true});return res.status(409).json({error:"Wallet already linked"});}await audit(req.user.id,"wallet.verified","wallet",q.rows[0].id);res.status(201).json({wallet:q.rows[0]});}catch(e){console.error(e);res.status(400).json({error:"Unable to verify wallet"})}});
app.delete("/api/wallets/:id",auth,async(req,res)=>{const q=await db().query("delete from wallets where id=$1 and user_id=$2 returning id",[req.params.id,req.user.id]);if(!q.rowCount)return res.status(404).json({error:"Wallet not found"});await audit(req.user.id,"wallet.unlinked","wallet",q.rows[0].id);res.json({deleted:true})});



app.get("/api/kyc",auth,async(req,res)=>{const q=await db().query("select id,provider,status,provider_reference,country,submitted_at,reviewed_at,review_reason,created_at,updated_at from kyc_cases where user_id=$1 order by created_at desc",[req.user.id]);res.json({status:req.user.kyc_status,cases:q.rows,providerConfigured:!!process.env.KYC_PROVIDER})});
app.post("/api/kyc/cases",auth,async(req,res)=>{const country=String(req.body.country||req.user.country);if(country!==req.user.country)return res.status(400).json({error:"KYC country must match the account country"});if(!["BW","SZ"].includes(country))return res.status(400).json({error:"Invalid country"});const provider=String(req.body.provider||process.env.KYC_PROVIDER||"");if(!provider)return res.status(503).json({error:"KYC provider is not configured"});const q=await db().query("insert into kyc_cases(user_id,provider,country,status,submitted_at) values($1,$2,$3,'pending',now()) returning id,status,provider,country,submitted_at",[req.user.id,provider,country]);await db().query("update users set kyc_status='pending',updated_at=now() where id=$1",[req.user.id]);await audit(req.user.id,"kyc.case_created","kyc_case",q.rows[0].id,{provider});res.status(201).json({case:q.rows[0]})});



app.get("/api/admin/users",auth,requireRole(["admin","compliance","support"]),async(req,res)=>{const q=await db().query("select id,email,role,status,country,phone,kyc_status,email_verified_at,created_at from users order by created_at desc limit 500");res.json({users:q.rows})});
app.get("/api/admin/kyc",auth,requireRole(["admin","compliance"]),async(req,res)=>{const q=await db().query("select k.id,k.user_id,k.provider,k.status,k.provider_reference,k.country,k.submitted_at,k.reviewed_at,k.review_reason,k.created_at,u.email from kyc_cases k join users u on u.id=k.user_id order by k.created_at desc limit 500");res.json({cases:q.rows})});
app.post("/api/admin/kyc/:id/review",auth,requireRole(["admin","compliance"]),async(req,res)=>{const status=String(req.body.status||""),reason=String(req.body.reason||"").slice(0,2000);if(!["approved","rejected","needs_review"].includes(status))return res.status(400).json({error:"Invalid review status"});const q=await db().query("update kyc_cases set status=$1,review_reason=$2,reviewed_at=now(),updated_at=now() where id=$3 returning user_id,status",[status,reason||null,req.params.id]);if(!q.rowCount)return res.status(404).json({error:"KYC case not found"});await db().query("update users set kyc_status=$1,updated_at=now() where id=$2",[status,q.rows[0].user_id]);await audit(req.user.id,"kyc.reviewed","kyc_case",req.params.id,{status});res.json({reviewed:true,status})});
app.get("/api/admin/audit",auth,requireRole(["admin","compliance"]),async(req,res)=>{const q=await db().query("select a.id,a.actor_user_id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.email from audit_log a left join users u on u.id=a.actor_user_id order by a.created_at desc limit 500");res.json({events:q.rows})});



app.get("/api/notifications",auth,async(req,res)=>{const q=await db().query("select id,channel,template,subject,body,status,scheduled_at,sent_at,created_at from notifications where user_id=$1 order by created_at desc limit 100",[req.user.id]);res.json({notifications:q.rows})});
app.post("/api/support/tickets",auth,async(req,res)=>{const subject=String(req.body.subject||"").slice(0,200),description=String(req.body.description||"").slice(0,5000),priority=String(req.body.priority||"normal");if(subject.length<2||description.length<2||!["low","normal","high","urgent"].includes(priority))return res.status(400).json({error:"Invalid support ticket"});const q=await db().query("insert into support_tickets(user_id,subject,description,priority) values($1,$2,$3,$4) returning *",[req.user.id,subject,description,priority]);await audit(req.user.id,"support.ticket_created","support_ticket",q.rows[0].id);res.status(201).json({ticket:q.rows[0]})});
app.get("/api/support/tickets",auth,async(req,res)=>{const q=await db().query("select id,subject,description,status,priority,assigned_to,created_at,updated_at from support_tickets where user_id=$1 order by created_at desc",[req.user.id]);res.json({tickets:q.rows})});



app.post("/api/groups",auth,async(req,res)=>{if(req.user.kyc_status!=="approved")return res.status(403).json({error:"KYC approval is required"});const name=String(req.body.name||"").trim(),onchain=String(req.body.onchainGroupId||"").trim(),country=String(req.body.country||req.user.country);if(name.length<2||name.length>120||!onchain||onchain.length>66||!["BW","SZ"].includes(country))return res.status(400).json({error:"Invalid group data"});try{const q=await db().query("insert into groups(onchain_group_id,name,country,contract_address,metadata,created_by) values($1,$2,$3,$4,$5,$6) returning *",[onchain,name,country,req.body.contractAddress||null,JSON.stringify(req.body.metadata||{}),req.user.id]);await audit(req.user.id,"group.created","group",q.rows[0].id);res.status(201).json({group:q.rows[0]})}catch(e){if(e.code==="23505")return res.status(409).json({error:"Group already recorded"});res.status(400).json({error:"Unable to create group"})}});



app.get("/api/admin/screenings",auth,requireRole(["admin","compliance"]),async(req,res)=>{const q=await db().query("select s.id,s.user_id,s.provider,s.screening_type,s.status,s.provider_reference,s.result_json,s.reviewed_at,s.created_at,u.email from compliance_screenings s join users u on u.id=s.user_id order by s.created_at desc limit 500");res.json({screenings:q.rows})});
app.post("/api/admin/screenings",auth,requireRole(["admin","compliance"]),async(req,res)=>{const uid=String(req.body.userId||""),type=String(req.body.screeningType||""),status=String(req.body.status||"pending");if(!uid||!["sanctions","pep","adverse_media","risk"].includes(type)||!["pending","clear","match","review","error"].includes(status))return res.status(400).json({error:"Invalid screening"});const q=await db().query("insert into compliance_screenings(user_id,provider,screening_type,status,provider_reference,result_json) values($1,$2,$3,$4,$5,$6) returning *",[uid,String(req.body.provider||process.env.COMPLIANCE_PROVIDER||"manual"),type,status,req.body.providerReference||null,JSON.stringify(req.body.result||{})]);await audit(req.user.id,"compliance.screening_created","screening",q.rows[0].id,{type,status});res.status(201).json({screening:q.rows[0]})});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Internal server error"});});
function startBackgroundWorker(name,script,intervalMs){
  let running=false;
  const run=()=>{
    if(running)return;
    running=true;
    const child=spawn(process.execPath,[path.join(__dirname,script)],{env:process.env,stdio:["ignore","inherit","inherit"]});
    child.on("exit",(code,signal)=>{running=false;console.log(JSON.stringify({service:name,status:"finished",code,signal}));});
    child.on("error",(error)=>{running=false;console.error(JSON.stringify({service:name,status:"spawn_failed",error:error.message}));});
  };
  console.log(JSON.stringify({service:name,status:"background_worker_enabled",intervalMs}));
  setTimeout(run,10000);
  setInterval(run,intervalMs);
}
async function start(){
  if(pool){
    try{
      // Older deployments may contain numeric group IDs. The current application uses UUID group IDs.
      // Move incompatible legacy tables aside before the idempotent schema creates the current tables.
      const groupId=await pool.query(
        "select data_type from information_schema.columns where table_schema='public' and table_name='groups' and column_name='id'"
      );
      if(groupId.rowCount && groupId.rows[0].data_type!=="uuid"){
        const legacy=await pool.query(
          "select 1 from information_schema.tables where table_schema='public' and table_name='groups_legacy'"
        );
        if(legacy.rowCount) throw new Error("Both incompatible groups and groups_legacy tables exist; manual migration required");
        await pool.query('alter table groups rename to groups_legacy');
      }
      const membershipGroupId=await pool.query(
        "select data_type from information_schema.columns where table_schema='public' and table_name='group_memberships' and column_name='group_id'"
      );
      if(membershipGroupId.rowCount && membershipGroupId.rows[0].data_type!=="uuid"){
        const legacy=await pool.query(
          "select 1 from information_schema.tables where table_schema='public' and table_name='group_memberships_legacy'"
        );
        if(legacy.rowCount) throw new Error("Both incompatible group_memberships and group_memberships_legacy tables exist; manual migration required");
        await pool.query('alter table group_memberships rename to group_memberships_legacy');
      }
      const schema=fs.readFileSync(path.join(__dirname,"db","schema.sql"),"utf8");
      await pool.query(schema);
      for(const file of ["whatsapp.sql","indexer.sql","transactions.sql"]){await pool.query(fs.readFileSync(path.join(__dirname,"db",file),"utf8"));}
      console.log("Database schema ready");
    }catch(e){
      console.error("Database initialization failed:",e.message);
      process.exit(1);
    }
  }
  app.listen(port,()=>console.log("Liholiswano API listening on port "+port));
  if(process.env.ENABLE_TESTNET_INDEXER_WORKER==="true") startBackgroundWorker("indexer","indexer.js",Number(process.env.INDEXER_INTERVAL_MS||15000));
  if(process.env.ENABLE_TESTNET_KEEPER_WORKER==="true") startBackgroundWorker("keeper","keeper.js",Number(process.env.KEEPER_INTERVAL_MS||300000));
  if(process.env.ENABLE_TESTNET_RECONCILIATION_WORKER==="true") startBackgroundWorker("reconciliation","reconcile.js",Number(process.env.RECONCILIATION_INTERVAL_MS||900000));
}
start();
