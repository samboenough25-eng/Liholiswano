const {menu,sendText}=require("./whatsapp");
const COMMANDS={
  "1":{name:"account",text:"Your Liholiswano account is linked to this WhatsApp number."},
  "2":{name:"join",text:"Send JOIN followed by the ROSCA group ID. Example: JOIN 0x..."},
  "3":{name:"groups",text:"Your groups are being retrieved."},
  "4":{name:"contribute",text:"Send CONTRIBUTE followed by the group ID to start a contribution request."},
  "5":{name:"balance",text:"Your wallet balance will be shown here once your managed wallet is connected."},
  "6":{name:"payout",text:"Your next payout will be shown here from the on-chain ROSCA state."},
  "7":{name:"transactions",text:"Your recent transactions will be shown here."},
  "8":{name:"support",text:"Send SUPPORT followed by your message and a support ticket will be created."}
};
async function handleCommand({phone,text,db}){
  const normalized=text.trim().toLowerCase();
  if(["hi","hello","menu","start"].includes(normalized)) return menu();
  const match=COMMANDS[normalized];
  if(match) return match.text;
  if(normalized.startsWith("support ")){
    const description=text.slice(8).trim();
    if(description.length<2) return "Please send SUPPORT followed by your message.";
    const user=await db.query("select id from users where phone=$1",[phone]);
    if(!user.rowCount) return "Your WhatsApp number is not linked to a Liholiswano account yet.";
    const q=await db.query("insert into support_tickets(user_id,subject,description,priority) values($1,$2,$3,'normal') returning id",[user.rows[0].id,"WhatsApp support",description]);
    return "Support ticket "+q.rows[0].id+" has been created.";
  }
  return "I did not understand that. Reply MENU to see the available Liholiswano options.";
}
module.exports={handleCommand};
