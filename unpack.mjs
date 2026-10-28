import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const files=JSON.parse(fs.readFileSync('source.json','utf8'));
for(const [name,contents] of Object.entries(files)){
 if(typeof contents!=='string'||!name||path.isAbsolute(name)||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..')||(!['cloud','cloud-public','netlify','scripts','src','test','public'].includes(name.split('/')[0])&&!['Start-ReplyAssist.ps1','Open-ReplyAssist.ps1','Start-ReplyAssist-Review.ps1','Open-ReplyAssist-Review.ps1','Review-Paths.ps1'].includes(name)))throw new Error('Invalid source path.');
 const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents);
}
console.log(`Expanded ${Object.keys(files).length} source files.`);
