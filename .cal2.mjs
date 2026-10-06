import { articles } from './src/kb/articles.js';
import { Retriever, stripMarkdown } from './src/rag/retriever.js';
import { queryText } from './src/rag/semantic.js';
import { createNodeEmbedder } from './src/rag/embedder.node.js';
import { screenQuestion } from './src/rag/guard.js';
import { cases } from './eval/cases.js';
const r = new Retriever(articles); const embed = await createNodeEmbedder();
// passages: title, each alias, each body sentence/step
const passages=[];
for (const a of articles) {
  passages.push({id:a.id, text:a.title});
  for (const al of a.aliases) passages.push({id:a.id,text:al});
  for (const s of stripMarkdown(a.body).split(/\n+|(?<=\.)\s+/).map(x=>x.trim()).filter(x=>x.length>12)) passages.push({id:a.id,text:s,body:true});
}
const pv = await embed(passages.map(p=>p.text));
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const rank = (v) => { const best={}; passages.forEach((p,i)=>{const s=dot(v,pv[i])*(p.body?0.9:1); if(!(p.id in best)||s>best[p.id].s) best[p.id]={s,t:p.text}}); return Object.entries(best).map(([id,b])=>({id,similarity:b.s,t:b.t})).sort((a,b)=>b.similarity-a.similarity); };
const sel = cases.filter(c=>['dev','test'].includes(c.split) && !screenQuestion(c.query).blocked);
const pos=[], neg=[];
for (const c of sel) {
  const out = r.retrieve(c.query);
  if (out.decision.type!=='escalate' && !c.id.startsWith('dev-para')) continue;
  const [v] = await embed([queryText(out.analysis)]);
  const sem = rank(v);
  const ok = c.expect.type==='answer' && sem[0].id===c.expect.article;
  (c.expect.type==='answer'?pos:neg).push([sem[0].similarity, sem[0].similarity-sem[1].similarity, ok, c.query, sem[0].id, sem[0].t]);
}
console.log('POSITIVES'); pos.sort((a,b)=>b[0]-a[0]).forEach(x=>console.log(x[0].toFixed(3),x[1].toFixed(3),x[2]?'RIGHT':'wrong',x[3],'->',x[4],'|',x[5].slice(0,50)));
console.log('NEGATIVES'); neg.sort((a,b)=>b[0]-a[0]).slice(0,10).forEach(x=>console.log(x[0].toFixed(3),x[1].toFixed(3),x[3],'->',x[4],'|',x[5].slice(0,50)));
