'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import Icon from './Icon';
import {displayName} from '../lib/format';
export type SelectedSchool={id:string;name:string;city:string;state:string};
type Value={selected:SelectedSchool[];toggle:(school:SelectedSchool)=>void;remove:(id:string)=>void;replace:(schools:SelectedSchool[])=>void;ready:boolean};
const Context=createContext<Value|null>(null);const KEY='rmh.compare.v1';
export function CompareProvider({children}:{children:ReactNode}){
 const [selected,setSelected]=useState<SelectedSchool[]>([]),[ready,setReady]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(KEY)??'[]');if(Array.isArray(saved))setSelected(saved.filter(s=>s&&typeof s.id==='string'&&/^\d{12}$/.test(s.id)&&typeof s.name==='string'&&typeof s.city==='string'&&typeof s.state==='string').slice(0,3));}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify(selected));}catch{}},[selected,ready]);
 const remove=(id:string)=>setSelected(previous=>previous.filter(s=>s.id!==id));
 const toggle=(school:SelectedSchool)=>{if(selected.some(s=>s.id===school.id)){remove(school.id);setMessage('');return;}if(selected.length>=3){setMessage('You can compare up to three schools. Remove one to add another.');return;}setSelected(previous=>[...previous,school]);setMessage('');};
 return <Context.Provider value={{selected,toggle,remove,replace:setSelected,ready}}>{children}{message?<div role="alert" className="toast">{message}<button aria-label="Dismiss" onClick={()=>setMessage('')}><Icon name="close" size={18}/></button></div>:null}{selected.length?<aside className="compare-tray" aria-label="Schools selected for comparison"><div className="container tray-inner"><div><strong>{selected.length} school{selected.length===1?'':'s'} selected</strong><div className="tray-schools">{selected.map(s=><button key={s.id} onClick={()=>remove(s.id)} aria-label={`Remove ${displayName(s.name)} from comparison`}>{displayName(s.name)} <Icon name="close" size={14}/></button>)}</div></div><a className="button" href="/compare">Compare schools <Icon name="arrow" size={16}/></a></div></aside>:null}</Context.Provider>;
}
export function useCompare(){const value=useContext(Context);if(!value)throw new Error('Comparison context is unavailable');return value;}
export function CompareButton({school}:{school:SelectedSchool}){const {selected,toggle}=useCompare();const active=selected.some(s=>s.id===school.id);return <button className={`button secondary small ${active?'selected':''}`} aria-pressed={active} onClick={()=>toggle(school)}><Icon name={active?'check':'plus'} size={16}/>{active?'Added':'Compare'}</button>;}
