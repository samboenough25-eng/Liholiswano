require("dotenv").config();
const express=require("express");
const helmet=require("helmet");
const cors=require("cors");
const rateLimit=require("express-rate-limit");
const {z}=require("zod");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");

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
app.use(express.json({limit:"100kb"}));
app.use("/api/auth",rateLimit({windowMs:15*60*1000,max:25,standardHeaders:true,legacyHeaders:false}));

function db(){if(!pool) throw new Error("DATABASE_URL is not configured.");return pool;}
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

app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));
app.get("/api/me/eligibility",auth,async(req,res)=>{
  const restricted=req.user.kyc_status==="approved";
  res.json({kycStatus:req.user.kyc_status,restrictedFinancialOperations:restricted,reason:restricted?null:"KYC approval is required for restricted financial operations"});
});



app.get("/api/groups",auth,async(req,res)=>{const q=await db().query("select g.id,g.chain_id,g.contract_address,g.onchain_group_id,g.name,g.country,g.status,g.metadata,g.created_at,count(m.id)::int member_count from groups g left join group_memberships m on m.group_id=g.id and m.status in ('active','pending') where g.status<>'suspended' group by g.id order by g.created_at desc");res.json({groups:q.rows})});
app.get("/api/groups/:id",auth,async(req,res)=>{const q=await db().query("select g.*,(select count(*) from group_memberships m where m.group_id=g.id)::int member_count from groups g where g.id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"Group not found"});const m=await db().query("select user_id,wallet_address,status,joined_at,left_at from group_memberships where group_id=$1 order by joined_at",[req.params.id]);res.json({group:q.rows[0],members:m.rows})});
app.post("/api/groups/:id/join",auth,async(req,res)=>{try{if(req.user.kyc_status!=="approved")return res.status(403).json({error:"KYC approval is required"});const a=String(req.body.walletAddress||"");if(!/^0x[a-fA-F0-9]{40}$/.test(a))return res.status(400).json({error:"Invalid wallet address"});const q=await db().query("insert into group_memberships(group_id,user_id,wallet_address) values($1,$2,$3) returning *",[req.params.id,req.user.id,a.toLowerCase()]);await audit(req.user.id,"group.joined","group",req.params.id);res.status(201).json({membership:q.rows[0]})}catch(e){if(e.code==="23505")return res.status(409).json({error:"Already a member or wallet already used"});res.status(400).json({error:"Unable to join group"})}});



app.get("/api/profile",auth,async(req,res)=>{const q=await db().query("select u.id,u.email,u.country,u.phone,u.kyc_status,u.email_verified_at,p.first_name,p.last_name,p.date_of_birth,p.address,p.city,p.preferred_language from users u left join user_profiles p on p.user_id=u.id where u.id=$1",[req.user.id]);res.json({profile:q.rows[0]})});
app.put("/api/profile",auth,async(req,res)=>{try{const b=req.body||{};if(b.firstName&&String(b.firstName).length>80)return res.status(400).json({error:"Invalid first name"});if(b.lastName&&String(b.lastName).length>80)return res.status(400).json({error:"Invalid last name"});await db().query("insert into user_profiles(user_id,first_name,last_name,date_of_birth,address,city,preferred_language) values($1,$2,$3,$4,$5,$6,coalesce($7,'en')) on conflict(user_id) do update set first_name=coalesce(excluded.first_name,user_profiles.first_name),last_name=coalesce(excluded.last_name,user_profiles.last_name),date_of_birth=coalesce(excluded.date_of_birth,user_profiles.date_of_birth),address=coalesce(excluded.address,user_profiles.address),city=coalesce(excluded.city,user_profiles.city),preferred_language=coalesce(excluded.preferred_language,user_profiles.preferred_language),updated_at=now()",[req.user.id,b.firstName||null,b.lastName||null,b.dateOfBirth||null,b.address||null,b.city||null,b.preferredLanguage||null]);await audit(req.user.id,"profile.updated","user",req.user.id);res.json({updated:true})}catch(e){res.status(400).json({error:"Invalid profile data"})}});
app.get("/api/wallets",auth,async(req,res)=>{const q=await db().query("select id,chain_id,address,label,is_primary,verified_at,created_at from wallets where user_id=$1 order by is_primary desc,created_at desc",[req.user.id]);res.json({wallets:q.rows})});
app.post("/api/wallets",auth,async(req,res)=>{const a=String(req.body.address||"");const chain=Number(req.body.chainId||97);if(!/^0x[a-fA-F0-9]{40}$/.test(a)||!Number.isInteger(chain)||chain<1)return res.status(400).json({error:"Invalid wallet"});try{if(req.body.primary)await db().query("update wallets set is_primary=false where user_id=$1",[req.user.id]);const q=await db().query("insert into wallets(user_id,chain_id,address,label,is_primary) values($1,$2,$3,$4,$5) returning id,chain_id,address,label,is_primary,verified_at,created_at",[req.user.id,chain,a.toLowerCase(),String(req.body.label||"").slice(0,80)||null,!!req.body.primary]);await audit(req.user.id,"wallet.linked","wallet",q.rows[0].id);res.status(201).json({wallet:q.rows[0]})}catch(e){if(e.code==="23505")return res.status(409).json({error:"Wallet already linked"});res.status(400).json({error:"Unable to link wallet"})}});
app.delete("/api/wallets/:id",auth,async(req,res)=>{const q=await db().query("delete from wallets where id=$1 and user_id=$2 returning id",[req.params.id,req.user.id]);if(!q.rowCount)return res.status(404).json({error:"Wallet not found"});await audit(req.user.id,"wallet.unlinked","wallet",q.rows[0].id);res.json({deleted:true})});



app.get("/api/kyc",auth,async(req,res)=>{const q=await db().query("select id,provider,status,provider_reference,country,submitted_at,reviewed_at,review_reason,created_at,updated_at from kyc_cases where user_id=$1 order by created_at desc",[req.user.id]);res.json({status:req.user.kyc_status,cases:q.rows,providerConfigured:!!process.env.KYC_PROVIDER})});
app.post("/api/kyc/cases",auth,async(req,res)=>{const country=String(req.body.country||req.user.country);if(!["BW","SZ"].includes(country))return res.status(400).json({error:"Invalid country"});const provider=String(req.body.provider||process.env.KYC_PROVIDER||"");if(!provider)return res.status(503).json({error:"KYC provider is not configured"});const q=await db().query("insert into kyc_cases(user_id,provider,country,status,submitted_at) values($1,$2,$3,'pending',now()) returning id,status,provider,country,submitted_at",[req.user.id,provider,country]);await db().query("update users set kyc_status='pending',updated_at=now() where id=$1",[req.user.id]);await audit(req.user.id,"kyc.case_created","kyc_case",q.rows[0].id,{provider});res.status(201).json({case:q.rows[0]})});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Internal server error"});});
app.listen(port,()=>console.log("Liholiswano API listening on port "+port));
