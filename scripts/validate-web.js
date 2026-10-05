const fs=require("fs"),vm=require("vm");
const config=fs.readFileSync("web/config.js","utf8");
const html=fs.readFileSync("web/index.html","utf8");
const dapp=fs.readFileSync("web/dapp.html","utf8");
const owner=fs.readFileSync("web/owner.html","utf8");
const protocol=fs.readFileSync("contracts/LiholiswanoV1.sol","utf8");
new vm.Script(config,{filename:"web/config.js"});
if(!html.includes("dapp.html"))throw new Error("Primary entry point must point to customer dApp");
if(!protocol.includes("ROUND_SIZE = 11"))throw new Error("V1 fixed round size is missing");
if(!protocol.includes("OBLIGATIONS_PER_MEMBER = 10"))throw new Error("V1 obligation invariant is missing");
if(!protocol.includes("BLOCKED_RECOVERY"))throw new Error("V1 recovery state is missing");
for(const [name,source] of [["web/dapp.html",dapp],["web/owner.html",owner],["web/dashboard.html",fs.readFileSync("web/dashboard.html","utf8")],["web/authorize.html",fs.readFileSync("web/authorize.html","utf8")],["web/register.html",fs.readFileSync("web/register.html","utf8")]]){
  const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
  if(!scripts.length)throw new Error("No inline scripts found in "+name);
  for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i],{filename:name+"#script"+(i+1)});
}
if(!dapp.includes("payObligation")||!dapp.includes("processExpiredObligation")||!dapp.includes("restoreAndResolveBlockedObligation"))throw new Error("Customer dApp does not expose the V1 obligation workflow");
for(const id of ["connect","switch","tiers","account","round","obligations","approve","join","restore","optIn","withdraw","settle","action"])if(!dapp.includes('id="'+id+'"'))throw new Error("Missing required V1 customer UI element: "+id);
if(owner.includes('id="create"')||owner.includes('id="payout"')||owner.includes('id="collateral"'))throw new Error("Owner console must not expose arbitrary tier creation fields");
if(!owner.includes("configureTier")||!owner.includes("setTierActive"))throw new Error("Owner console is not wired to V1 configuration");
console.log("WEB_V1_STATIC_VALIDATION=PASS");