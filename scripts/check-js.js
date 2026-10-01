const fs=require("fs");
const path=require("path");
const vm=require("vm");

const roots=["server","scripts"];
const files=[];
function walk(dir){
  for(const name of fs.readdirSync(dir)){
    const full=path.join(dir,name);
    const stat=fs.statSync(full);
    if(stat.isDirectory()) walk(full);
    else if(full.endsWith(".js")) files.push(full);
  }
}
for(const root of roots) if(fs.existsSync(root)) walk(root);
for(const file of files){
  new vm.Script(fs.readFileSync(file,"utf8"),{filename:file});
  console.log("JS_SYNTAX_OK",file);
}
console.log("JS_SYNTAX_CHECK=PASS");
