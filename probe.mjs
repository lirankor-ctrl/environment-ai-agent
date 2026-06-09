import fs from 'fs';
const items=JSON.parse(fs.readFileSync('data/latest-items.json','utf8'));
function decodeGN(url){
  const m=url.match(/\/articles\/([^?]+)/);
  if(!m) return null;
  let tok=m[1].replace(/-/g,'+').replace(/_/g,'/');
  while(tok.length%4) tok+='=';
  let buf; try{buf=Buffer.from(tok,'base64');}catch{return null;}
  // find printable http... substring
  const ascii=buf.toString('latin1');
  const httpMatch=ascii.match(/https?:\/\/[^\s\x00-\x1f"']+/);
  return {hex:buf.slice(0,8).toString('hex'), url:httpMatch?httpMatch[0]:null, asciiSample:ascii.slice(0,120).replace(/[^\x20-\x7e]/g,'.')};
}
for(const it of items.slice(0,6)){
  if(!it.url.includes('news.google.com')){console.log('DIRECT',it.title.slice(0,30));continue;}
  const d=decodeGN(it.url);
  console.log('\n'+it.title.slice(0,40));
  console.log('  hex:',d?.hex,'\n  url:',d?.url,'\n  ascii:',d?.asciiSample);
}
