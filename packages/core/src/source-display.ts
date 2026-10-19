/** Bounded FFprobe display-transform interpretation. Presence of a matrix is
 * unsupported even when the reported rotation is zero: it may reflect/shear. */
export type VerifiedDisplayTransform='identity'|'unsupported';
export function probeDisplayTransform(stream:unknown):VerifiedDisplayTransform{
 if(!stream||typeof stream!=='object'||Array.isArray(stream))return 'unsupported';
 const s=stream as {side_data_list?:unknown;tags?:unknown};
 if(s.side_data_list!==undefined){
  if(!Array.isArray(s.side_data_list))return 'unsupported';
  if(s.side_data_list.some(item=>!item||typeof item!=='object'||'displaymatrix' in item||String(item.side_data_type||'').toLowerCase()==='display matrix'))return 'unsupported';
 }
 if(s.tags!==undefined){
  if(!s.tags||typeof s.tags!=='object'||Array.isArray(s.tags))return 'unsupported';
  const rotate=(s.tags as {rotate?:unknown}).rotate;
  if(rotate!==undefined&&(typeof rotate!=='number'&&typeof rotate!=='string'||typeof rotate==='string'&&!rotate.trim()||!Number.isFinite(Number(rotate))||Number(rotate)!==0))return 'unsupported';
 }
 return 'identity';
}
