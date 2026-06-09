import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const items=JSON.parse(fs.readFileSync('data/latest-items.json','utf8'));
const it=items.find(i=>i.url.includes('news.google.com'));
const pg=await axios.get(it.url,{headers:{'User-Agent':UA},timeout:25000});
const html=pg.data;
console.log('len',html.length);
const $=cheerio.load(html);
console.log('c-wiz count',$('c-wiz').length);
console.log('has data-p:', html.includes('data-p='));
console.log('has data-n-a-id:', html.includes('data-n-a-id'));
console.log('has data-n-a-sg:', html.includes('data-n-a-sg'));
console.log('has AF_initDataCallback:', html.includes('AF_initDataCallback'));
console.log('has garturl:', html.includes('garturl'));
// show attributes of c-wiz and first divs
$('c-wiz').slice(0,3).each((i,e)=>{console.log('c-wiz attrs',Object.keys(e.attribs||{}));});
// find any element with data-n-a-sg
const sg=html.match(/data-n-a-sg="([^"]+)"/); const ts=html.match(/data-n-a-ts="([^"]+)"/); const id=html.match(/data-n-a-id="([^"]+)"/);
console.log('sg',sg?sg[1].slice(0,20):null,'ts',ts?ts[1]:null,'id',id?id[1].slice(0,20):null);
// maybe meta refresh / canonical to real url
console.log('canonical',$('link[rel=canonical]').attr('href'));
console.log('refresh',$('meta[http-equiv=refresh]').attr('content'));
