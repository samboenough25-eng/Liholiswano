const fs=require("fs"),vm=require("vm");
const config=fs.readFileSync("web/config.js","utf8");
const html=fs.readFileSync("web/index.html","utf8");
new vm.Script(config,{filename:"web/config.js"});
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
if(!scripts.length)throw new Error("No inline scripts found in web/index.html");
for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i],{filename:"web/index.html#script"+(i+1)});
if(!html.includes('src="./config.js"'))throw new Error("web/config.js is not loaded");
if(!html.includes("ethers.umd.min.js"))throw new Error("ethers v6 browser bundle is not loaded");
const requiredIds=["connect","network","refreshWallet","wallet","contract","token","save","verify","deploymentState","approveToken","adminApprove","gid","create","lock","groupView","load","groups","join","approveContribution","contribute","bid","submit","settle","defaultMember","markDefault","log"];
for(const id of requiredIds)if(!html.includes(`id="${id}"`))throw new Error(`Missing required UI element: ${id}`);
for(const page of ["web/dashboard.html","web/authorize.html"]){
  const source=fs.readFileSync(page,"utf8");
  const pageScripts=[...source.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
  if(!pageScripts.length)throw new Error("No inline scripts found in "+page);
  for(let i=0;i<pageScripts.length;i++)new vm.Script(pageScripts[i],{filename:page+"#script"+(i+1)});
}
const register=fs.readFileSync("web/register.html","utf8");
const registerScripts=[...register.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
for(let i=0;i<registerScripts.length;i++)new vm.Script(registerScripts[i],{filename:"web/register.html#script"+(i+1)});
for(const id of ["email","password","country","register","verification","code","verify","resend"])if(!register.includes(`id="${id}"`))throw new Error(`Registration UI missing ${id}`);
console.log("WEB_STATIC_VALIDATION=PASS");
