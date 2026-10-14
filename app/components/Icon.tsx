export default function Icon({name,size=22}:{name:'cap'|'search'|'arrow'|'plus'|'check'|'close';size?:number}){
 const paths={cap:<><path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v6c3 3 9 3 12 0v-6M22 9v9"/></>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,arrow:<path d="m9 5 7 7-7 7"/>,plus:<path d="M12 5v14M5 12h14"/>,check:<path d="m5 12 4 4L19 6"/>,close:<path d="m6 6 12 12M18 6 6 18"/>};
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
