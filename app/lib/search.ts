export type School = {id:string;name:string;district:string;districtId:string;city:string;state:string;zip:string;address:string;grades:string;type:string;charter:boolean;website:string;phone:string;sourceYear:string};
export type SearchOptions = {q?:string;state?:string;type?:string;page?:number;pageSize?:number};
export const STATES:Record<string,string>={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function searchDirectory(schools:School[], options:SearchOptions={}) {
  const q=normalize((options.q??'').slice(0,200));
  const matches=schools.filter(s=>{
    if(options.state && s.state!==options.state) return false;
    if(options.type && (options.type==='Charter'?!s.charter:s.type!==options.type)) return false;
    return !q || [s.name,s.city,s.state,STATES[s.state]??''].some(v=>normalize(v).includes(q)) || s.zip.startsWith(q);
  });
  const rank=(s:School)=>!q?0:normalize(s.name)===q?0:normalize(s.name).includes(q)?1:2;
  matches.sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name)||a.state.localeCompare(b.state)||a.city.localeCompare(b.city)||a.id.localeCompare(b.id));
  const pageSize=Math.min(100,Math.max(1,options.pageSize??20));
  const pages=Math.max(1,Math.ceil(matches.length/pageSize));
  const page=Math.min(pages,Math.max(1,Math.floor(options.page??1)||1));
  return {items:matches.slice((page-1)*pageSize,page*pageSize),total:matches.length,page,pages};
}
