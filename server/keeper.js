require("dotenv").config();
const {runOnce}=require("./automation");

if(require.main===module){
  runOnce()
    .then(result=>console.log(JSON.stringify({service:"liholiswano-keeper",...result})))
    .catch(error=>{console.error(JSON.stringify({service:"liholiswano-keeper",status:"failed",error:error.message}));process.exit(1);});
}

module.exports={runOnce};