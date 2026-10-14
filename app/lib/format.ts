const acronyms=new Set(['STEM','STEAM','HS','JROTC','IB','KIPP','IDEA','DC','NYC','USA']);
export function displayName(name:string){if(name!==name.toUpperCase())return name;return name.toLowerCase().replace(/\b[a-z][a-z']*/g,word=>acronyms.has(word.toUpperCase())?word.toUpperCase():word[0].toUpperCase()+word.slice(1));}
export function dateLabel(value:string|null){return value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'}):'Not reported';}
