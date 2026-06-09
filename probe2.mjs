import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const items=JSON.parse(fs.readFileSync('data/latest-items.json','utf8'));

async function decode(articleUrl){
  // 1) fetch the article page, read data-p from c-wiz
  const pg=await axios.get(articleUrl,{headers:{'User-Agent':UA},timeout:25000});
  const $=cheerio.load(pg.data);
  const div=$('c-wiz > div').first();
  const dataP=div.attr('data-p');
  if(!dataP) return {err:'no data-p'};
  const obj=JSON.parse(dataP.replace('%.@.','['));
  const payload='f.req='+encodeURIComponent(JSON.stringify([[['Fbv4je',JSON.stringify([obj[-3+obj.length], obj[-2+obj.length]]),null,'generic']]]));
  // 2) POST batchexecute
  const res=await axios.post('https://news.google.com/_/DotsSplashUi/data/batchexecute',payload,{
    headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},timeout:25000});
  const text=res.data;
  const line=text.split('\n').find(l=>l.includes('garturlres')||l.includes('http'));
  const m=text.match(/"(https?:\/\/[^"]+)"/g);
  return {sample:String(text).slice(0,160).replace(/\n/g,' '), urls:m?m.slice(0,3):null};
}
for(const it of items.slice(0,3)){
  if(!it.url.includes('news.google.com')) continue;
  try{ const d=await decode(it.url); console.log('\n'+it.title.slice(0,40)); console.log(JSON.stringify(d).slice(0,300)); }
  catch(e){ console.log('\n'+it.title.slice(0,40),'ERR',e.message); }
}
