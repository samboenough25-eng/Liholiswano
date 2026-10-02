const crypto = require("crypto");
const { ethers } = require("ethers");
const { PROTOCOL_ABI, provider } = require("./blockchain");

const ABI = [
  "function joinGroup(bytes32)",
  "function contribute(bytes32)",
  "function submitBid(bytes32,uint256)",
  "function getGroup(bytes32) view returns(bool,bool,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
  "function getMember(bytes32,address) view returns(address,bool,bool,bool,bool,bool,uint256,uint32,uint256,uint256)"
];
const TOKEN_ABI = [
  "function approve(address,uint256) returns(bool)",
  "function allowance(address,address) view returns(uint256)"
];

async function createTransactionAuthorization(db,userId,requestId){
  const raw=crypto.randomBytes(32).toString("hex");
  const hash=crypto.createHash("sha256").update(raw).digest("hex");
  await db.query("update transaction_authorizations set used_at=now() where user_id=$1 and used_at is null",[userId]);
  await db.query("insert into transaction_authorizations(transaction_request_id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '30 minutes')",[requestId,userId,hash]);
  return raw;
}

function installTransactionAuthorization({app,db,auth,audit}){
  app.get("/api/whatsapp/transaction-authorization/:token",async(req,res)=>{
    try{
      const raw=String(req.params.token||"");
      if(!/^[a-f0-9]{64}$/.test(raw))return res.status(400).json({error:"Invalid authorization token"});
      const hash=crypto.createHash("sha256").update(raw).digest("hex");
      const q=await db().query("select a.id,a.transaction_request_id,a.user_id,a.expires_at,r.operation,r.wallet_address,r.chain_id,r.contract_address,r.onchain_group_id,r.status,r.request_json from transaction_authorizations a join transaction_requests r on r.id=a.transaction_request_id where a.token_hash=$1 and a.used_at is null and a.expires_at>now() limit 1",[hash]);
      if(!q.rowCount)return res.status(404).json({error:"Authorization link is invalid or expired"});
      const x=q.rows[0];
      const requestJson=x.request_json||{};
      res.json({
        authorizationId:x.id,requestId:x.transaction_request_id,operation:x.operation,walletAddress:x.wallet_address,
        chainId:Number(x.chain_id),contractAddress:x.contract_address,onchainGroupId:x.onchain_group_id,
        bidBps:requestJson.bidBps==null?null:Number(requestJson.bidBps),expiresAt:x.expires_at,status:x.status
      });
    }catch(e){res.status(500).json({error:"Unable to load transaction authorization"});}
  });

  app.post("/api/whatsapp/transaction-authorization/:token/record",async(req,res)=>{
    const client=await db().connect();
    try{
      const raw=String(req.params.token||""),txHash=String(req.body.txHash||"");
      if(!/^[a-f0-9]{64}$/.test(raw)||!/^0x[a-fA-F0-9]{64}$/.test(txHash))return res.status(400).json({error:"Authorization token and transaction hash are required"});
      await client.query("begin");
      const hash=crypto.createHash("sha256").update(raw).digest("hex");
      const q=await client.query("select a.id,a.transaction_request_id,a.user_id,r.* from transaction_authorizations a join transaction_requests r on r.id=a.transaction_request_id where a.token_hash=$1 and a.used_at is null and a.expires_at>now() for update",[hash]);
      if(!q.rowCount){await client.query("rollback");return res.status(404).json({error:"Authorization link is invalid, expired, or already used"});}
      const request=q.rows[0];
      if(!["prepared","signed","submitted"].includes(request.status)){await client.query("rollback");return res.status(409).json({error:"Transaction request is not awaiting authorization"});}
      const p=provider();
      const network=await p.getNetwork();
      if(Number(network.chainId)!==Number(request.chain_id))throw new Error("Blockchain network mismatch");
      const tx=await p.getTransaction(txHash),receipt=await p.getTransactionReceipt(txHash);
      if(!tx||!receipt)throw new Error("Transaction is not confirmed yet");
      if(String(tx.from).toLowerCase()!==String(request.wallet_address).toLowerCase())throw new Error("Transaction sender does not match the verified wallet");
      if(String(tx.to||"").toLowerCase()!==String(request.contract_address).toLowerCase())throw new Error("Transaction target does not match the prepared contract");
      if(receipt.status!==1){
        await client.query("update transaction_requests set status='reverted',tx_hash=$2,error_message='On-chain transaction reverted',updated_at=now() where id=$1",[request.transaction_request_id,txHash]);
        await client.query("insert into transaction_events(transaction_request_id,status,tx_hash,metadata) values($1,'reverted',$2,$3)",[request.transaction_request_id,txHash,JSON.stringify({source:"whatsapp_authorization"})]);
        await client.query("update transaction_authorizations set used_at=now() where id=$1",[request.id]);
        await client.query("commit");
        return res.status(409).json({error:"On-chain transaction reverted",txHash});
      }
      const replay=await client.query("select id,transaction_request_id from transaction_authorizations where used_at is not null and exists(select 1 from transaction_requests tr where tr.id=transaction_authorizations.transaction_request_id and tr.tx_hash=$1) limit 1",[txHash]);
      if(replay.rowCount)throw new Error("This transaction hash has already been consumed by another authorization");
      const duplicate=await client.query("select id,status from transaction_requests where tx_hash=$1 and id<>$2 limit 1",[txHash,request.transaction_request_id]);
      if(duplicate.rowCount)throw new Error("This transaction hash is already bound to another transaction request");
      const iface=new ethers.Interface(ABI);
      const parsed=iface.parseTransaction({data:tx.data});
      if(!parsed||parsed.name!==request.operation)throw new Error("Transaction calldata does not match the prepared operation");
      const gid=String(parsed.args[0]).toLowerCase();
      if(gid!==String(request.onchain_group_id).toLowerCase())throw new Error("Transaction group does not match the prepared group");
      if(request.operation==="bid"){
        const expected=Number((request.request_json||{}).bidBps);
        if(!Number.isInteger(expected)||Number(parsed.args[1])!==expected)throw new Error("Bid amount does not match the prepared request");
      }
      if(request.operation==="join"){
        const app=new ethers.Contract(request.contract_address,ABI,p);
        const g=await app.getGroup(request.onchain_group_id);
        const tokenAddress=String(g[3]).toLowerCase();
        const transferIface=new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
        let collateralMatched=false;
        for(const log of receipt.logs){
          try{
            const parsedLog=transferIface.parseLog(log);
            if(parsedLog.name==="Transfer"&&String(parsedLog.args.from).toLowerCase()===String(request.wallet_address).toLowerCase()&&String(parsedLog.args.to).toLowerCase()===request.contract_address.toLowerCase()&&String(log.address).toLowerCase()===tokenAddress&&String(parsedLog.args.value)===String(g[5])) collateralMatched=true;
          }catch{}
        }
        if(!collateralMatched)throw new Error("Join collateral transfer does not match the smart-contract collateral amount");
      }
      if(request.operation==="contribute"){
        const app=new ethers.Contract(request.contract_address,ABI,p);
        const g=await app.getGroup(request.onchain_group_id);
        const tokenAddress=String(g[3]).toLowerCase();
        const token=new ethers.Contract(tokenAddress,TOKEN_ABI,p);
        // Contribution calldata itself has no amount; verify the token transfer emitted by the same receipt.
        const transferIface=new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
        let amountMatched=false;
        for(const log of receipt.logs){
          try{
            const parsedLog=transferIface.parseLog(log);
            if(parsedLog.name==="Transfer"&&String(parsedLog.args.from).toLowerCase()===String(request.wallet_address).toLowerCase()&&String(parsedLog.args.to).toLowerCase()===request.contract_address.toLowerCase()&&String(parsedLog.args.value)===String(g[4]))amountMatched=true;
          }catch{}
        }
        if(!amountMatched)throw new Error("Contribution token transfer does not match the smart-contract contribution amount");
      }
      const u=await client.query("update transaction_requests set status='confirmed',tx_hash=$2,confirmed_at=now(),updated_at=now(),error_message=null where id=$1 returning *",[request.transaction_request_id,txHash]);
      await client.query("insert into transaction_events(transaction_request_id,status,tx_hash,metadata) values($1,'confirmed',$2,$3)",[request.transaction_request_id,txHash,JSON.stringify({source:"whatsapp_authorization",blockNumber:receipt.blockNumber})]);
      await client.query("insert into blockchain_transactions(user_id,chain_id,tx_hash,contract_address,action,status,block_number,block_hash,payload,confirmed_at) values($1,$2,$3,$4,$5,'confirmed',$6,$7,$8,now()) on conflict(tx_hash) do nothing",[request.user_id,request.chain_id,txHash,request.contract_address,request.operation,receipt.blockNumber,receipt.blockHash,JSON.stringify({requestId:request.transaction_request_id,onchainGroupId:request.onchain_group_id,source:"whatsapp_authorization"})]);
      await client.query("update transaction_authorizations set used_at=now() where id=$1",[request.id]);
      await client.query("commit");
      try{await audit(request.user_id,"transaction.confirmed","transaction_request",request.transaction_request_id,{txHash,operation:request.operation,source:"whatsapp_authorization"});}catch{}
      res.json({confirmed:true,request:u.rows[0],txHash});
    }catch(e){
      try{await client.query("rollback");}catch{}
      res.status(409).json({error:e.message||"Unable to verify transaction"});
    }finally{client.release();}
  });
}
module.exports={installTransactionAuthorization,createTransactionAuthorization};
