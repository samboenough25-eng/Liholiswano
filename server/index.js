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

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Internal server error"});});
app.listen(port,()=>console.log("Liholiswano API listening on port "+port));
