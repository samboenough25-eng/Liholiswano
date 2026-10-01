const crypto = require("crypto");

function normalizePhone(value){
  const raw=String(value||"").trim();
  if(!raw) return null;
  const digits=raw.replace(/[^0-9+]/g,"");
  if(!/^\+?[1-9][0-9]{6,14}$/.test(digits)) return null;
  return digits.startsWith("+")?digits:"+"+digits;
}
function verifySignature(rawBody,signature,secret){
  if(!signature||!secret) return false;
  const expected=crypto.createHmac("sha256",secret).update(rawBody).digest("hex");
  const supplied=String(signature).replace(/^sha256=/,"");
  try{return crypto.timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(supplied,"hex"));}catch{return false;}
}
function normalizeInbound(payload){
  const value=payload?.entry?.[0]?.changes?.[0]?.value;
  const msg=value?.messages?.[0];
  if(!msg) return null;
  const phone=normalizePhone(msg.from);
  if(!phone) return null;
  const text=msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  return {messageId:String(msg.id||""),phone,text:String(text).trim(),timestamp:msg.timestamp?new Date(Number(msg.timestamp)*1000):new Date(),raw:msg};
}
function menu(){
  return [
    "Liholiswano",
    "",
    "1. My account",
    "2. Join a ROSCA",
    "3. My groups",
    "4. Contribute",
    "5. My balance",
    "6. Next payout",
    "7. Transactions",
    "8. Support",
    "",
    "Reply with a number to continue."
  ].join("\n");
}
async function sendText({to,text}){
  if(!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_ACCESS_TOKEN) return {status:"not_configured",to,text};
  const response=await fetch(process.env.WHATSAPP_API_URL,{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+process.env.WHATSAPP_ACCESS_TOKEN},
    body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body:text}})
  });
  const body=await response.text();
  if(!response.ok) throw new Error("WhatsApp provider returned "+response.status+": "+body.slice(0,500));
  return {status:"sent",providerResponse:body};
}
module.exports={normalizePhone,verifySignature,normalizeInbound,menu,sendText};
