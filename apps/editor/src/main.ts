import {mountEditor} from './host.ts';
const root=document.getElementById('app');if(!root)throw Error('EDITOR_CONTAINER_MISSING');
const handle=mountEditor(root);
if(import.meta.hot)import.meta.hot.dispose(()=>handle.dispose());
