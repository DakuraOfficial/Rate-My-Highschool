import {searchSchools,STATES,source} from './lib/directory';
import {getSchoolSummaries} from './lib/reviews';
import {displayName} from './lib/format';
import {CompareButton} from './components/CompareProvider';
import Icon from './components/Icon';
export const dynamic='force-dynamic';
type Params=Record<string,string|undefined>;
export default async function Home({searchParams}:{searchParams:Promise<Params>}){
 const p=await searchParams;
 const q=(p.q??'').slice(0,200),state=p.state??'',type=p.type??'';
 const result=searchSchools(q,state,type,Number(p.page??1));
 let summaries:Awaited<ReturnType<typeof getSchoolSummaries>>={};let unavailable=false;
 try{summaries=await getSchoolSummaries(result.items.map(s=>s.id));}catch{unavailable=true;}
 const pageLink=(page:number)=>{const params=new URLSearchParams();if(q)params.set('q',q);if(state)params.set('state',state);if(type)params.set('type',type);params.set('page',String(page));return '/?'+params+'#schools';};
 return <>
 <section className="search-hero"><div className="container">
  <h1>Find the right high school<br className="desktop-break"/> for your family.</h1>
  <p className="hero-description">Real experiences. Clear comparisons. A better place to start.</p>
  <form className="search-box" action="/" method="get"><label className="sr-only" htmlFor="school-search">School name, city, state, or ZIP code</label><Icon name="search" size={25}/><input id="school-search" name="q" defaultValue={q} placeholder="School name, city, state, or ZIP code" maxLength={200}/>{state?<input type="hidden" name="state" value={state}/>:null}{type?<input type="hidden" name="type" value={type}/>:null}<button type="submit" className="button">Search</button></form>
  <p className="hero-source">Public high schools across the United States · Official NCES school directory</p>
 </div></section>
 <section className="container directory-section" id="schools">
  <div className="section-heading"><h2>{q?'School search results':'Explore public high schools'}</h2><a className="text-link" href="/how-it-works">How ratings work</a></div>
  {p.rate?<div className="notice">Find your school below, open its profile, and choose “Rate this school” to share your experience.</div>:null}
  {unavailable?<div className="notice" role="status">School search is available. Community ratings are temporarily unavailable; please try again shortly.</div>:null}
  <div className="directory-grid"><aside className="filters"><h3>Refine your search</h3><form action="/#schools"><input type="hidden" name="q" value={q}/><div className="form-field"><label htmlFor="state">State</label><select id="state" name="state" defaultValue={state}><option value="">All states</option>{Object.entries(STATES).sort((a,b)=>a[1].localeCompare(b[1])).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div><div className="form-field"><label htmlFor="school-type">School type</label><select id="school-type" name="type" defaultValue={type}><option value="">All school types</option>{['Regular','Charter','Alternative','Career and technical','Special education'].map(v=><option key={v}>{v}</option>)}</select></div><div className="actions"><button className="button secondary small">Apply filters</button><a className="text-link" href="/#schools">Reset</a></div></form><p className="filter-note">Every school has a place here.<br/>Reviews grow with the community.</p><p className="field-hint">{Number(source.totalSchools).toLocaleString()} schools · {source.sourceYear} directory<br/>ZIP searches match school addresses.</p></aside>
  <div className="search-results"><div className="results-count">{result.total.toLocaleString()} {result.total===1?'school':'schools'}{state?` in ${STATES[state]??state}`:''}{q?` matching “${q}”`:''}</div>
  {result.items.length?result.items.map(s=>{const summary=summaries[s.id];return <article className="school-row" key={s.id}><div className="school-row-info"><a className="school-name" href={`/schools/${s.id}`}>{displayName(s.name)}</a><p>{displayName(s.city)}, {s.state}</p><p className="muted">Grades {s.grades||'not reported'} · {s.charter?'Public charter school':s.type==='Regular'?'Public high school':`${s.type} public school`}</p></div><div className="score-block"><span className={`score-square ${summary?.overall!=null?'rated':''}`}>{unavailable?'—':summary?.overall?.toFixed(1)??'--'}</span><div><span>{unavailable?'Ratings unavailable':summary?.overall!=null?'Community rating':'Not yet rated'}</span><p className="muted">{unavailable?'Try again shortly':`${summary?.count??0} review${summary?.count===1?'':'s'}`}</p>{summary?.count&&summary.count<5?<span className="field-hint">Limited reviews</span>:null}</div></div><CompareButton school={{id:s.id,name:s.name,city:s.city,state:s.state}}/></article>;}):<div className="empty-state"><Icon name="search" size={36}/><h3>No schools match this search.</h3><p>Try a school name, city, or ZIP code, or clear your filters.</p><a className="button secondary" href="/#schools">Clear search</a></div>}
  <div className="pagination"><div className="actions">{result.page>1?<a className="button secondary small" href={pageLink(result.page-1)}>Previous</a>:null}{Array.from({length:Math.min(5,result.pages)},(_,i)=>Math.min(Math.max(1,result.page-2),Math.max(1,result.pages-4))+i).map(page=><a aria-current={page===result.page?'page':undefined} key={page} className={`page-number ${page===result.page?'current':''}`} href={pageLink(page)}>{page}</a>)}{result.page<result.pages?<a className="button secondary small" href={pageLink(result.page+1)}>Next <Icon name="arrow" size={14}/></a>:null}</div><span className="muted">{result.total?`${(result.page-1)*20+1}–${Math.min(result.page*20,result.total)} of ${result.total.toLocaleString()}`:'0 schools'}</span></div>
  </div></div>
 </section></>;
}
