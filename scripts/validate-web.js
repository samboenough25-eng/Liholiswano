const fs=require("fs"),vm=require("vm");
const config=fs.readFileSync("web/config.js","utf8");
const html=fs.readFileSync("web/index.html","utf8");
const dapp=fs.readFileSync("web/dapp.html","utf8");
const owner=fs.readFileSync("web/owner.html","utf8");
new vm.Script(config,{filename:"web/config.js"});
if(!html.includes("dapp.html"))throw new Error("web/index.html does not point to the customer dApp");
for(const [name,source] of [["web/dapp.html",dapp],["web/owner.html",owner],["web/dashboard.html",fs.readFileSync("web/dashboard.html","utf8")],["web/authorize.html",fs.readFileSync("web/authorize.html","utf8")],["web/register.html",fs.readFileSync("web/register.html","utf8")],["web/compliance.html",fs.readFileSync("web/compliance.html","utf8")]]){
  const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
  if(!scripts.length)throw new Error("No inline scripts found in "+name);
  for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i],{filename:name+"#script"+(i+1)});
}
if(!dapp.includes('src="https://cdn.jsdelivr.net/npm/ethers@6.13.5/dist/ethers.umd.min.js"'))throw new Error("dApp ethers v6 browser bundle is not loaded");
if(dapp.includes("id=\"approve\""))throw new Error("Legacy ambiguous approval control remains in customer dApp");
for(const id of ["connect","switch","refresh","wallet","walletStats","deployment","loadGroups","groups","gid","join","approveCollateral","approveContribution","contribute","bidBtn","settle","action"])if(!dapp.includes('id="'+id+'"'))throw new Error("Missing required dApp UI element: "+id);
if(!html.includes("dapp.html"))throw new Error("Primary entry point is not the customer dApp");
if(owner.includes("id=\"join\"")||owner.includes("id=\"contribute\"")||owner.includes("id=\"submit\""))throw new Error("Owner console must not expose customer transaction controls");
for(const id of ["email","password","country","register","verification","code","verify","resend"])if(!fs.readFileSync("web/register.html","utf8").includes('id="'+id+'"'))throw new Error("Registration UI missing "+id);
console.log("WEB_STATIC_VALIDATION=PASS");
