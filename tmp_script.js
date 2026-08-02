
/* ===================================================================== */
/* FILE SYSTEM — IndexedDB backed virtual file system                     */
/* ===================================================================== */
/*
  Storage layer with graceful degradation. IndexedDB is preferred, but in some
  contexts (file://, private/sandboxed windows, blocked site-data) the call
  `indexedDB.open()` throws "access to the Indexed Database API is denied".
  Rather than crash the whole OS, we fall back to localStorage, and finally to
  an in-memory store so BenOS always boots. The public interface
  (put/del/get/all on the 'fs' and 'meta' stores) is identical in every mode.
*/
const DB = {
  name:'BenOS_13_Beta_4', version:2, db:null,
  mode:'memory',                       // 'idb' | 'local' | 'memory'
  mem:{ fs:new Map(), meta:new Map(), assets:new Map() },// used by 'local' and 'memory' modes
  _quotaWarned:false,

  async open(){
    // 1) Try IndexedDB (best: large, persistent)
    try{
      DB.db = await DB._openIDB();
      DB.mode='idb';
      return DB.db;
    }catch(e){
      console.warn('BenOS: IndexedDB unavailable ('+(e&&e.message||e)+'). Falling back.');
    }
    // 2) Try localStorage (persistent, ~5MB)
    try{
      const probe='__benos_probe__';
      window.localStorage.setItem(probe,'1');
      window.localStorage.removeItem(probe);
      DB.mode='local';
      DB._loadLocal();
      return null;
    }catch(e){
      console.warn('BenOS: localStorage unavailable ('+(e&&e.message||e)+'). Using in-memory storage.');
    }
    // 3) In-memory (works always, not saved after the page closes)
    DB.mode='memory';
    return null;
  },

  _openIDB(){
    return new Promise((res,rej)=>{
      let done=false, req;
      try{
        if(typeof indexedDB==='undefined' || !indexedDB) throw new Error('IndexedDB not present');
        req=indexedDB.open(DB.name,DB.version);
      }catch(e){ return rej(e); }            // synchronous SecurityError (denied context)
      const to=setTimeout(()=>{ if(!done){done=true;rej(new Error('IndexedDB open timed out'));} },5000);
      req.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains('fs')){const s=db.createObjectStore('fs',{keyPath:'id'});s.createIndex('parentId','parentId',{unique:false});}
        if(!db.objectStoreNames.contains('meta')){db.createObjectStore('meta',{keyPath:'key'});}
        if(!db.objectStoreNames.contains('assets')){db.createObjectStore('assets',{keyPath:'key'});} // large binary system assets (backgrounds/musics/sounds)
      };
      req.onsuccess=e=>{ if(done)return; done=true; clearTimeout(to); DB.db=e.target.result; res(DB.db); };
      req.onerror  =e=>{ if(done)return; done=true; clearTimeout(to); rej((e.target&&e.target.error)||new Error('IndexedDB open failed')); };
      req.onblocked=()=>{ /* wait for success or timeout */ };
    });
  },

  /* localStorage persistence helpers (store each table as one JSON blob) */
  _loadLocal(){
    try{ (JSON.parse(window.localStorage.getItem('benos_fs')||'[]')).forEach(n=>DB.mem.fs.set(n.id,n)); }catch(e){}
    try{ (JSON.parse(window.localStorage.getItem('benos_meta')||'[]')).forEach(m=>DB.mem.meta.set(m.key,m)); }catch(e){}
  },
  _saveLocal(){
    if(DB.mode!=='local') return;
    try{
      window.localStorage.setItem('benos_fs', JSON.stringify([...DB.mem.fs.values()]));
      window.localStorage.setItem('benos_meta', JSON.stringify([...DB.mem.meta.values()]));
    }catch(e){
      if(!DB._quotaWarned){ DB._quotaWarned=true; setTimeout(()=>{ try{ notify('Storage limit reached','Could not save — browser storage is full (large files exceed the localStorage limit).','⚠️'); }catch(_){} },50); }
    }
  },

  /* unified API ----------------------------------------------------------- */
  tx(store,mode){ return DB.db.transaction(store,mode).objectStore(store); },
  put(store,val){
    if(DB.mode==='idb') return new Promise((res,rej)=>{const r=DB.tx(store,'readwrite').put(val);r.onsuccess=()=>res(val);r.onerror=()=>rej(r.error);});
    DB.mem[store].set(store==='fs'?val.id:val.key, val); DB._saveLocal(); return Promise.resolve(val);
  },
  del(store,key){
    if(DB.mode==='idb') return new Promise((res,rej)=>{const r=DB.tx(store,'readwrite').delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});
    DB.mem[store].delete(key); DB._saveLocal(); return Promise.resolve();
  },
  get(store,key){
    if(DB.mode==='idb') return new Promise((res,rej)=>{const r=DB.tx(store,'readonly').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
    return Promise.resolve(DB.mem[store].get(key));
  },
  all(store){
    if(DB.mode==='idb') return new Promise((res,rej)=>{const r=DB.tx(store,'readonly').getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});
    return Promise.resolve([...DB.mem[store].values()]);
  },
};

/* In-memory mirror of the file system for fast synchronous UI access. */
const FS = {
  nodes:new Map(),     // id -> node
  meta:new Map(),      // key -> value (system metadata)

  async load(){
    const resetPending=getResetFlag();
    if(resetPending){ clearResetFlag(); resetBenOSRuntimeDefaults(); FS.nodes.clear(); FS.meta.clear(); }
    const arr = await DB.all('fs');
    if(!resetPending){
      FS.nodes.clear();
      arr.forEach(n=>FS.nodes.set(n.id,n));
      const m = await DB.all('meta');
      FS.meta.clear();
      m.forEach(x=>FS.meta.set(x.key,x.value));
    }
    if(resetPending || FS.nodes.size===0){ await FS.seed(); }
    // migrations (run on every boot to catch new apps)
    const r=FS.nodes.get('root');
    if(r && r.name==='Macintosh HD'){ r.name='Internal Disk'; await DB.put('fs',r); }
    const wp=FS.meta.get('wallpaper');
    if(wp && BENOS.oldWallpapers.includes(wp)){ FS.meta.set('wallpaper',null); await DB.put('meta',{key:'wallpaper',value:null}); }
    // ensure all system apps exist
    const sysApps=[['app-studios','BenStudio.html','studio'],['app-pen','BenPen.html','pen'],['app-benviewer','BenViewer.html','benviewer']];
    for(const [id,name,sys] of sysApps){
      if(!FS.nodes.get(id)){
        const n={id,parentId:'applications',name,type:'app',kind:'app',mime:'',size:0,content:'<!-- BenOS system application: '+sys+' -->',created:now(),modified:now(),systemApp:sys,dx:null,dy:null};
        FS.nodes.set(n.id,n); await DB.put('fs',n);
        const dock=FS.meta.get('dock')||[];
        if(!dock.includes(id)){ dock.splice(Math.max(0,dock.length-1),0,id); FS.meta.set('dock',dock); await DB.put('meta',{key:'dock',value:dock}); }
      }
    }
    // ensure Trash exists
    if(!FS.nodes.get('trash')){
      const t={id:'trash',parentId:'root',name:'Trash',type:'folder',kind:'folder',mime:'',size:0,content:'',created:now(),modified:now(),systemApp:null,dx:null,dy:null};
      FS.nodes.set(t.id,t); await DB.put('fs',t);
    }
  },

  /* metadata helpers */
  getMeta(k,def){ return FS.meta.has(k)?FS.meta.get(k):def; },
  async setMeta(k,v){ FS.meta.set(k,v); await DB.put('meta',{key:k,value:v}); },

  /* persistence of a single node */
  async save(n){ n.modified=n.modified||now(); FS.nodes.set(n.id,n); await DB.put('fs',n); return n; },

  get(id){ return FS.nodes.get(id); },
  children(pid){ return [...FS.nodes.values()].filter(n=>n.parentId===pid); },
  childByName(pid,name){ return [...FS.nodes.values()].find(n=>n.parentId===pid && n.name.toLowerCase()===String(name).toLowerCase()); },

  /* unique name within a folder (adds "copy"/number) */
  uniqueName(pid,name){
    if(!FS.childByName(pid,name))return name;
    const dot=name.lastIndexOf('.'); const base=dot>0?name.slice(0,dot):name; const ext=dot>0?name.slice(dot):'';
    let i=2,cand;
    do{ cand=base+' copy'+(i===2?'':' '+i)+ext; i++; }while(FS.childByName(pid,cand));
    return cand;
  },

  async createNode(opt){
    const n=Object.assign({
      id:uid(), parentId:opt.parentId, name:opt.name, type:opt.type||'file',
      kind:opt.kind||'generic', mime:opt.mime||'', size:opt.size||0,
      content:opt.content!=null?opt.content:'', created:now(), modified:now(),
      systemApp:opt.systemApp||null, dx:null, dy:null
    },opt.extra||{});
    if(n.type==='folder')n.kind='folder';
    await FS.save(n);
    return n;
  },

  async createFile(pid,name,content,kind){
    name=FS.uniqueName(pid,name);
    const k=kind||kindFromName(name);
    return FS.createNode({parentId:pid,name,type:'file',kind:k,content:content||'',size:(content||'').length});
  },
  async createFolder(pid,name){
    name=FS.uniqueName(pid,name||'untitled folder');
    return FS.createNode({parentId:pid,name,type:'folder'});
  },
  async rename(id,name){
    const n=FS.get(id); if(!n)return; n.name=name; n.modified=now(); await FS.save(n); return n;
  },
  async remove(id){
    const n=FS.get(id); if(!n)return;
    // recurse children
    for(const c of FS.children(id)){ await FS.remove(c.id); }
    FS.nodes.delete(id);
    await DB.del('fs',id);
  },
  async duplicate(id,toParent){
    const n=FS.get(id); if(!n)return;
    const pid = toParent||n.parentId;
    const copy=Object.assign({},n);
    copy.id=uid(); copy.parentId=pid; copy.name=FS.uniqueName(pid,n.name);
    copy.created=now(); copy.modified=now(); copy.dx=null; copy.dy=null;
    await FS.save(copy);
    // recurse children for folders
    if(n.type==='folder'){ for(const c of FS.children(id)){ await FS._dupInto(c.id,copy.id); } }
    return copy;
  },
  async _dupInto(id,newParent){
    const n=FS.get(id);
    const copy=Object.assign({},n);
    copy.id=uid(); copy.parentId=newParent; copy.created=now(); copy.modified=now();
    await FS.save(copy);
    if(n.type==='folder'){ for(const c of FS.children(id)){ await FS._dupInto(c.id,copy.id); } }
    return copy;
  },
  async move(id,toParent){
    const n=FS.get(id); if(!n||toParent===id)return;
    // prevent moving folder into its own descendant
    let p=toParent; while(p){ if(p===id)return; const pn=FS.get(p); p=pn?pn.parentId:null; }
    n.parentId=toParent; n.name=FS.uniqueName(toParent,n.name); n.dx=null;n.dy=null; n.modified=now();
    await FS.save(n); return n;
  },
  /* full path of a node */
  pathOf(id){
    const parts=[]; let n=FS.get(id);
    while(n && n.id!=='root'){ parts.unshift(n.name); n=FS.get(n.parentId); }
    return '/'+parts.join('/');
  },
  search(q){
    q=q.toLowerCase().trim(); if(!q)return [];
    return [...FS.nodes.values()].filter(n=>n.id!=='root'&&n.name.toLowerCase().includes(q)).slice(0,40);
  },

  /* recursive size / counts for storage info */
  stats(){
    let files=0,folders=0,bytes=0;
    FS.nodes.forEach(n=>{ if(n.id==='root')return; if(n.type==='folder')folders++; else{files++; bytes+=sizeOf(n);} });
    return {files,folders,bytes};
  },

  /* ---- default file system seed ---- */
  async seed(){
    FS.nodes.clear(); FS.meta.clear();
    const mk=(o)=>{const n=Object.assign({id:o.id||uid(),parentId:o.parentId,name:o.name,type:o.type||'file',kind:o.kind||(o.type==='folder'?'folder':kindFromName(o.name)),mime:o.mime||'',size:o.size||(o.content?o.content.length:0),content:o.content||'',created:now(),modified:now(),systemApp:o.systemApp||null,dx:o.dx??null,dy:o.dy??null},o.extra||{});FS.nodes.set(n.id,n);return n;};
    mk({id:'root',parentId:null,name:'Internal Disk',type:'folder'});
    mk({id:'desktop',parentId:'root',name:'Desktop',type:'folder'});
    mk({id:'documents',parentId:'root',name:'Documents',type:'folder'});
    mk({id:'downloads',parentId:'root',name:'Downloads',type:'folder'});
    mk({id:'music-folder',parentId:'root',name:'Music',type:'folder'});
    mk({id:'pictures',parentId:'root',name:'Pictures',type:'folder'});
    mk({id:'applications',parentId:'root',name:'Applications',type:'folder'});
    mk({id:'trash',parentId:'root',name:'Trash',type:'folder'});
    // system applications (HTML files that behave as executables)
    const apps=[['app-files','Files.html','files'],['app-settings','Settings.html','settings'],['app-browser','BenBrowser.html','browser'],['app-music','BenMusic.html','music'],['app-health','BenHealth.html','health'],['app-studios','BenStudio.html','studios'],['app-terminal','Terminal.html','terminal'],['app-pen','BenPen.html','pen'],['app-benviewer','BenViewer.html','benviewer']];
    apps.forEach(a=>mk({id:a[0],parentId:'applications',name:a[1],type:'app',kind:'app',systemApp:a[2],content:'<!-- BenOS system application: '+a[2]+' -->'}));
    // desktop content
    mk({parentId:'desktop',name:'Welcome.txt',content:'Welcome to BenOS HTML Edition!\n\nThis is a complete operating system running entirely in your browser.\n\nTry:\n• Double-click apps in the Dock\n• Right-click anything for context menus\n• Press Ctrl+Space for Search\n• Build apps with BenStudio\n• Drag files from your computer onto the desktop\n\nEnjoy!',dx:30,dy:20});
    mk({parentId:'desktop',name:'About BenOS.txt',content:'BenOS HTML Edition\n\nA single-file browser operating system, built to power your everyday tasks.\nBuilt with HTML, CSS and JavaScript.\nNo frameworks. No external dependencies.',dx:30,dy:130});
    mk({parentId:'desktop',name:'Projects',type:'folder',dx:30,dy:240});
    mk({parentId:'documents',name:'Notes.txt',content:'This is a sample note inside BenOS. Make a new one, or modify/delete this one. You can also drag and drop files from your computer into BenOS, or create new files and folders.',dx:20,dy:20});
    mk({parentId:'documents',name:'TODO.txt',content:'1. Explore BenOS\n2. Try the Terminal\n3. Play some music'});
    // a sample drawn image so Pictures isn't empty
    mk({parentId:'pictures',name:'WP-source.txt',content:'Default wallpaper has unknown source.'});
    // persist everything
    for(const n of FS.nodes.values()){ await DB.put('fs',n); }
    // default dock = system apps
    await FS.setMeta('dock',['app-files','app-browser','app-music','app-health','app-studios','app-pen','app-terminal','app-settings']);
    await FS.setMeta('wallpaper',null);
    await FS.setMeta('dockSize',52);
    await FS.setMeta('dockMag',true);
    await FS.setMeta('brightness',1);
    await FS.setMeta('volume',0.8);
    await FS.setMeta('muted',false);
  }
};
function sizeOf(n){
  if(n.size && typeof n.size==='number' && n.size>0) return n.size;
  if(typeof n.content==='string') return n.content.length;
  return 0;
}
/* ===================================================================== */
/* ICON RENDERING — produces the visual glyph for any node                 */
/* ===================================================================== */
const SYSTEM_APPS = {
  files:   {name:'Files',      color:'#3a86e0', glyph:'🗂'},
  settings:{name:'Settings',   color:'#8e8e93', glyph:'⚙️'},
  browser: {name:'BenBrowser', color:'#2db84d', glyph:'🧭'},
  music:   {name:'BenMusic',   color:'#fc2c55', glyph:'🎵'},
  health:  {name:'BenHealth',  color:'#ff375f', glyph:'❤️'},
  studios: {name:'BenStudio', color:'#6943ff', glyph:'⌨'},
  terminal:{name:'Terminal',   color:'#2b2b2e', glyph:'&gt;_'},
  pen:     {name:'BenPen',     color:'#e67e22', glyph:'✏️'},
  benviewer: {name:'BenViewer',  color:'#5ac8fa', glyph:'🖼'},
};
const EXT_APPS = {
  txt:   [{label:'Text Editor', action:n=>openTextEditor(n)}],
  html:  [{label:'Text Editor', action:n=>openTextEditor(n)},{label:'BenStudio', action:n=>launchSystemApp('studio',null,null,n)}],
  htm:   [{label:'Text Editor', action:n=>openTextEditor(n)},{label:'BenStudio', action:n=>launchSystemApp('studio',null,null,n)}],
  mp3:   [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  wav:   [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  flac:  [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  ogg:   [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  aac:   [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  wma:   [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  m4a:   [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  opus:  [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  aiff:  [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  alac:  [{label:'BenMusic', action:n=>launchSystemApp('music',null,null,n)}],
  png:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  jpg:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  jpeg:  [{label:'BenViewer', action:n=>openImageViewer(n)}],
  gif:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  webp:  [{label:'BenViewer', action:n=>openImageViewer(n)}],
  bmp:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  svg:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  heic:  [{label:'BenViewer', action:n=>openImageViewer(n)}],
  tiff:  [{label:'BenViewer', action:n=>openImageViewer(n)}],
  tif:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  ico:   [{label:'BenViewer', action:n=>openImageViewer(n)}],
  avif:  [{label:'BenViewer', action:n=>openImageViewer(n)}],
};
function iconHTML(node,size){
  size=size||54;
  const st='width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*0.46)+'px;';
  if(node.systemApp && SYSTEM_APPS[node.systemApp]){
    return '<div class="ico app '+node.systemApp+'" style="'+st+'border-radius:'+Math.round(size*0.23)+'px"></div>';
  }
  if(node.type==='folder') return '<div class="ico folder" style="'+st+'">📁</div>';
  if(node.kind==='image' && typeof node.content==='string' && node.content.startsWith('data:image'))
    return '<div class="ico image" style="'+st+'background-image:url('+node.content+')"></div>';
  const map={txt:'📄',image:'🖼',audio:'🎵',video:'🎬',pdf:'📕',zip:'🗜',app:'📦',generic:'📄'};
  const cls = (node.kind in map)?node.kind:'generic';
  return '<div class="ico '+cls+'" style="'+st+'">'+(map[node.kind]||'📄')+'</div>';
}

/* ===================================================================== */
/* BOOT SYSTEM                                                             */
/* ===================================================================== */
async function runBoot(){
  const bar=$('#boot-bar');
  const logo=$('#boot-logo'); if(logo){ logo.onerror=()=>{ logo.style.display='none'; }; logo.src=BENOS.logo; }
  $('#boot').style.display='flex';
  $('#boot').style.opacity='1';
  const resetPending=getResetFlag();
  if(resetPending){ clearResetFlag(); resetBenOSRuntimeDefaults(); }
  try{
    await DB.open();
    await FS.load();
  }catch(e){
    return benFatal('File system failed to initialize: '+(e.message||e));
  }
  // Download BenOS system files (metadata) from the GitHub repository. The
  // boot progress bar reflects real download progress; falls back to a
  // simulated bar when the repo/network is unavailable so BenOS always boots.
  await downloadMetadata(bar);
  bar.style.width='100%';
  await new Promise(r=>setTimeout(r,400));
  $('#boot').style.opacity='0';
  // Only present the login screen when there is something to authenticate:
  // a password is set, or more than one user account exists. Otherwise
  // auto-login the single password-free user straight into the desktop.
  setTimeout(()=>{ $('#boot').style.display='none'; if(needsLogin())showLogin(); else autoLogin(); },800);
}
  document.querySelectorAll("a[data-benbrowser]").forEach(a=>{a.addEventListener("click",e=>{e.preventDefault();const url=a.getAttribute("data-benbrowser");window.parent.postMessage({__benos:true,type:"browser-navigate",url},"*");});});</script></body></html>';

/* ===================================================================== */
/* METADATA DOWNLOAD SYSTEM                                                */
/* Downloads BenOS system files from the GitHub metadata repository.       */
/* Directory inside the repo is the BenOS version, e.g. /HTML-1.0/             */
/* Repo: https://github.com/BenjaminOriginals/BenOS-HTML           */
/* ===================================================================== */
const META_REPO = 'BenjaminOriginals/BenOS-HTML';
const META_VER = 'HTML-1.0';
/* live metadata state: file listings per directory + loaded system sounds */
const META = { branch:'main', manifest:{backgrounds:[],sounds:[],musics:[]}, sounds:{}, musicReady:false, online:false };
function getResetFlag(){ try{return window.localStorage.getItem('benos_reset')==='1';}catch(e){return false;} }
function clearResetFlag(){ try{ window.localStorage.removeItem('benos_reset'); }catch(e){} }
function resetBenOSRuntimeDefaults(){ BENOS.volume=0.8; BENOS.muted=false; META.sounds={}; META.musicReady=false; }
function metaApi(dir){ return 'https://api.github.com/repos/'+META_REPO+'/contents/'+META_VER+'/'+dir+'?ref='+META.branch; }
function setBootStatus(txt){ /* boot is text-free */ }
function assetKey(dir,name){ return 'asset:'+dir+':'+name; }
function blobToDataURL(blob){ return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob);}); }

/* list a metadata directory via the GitHub contents API */
async function metaList(dir){
  for(const branch of ['main','master']){
    META.branch=branch;
    const res=await fetchWithTimeout(metaApi(dir),12000);
    if(res && res.ok){
      const arr=await res.json();
      if(Array.isArray(arr)) return arr.filter(x=>x.type==='file'&&x.download_url).map(x=>({name:x.name,sha:x.sha,size:x.size||0,url:x.download_url,dir}));
    }
  }
  return [];
}
/* fetch the cached data URL for an asset key (null if not present) */
async function assetData(key){
  try{ const r=await DB.get('assets',key); if(r&&r.data) return r.data; }catch(e){}
  if(typeof key==='string'){
    const parts=key.split(':');
    const dir=parts[1]||'';
    const name=parts.slice(2).join(':');
    if(dir==='Wallpapers' && BENOS.wallpapers && BENOS.wallpapers[name]) return BENOS.wallpapers[name];
    if(dir==='backgrounds' && BENOS.wallpapers && BENOS.wallpapers[name]) return BENOS.wallpapers[name];
  }
  return null;
}
/* download an asset if not already cached with the same sha (repair-on-boot) */
async function ensureAsset(f){
  const key=assetKey(f.dir,f.name);
  try{ const c=await DB.get('assets',key); if(c && c.data && (!f.url || c.sha===f.sha)) return c.data; }catch(e){}
  if(!f.url) return await assetData(key);   // cache-only entry, nothing to fetch
  try{
    const res=await fetchWithTimeout(f.url,60000);
    if(!res||!res.ok) throw new Error('download failed');
    const blob=await res.blob();
    const data=await blobToDataURL(blob);
    try{ await DB.put('assets',{key,dir:f.dir,name:f.name,sha:f.sha,size:f.size,data}); }catch(e){}
    return data;
  }catch(e){ return await assetData(key); }   // fall back to any cached copy
}

/* BOOT-TIME download: backgrounds + sounds (music is fetched later, in the background) */
async function downloadMetadata(bar){
  setBootStatus('Connecting to BenOS servers\u2026');
  let bg=[],snd=[],mus=[];
  try{ bg=await metaList('backgrounds'); }catch(e){}
  try{ const wp=await metaList('Wallpapers'); if(Array.isArray(wp)) bg=bg.concat(wp); }catch(e){}
  try{ snd=await metaList('sounds'); }catch(e){}
  try{ mus=await metaList('musics'); }catch(e){}
  META.manifest={backgrounds:bg,sounds:snd,musics:mus};
  META.online = (bg.length+snd.length+mus.length)>0;
  // If the GitHub API was unreachable/rate-limited but we have cached assets from
  // a previous boot, rebuild the manifest from the cache so wallpapers/music still appear.
  try{
    const cached=await DB.all('assets');
    if(cached.length){
      ['backgrounds','Wallpapers','sounds','musics'].forEach(dir=>{
        if(!META.manifest[dir] || !META.manifest[dir].length){
          META.manifest[dir]=cached.filter(a=>a.dir===dir).map(a=>({name:a.name,sha:a.sha,size:a.size||0,url:null,dir}));
        }
      });
    }
  }catch(e){}
  bg=META.manifest.backgrounds; snd=META.manifest.sounds; mus=META.manifest.musics;
  const bootFiles=bg.concat(snd);
  if(!bootFiles.length){ setBootStatus('BenOS HTML Edition'); await simulateBoot(bar); await loadSounds(); return; }
  const totalBytes=bootFiles.reduce((s,f)=>s+(f.size||1),0)||1;
  let doneBytes=0; bar.style.width='2%';
  setBootStatus('Downloading system files\u2026');
  for(const f of bootFiles){
    await ensureAsset(f);
    doneBytes+=(f.size||1);
    bar.style.width=Math.max(2,Math.round(doneBytes/totalBytes*100))+'%';
    setBootStatus('Downloading system files\u2026 '+fmtSize(doneBytes)+' / '+fmtSize(totalBytes));
  }
  try{ await FS.setMeta('systemMetadata',{version:BENOS.version,branch:META.branch,fetchedAt:now(),counts:{backgrounds:bg.length,sounds:snd.length,musics:mus.length}}); }catch(e){}
  await loadSounds();
  setBootStatus('BenOS HTML Edition');
}

/* load the alert/change/notification system sounds from cache into memory */
async function loadSounds(){
  for(const f of (META.manifest.sounds||[])){
    const base=f.name.replace(/\.\w+$/,'').toLowerCase();
    const d=await assetData(assetKey('sounds',f.name));
    if(d) META.sounds[base]=d;
  }
}

/* download the BenMusic library in the background, after the desktop is ready */
async function downloadMusicAssets(){
  const mus=META.manifest.musics||[]; if(!mus.length){ META.musicReady=true; return; }
  let got=0;
  for(const f of mus){ const d=await ensureAsset(f); if(d)got++; refreshMusicLibraries(); }
  META.musicReady=true; refreshMusicLibraries();
  if(got) notify('Music library ready', got+' track'+(got>1?'s':'')+' available in BenMusic','\ud83c\udfb5');
}
function refreshMusicLibraries(){ [...WM.windows.values()].forEach(w=>{ if(w.systemApp==='music'&&w.refreshLib){ try{w.refreshLib();}catch(e){} } }); }

/* ===================================================================== */
/* SYSTEM SOUNDS — alert / change / notification (metadata or synthesized) */
/* ===================================================================== */
let _soundCtx=null;
let _audioInited=false;
function initAudioCtx(){
  if(!_soundCtx){
    _soundCtx=new (window.AudioContext||window.webkitAudioContext)();
  }
  if(_soundCtx.state==='suspended') _soundCtx.resume();
  _audioInited=true;
}
// init audio on first user interaction (required by Chrome autoplay policy)
document.addEventListener('mousedown',()=>{ if(!_audioInited)initAudioCtx(); },{once:true});
document.addEventListener('keydown',()=>{ if(!_audioInited)initAudioCtx(); },{once:true});
function playSound(name){
  try{
    if(BENOS.muted) return;
    const data=META.sounds[name];
    if(data){ const a=new Audio(data); a.volume=Math.min(1,BENOS.volume); a.play().catch(()=>synthSound(name)); return; }
    synthSound(name);
  }catch(e){ try{ synthSound(name); }catch(_){} }
}
function synthSound(name){
  try{
    if(BENOS.muted) return;
    initAudioCtx();
    const ctx=_soundCtx; if(ctx.state==='suspended')ctx.resume();
    const o=ctx.createOscillator(), g=ctx.createGain();
    const map={alert:{f:233,t:'square',d:0.22},change:{f:620,t:'sine',d:0.06},notification:{f:740,t:'triangle',d:0.18}};
    const c=map[name]||map.change;
    o.type=c.t; o.frequency.value=c.f; o.connect(g); g.connect(ctx.destination);
    const t0=ctx.currentTime, vol=Math.min(0.35,BENOS.volume*0.35);
    g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(vol,t0+0.012); g.gain.exponentialRampToValueAtTime(0.0001,t0+c.d);
    if(name==='notification'){ o.frequency.setValueAtTime(680,t0); o.frequency.exponentialRampToValueAtTime(1040,t0+c.d); }
    if(name==='alert'){ o.frequency.setValueAtTime(233,t0); o.frequency.setValueAtTime(196,t0+c.d/2); }
    o.start(t0); o.stop(t0+c.d+0.03);
  }catch(e){}
}

function fetchWithTimeout(url,ms){
  return new Promise((resolve)=>{
    let settled=false;
    const ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
    const to=setTimeout(()=>{ if(!settled){ settled=true; if(ctrl)ctrl.abort(); resolve(null); } },ms||8000);
    const opts=ctrl?{signal:ctrl.signal,cache:'no-store'}:{cache:'no-store'};
    fetch(url,opts).then(r=>{ if(!settled){ settled=true; clearTimeout(to); resolve(r); } })
                   .catch(()=>{ if(!settled){ settled=true; clearTimeout(to); resolve(null); } });
  });
}

/* Original simulated boot bar \u2014 fallback when metadata is unavailable. */
function simulateBoot(bar){
  return new Promise(resolve=>{
    let p=0;
    const timer=setInterval(()=>{ p+=Math.random()*16+7; if(p>=100){ p=100; clearInterval(timer); } bar.style.width=p+'%'; },210);
    setTimeout(()=>{ clearInterval(timer); bar.style.width='100%'; resolve(); },1400);
  });
}

/* ===================================================================== */
/* LOGIN SYSTEM                                                            */
/* ===================================================================== */
/* user accounts (stored in the file system metadata) */
function getUsers(){
  const u=FS.getMeta('users',null);
  if(!u || !u.length) return [{name:'BenOS User 1', pass:'', hint:'', avatar:'👤'}];
  return u.map(x=>({
    name:x.name||'BenOS User 1',
    pass:x.pass||'',
    hint:x.hint||'',
    avatar:x.avatar||'👤'
  }));
}
function needsLogin(){
  const u=getUsers();
  return u.length>1 || u.some(x=>x.pass && x.pass.length>0);
}
function autoLogin(){ BENOS.user=getUsers()[0].name; startDesktop(); }

let loginUserIdx=0;
function showLogin(){
  const users=getUsers();
  loginUserIdx=0;
  const lg=$('#login');
  applyWallpaperToElement(lg, BENOS.defaultWallpaper || BENOS.fallbackWallpaper);
  resolveWallpaper(FS.getMeta('wallpaper',null)).then(url=>{ applyWallpaperToElement(lg, url); }).catch(()=>{ applyWallpaperToElement(lg, BENOS.fallbackWallpaper); });
  lg.style.display='flex'; lg.style.opacity='1';
  const panel=$('#login .panel');
  const pwrow='<div class="pwrow"><input id="login-pass" type="password" placeholder="Enter Password" autocomplete="off"><div class="go" id="login-go">→</div></div><div class="hint" id="login-hint"></div><button type="button" class="recover" id="login-recover">Forgot password?</button>';
  if(users.length>1){
    panel.innerHTML='<div class="userpick">'+users.map((u,i)=>'<div class="upick'+(i===0?' sel':'')+'" data-i="'+i+'"><div class="uav">'+(u.avatar||'👤')+'</div><div class="un">'+esc(u.name)+'</div></div>').join('')+'</div>'+pwrow;
  }else{
    const u=users[0];
    panel.innerHTML='<div class="avatar" id="login-avatar">'+(u.avatar||'👤')+'</div><div class="uname" id="login-uname">'+esc(u.name)+'</div>'+pwrow;
  }
  wireLogin(users);
}
function wireLogin(users){
  const pass=$('#login-pass');
  const refresh=()=>{
    const cur=users[loginUserIdx];
    if($('#login-avatar'))$('#login-avatar').textContent=cur.avatar||'👤';
    if($('#login-uname'))$('#login-uname').textContent=cur.name;
    pass.placeholder=cur.pass?'Enter Password':'Press Enter to log in';
    if($('#login-hint'))$('#login-hint').textContent=cur.pass?'Need help? Click Forgot password.':'No password set — just press Enter';
    pass.value='';
    $$('.upick').forEach((e,i)=>e.classList.toggle('sel',i===loginUserIdx));
  };
  refresh(); setTimeout(()=>pass.focus(),120);
  $$('.upick').forEach(e=>e.onclick=()=>{ loginUserIdx=+e.dataset.i; refresh(); pass.focus(); });
  const attempt=()=>{
    const cur=users[loginUserIdx];
    if(pass.value===(cur.pass||'')){ BENOS.user=cur.name; doLoginSuccess(); }
    else{ const pnl=$('#login .panel'); pnl.classList.add('shake'); setTimeout(()=>pnl.classList.remove('shake'),450); pass.value=''; }
  };
  $('#login-go').onclick=attempt;
  pass.onkeydown=e=>{ if(e.key==='Enter')attempt(); };
  const recover=$('#login-recover');
  if(recover) recover.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); showPasswordRecovery(users[loginUserIdx]); });
}
function showPasswordRecovery(cur){
  if(!cur.pass){
    showDialog({ icon:'🔐', title:'Password Recovery', body:'This account is not password protected, so no recovery hint is available.', buttons:[{label:'Close',primary:true}] });
    return;
  }
  if(cur.hint){
    showDialog({ icon:'🔐', title:'Password Recovery', body:'Use the hint below to recall your passcode.', code:cur.hint, buttons:[{label:'Close',primary:true}] });
  }else{
    showDialog({ icon:'🔐', title:'Password Recovery', body:'No recovery hint has been set for this account yet. Open Settings → Users to add one.', buttons:[{label:'Close',primary:true}] });
  }
}
function doLoginSuccess(){
  const lg=$('#login');
  lg.style.opacity='0';
  setTimeout(()=>{ lg.style.display='none'; startDesktop(); },700);
}

/* ===================================================================== */
/* WINDOW MANAGER                                                          */
/* ===================================================================== */
/* Windows-style caption button glyphs (use currentColor so hover recolours) */
const WIN_ICONS = {
  min:    '<svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5.2" width="9" height="1.1" fill="currentColor"/></svg>',
  max:    '<svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  restore:'<svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.2" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M3.6 3V1.3h6.2v6.2H8" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  close:  '<svg width="11" height="11" viewBox="0 0 11 11"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>',
};
const WM = {
  windows:new Map(),
  zTop:100,
  focused:null,
  cascade:0,

  create(opt){
    const id=uid();
    const layer=$('#window-layer');
    const w=el('div','window');
    const ww=opt.width||640, wh=opt.height||440;
    const vw=window.innerWidth, vh=window.innerHeight-24;
    let x = opt.x!=null?opt.x : Math.max(20,(vw-ww)/2)+ (WM.cascade*26)%160 -80;
    let y = opt.y!=null?opt.y : Math.max(14,(vh-wh)/2-30)+ (WM.cascade*26)%140 -70;
    WM.cascade++;
    w.style.left=Math.max(4,x)+'px'; w.style.top=Math.max(4,y)+'px';
    w.style.width=ww+'px'; w.style.height=wh+'px';
    w.innerHTML =
      '<div class="titlebar">'+
        '<div class="title">'+esc(opt.title||'Window')+'</div>'+
        '<div class="wctrls">'+
          '<div class="wbtn min" title="Minimize">'+WIN_ICONS.min+'</div>'+
          '<div class="wbtn max" title="Maximize">'+WIN_ICONS.max+'</div>'+
          '<div class="wbtn close" title="Close">'+WIN_ICONS.close+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="win-body"></div>'+
      '<div class="resz n"></div><div class="resz s"></div><div class="resz e"></div><div class="resz w"></div>'+
      '<div class="resz ne"></div><div class="resz nw"></div><div class="resz se"></div><div class="resz sw"></div>';
    layer.appendChild(w);

    const win={
      id, el:w, appName:opt.title||'Window', fileId:opt.fileId||null, systemApp:opt.systemApp||null,
      body:$('.win-body',w), titleEl:$('.title',w),
      minimized:false, maximized:false, prevRect:null, alwaysTop:false,
      onClose:opt.onClose||null,
      guard(fn){ return function(){ try{ return fn.apply(this,arguments); }catch(e){ appCrash(win,e.message||e); } }; },
      setTitle(t){ win.appName=t; win.titleEl.textContent=t; if(WM.focused===win)refreshMenuApp(); },
    };
    WM.windows.set(id,win);

    // Windows-style caption buttons
    $('.wbtn.close',w).onclick=(e)=>{e.stopPropagation();WM.close(win);};
    $('.wbtn.min',w).onclick=(e)=>{e.stopPropagation();WM.minimize(win);};
    $('.wbtn.max',w).onclick=(e)=>{e.stopPropagation();WM.toggleMax(win);};
    $('.titlebar',w).ondblclick=(e)=>{ if(e.target.closest('.wbtn'))return; WM.toggleMax(win); };

    // focus on mousedown
    w.addEventListener('mousedown',()=>WM.focus(win),true);
    // dragging
    WM._dragify(win);
    WM._resizify(win);
    // window context menu
    $('.titlebar',w).addEventListener('contextmenu',e=>{ e.preventDefault();e.stopPropagation(); windowMenu(win,e.clientX,e.clientY); });

    WM.focus(win);
    setTimeout(()=>w.classList.add('show'),15);
    return win;
  },

  focus(win){
    if(WM.focused===win){return;}
    if(WM.focused){ WM.focused.el.classList.add('blur'); }
    WM.focused=win;
    win.el.classList.remove('blur');
    win.el.style.zIndex = win.alwaysTop? 5000 : (++WM.zTop);
    refreshMenuApp();
    updateDockRunning();
  },

  _dragify(win){
    const tb=$('.titlebar',win.el);
    tb.addEventListener('mousedown',e=>{
      if(e.target.closest('.wbtn'))return;
      if(win.maximized)return;
      e.preventDefault();
      const sx=e.clientX, sy=e.clientY;
      const ox=parseFloat(win.el.style.left), oy=parseFloat(win.el.style.top);
      const mv=ev=>{
        let nx=ox+ev.clientX-sx, ny=oy+ev.clientY-sy;
        ny=Math.max(0,ny);
        win.el.style.left=nx+'px'; win.el.style.top=ny+'px';
      };
      const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
      document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
    });
  },

  _resizify(win){
    $$('.resz',win.el).forEach(h=>{
      h.addEventListener('mousedown',e=>{
        e.preventDefault();e.stopPropagation();
        if(win.maximized)return;
        const dir=h.className.replace('resz','').trim();
        const sx=e.clientX,sy=e.clientY;
        const r=win.el.getBoundingClientRect();
        const minW=260,minH=160;
        const mv=ev=>{
          let dx=ev.clientX-sx, dy=ev.clientY-sy;
          let nl=r.left,nt=r.top-24,nw=r.width,nh=r.height; // -24 for menubar offset of layer
          nt=r.top; // layer is offset; use absolute then convert
          let left=parseFloat(win.el.style.left), top=parseFloat(win.el.style.top);
          let W=r.width,H=r.height;
          if(dir.includes('e'))W=Math.max(minW,r.width+dx);
          if(dir.includes('s'))H=Math.max(minH,r.height+dy);
          if(dir.includes('w')){ const nW=Math.max(minW,r.width-dx); left=left+(r.width-nW); W=nW; }
          if(dir.includes('n')){ const nH=Math.max(minH,r.height-dy); top=Math.max(0,top+(r.height-nH)); H=nH; }
          win.el.style.width=W+'px'; win.el.style.height=H+'px';
          win.el.style.left=left+'px'; win.el.style.top=top+'px';
        };
        const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
        document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
      });
    });
  },

  minimize(win){
    win.minimized=true; win.el.classList.add('min');
    setTimeout(()=>{ if(win.minimized)win.el.style.display='none'; },180);
    if(WM.focused===win){ WM.focused=null; WM._focusNext(); }
    updateDockRunning();
  },
  restore(win){
    win.minimized=false; win.el.style.display='flex';
    setTimeout(()=>win.el.classList.remove('min'),15);
    WM.focus(win);
  },
  toggleMax(win){
    const maxBtn=$('.wbtn.max',win.el);
    win.el.classList.add('win-anim');
    setTimeout(()=>win.el.classList.remove('win-anim'),300);
    if(win.maximized){
      win.maximized=false; win.el.classList.remove('maxd');
      const p=win.prevRect; if(p){win.el.style.left=p.l;win.el.style.top=p.t;win.el.style.width=p.w;win.el.style.height=p.h;}
      if(maxBtn){ maxBtn.innerHTML=WIN_ICONS.max; maxBtn.title='Maximize'; }
      $('#dock-wrap').classList.remove('dock-hide');
      $('#menubar').classList.remove('mbar-hide');
    }else{
      win.prevRect={l:win.el.style.left,t:win.el.style.top,w:win.el.style.width,h:win.el.style.height};
      win.maximized=true; win.el.classList.add('maxd');
      win.el.style.left='0px'; win.el.style.top='0px';
      win.el.style.width=window.innerWidth+'px';
      win.el.style.height=window.innerHeight+'px';
      if(maxBtn){ maxBtn.innerHTML=WIN_ICONS.restore; maxBtn.title='Restore'; }
      $('#dock-wrap').classList.add('dock-hide');
      $('#menubar').classList.add('mbar-hide');
    }
  },
  close(win,silent){
    if(!WM.windows.has(win.id))return;
    if(win.onClose && !silent){ try{win.onClose();}catch(e){} }
    win.el.classList.remove('show');
    setTimeout(()=>{ win.el.remove(); },280);
    WM.windows.delete(win.id);
    if(WM.focused===win){ WM.focused=null; WM._focusNext(); }
    refreshMenuApp(); updateDockRunning();
  },
  _focusNext(){
    let top=null,z=-1;
    WM.windows.forEach(w=>{ if(!w.minimized){ const wz=parseInt(w.el.style.zIndex||0); if(wz>z){z=wz;top=w;} } });
    if(top)WM.focus(top); else { WM.focused=null; refreshMenuApp(); }
  },
  byApp(systemApp){ return [...WM.windows.values()].filter(w=>w.systemApp===systemApp); },
};
/* ===================================================================== */
/* DESKTOP — startup, wallpaper, menu bar, clock                          */
/* ===================================================================== */
function startDesktop(){
  applyWallpaper();
  $('#desktop').style.display='block';
  $('#menubar').style.display='flex';
  $('#dock-wrap').style.display='flex';
  setTimeout(()=>{ $('#desktop').style.opacity='1'; },20);
  BENOS.volume=FS.getMeta('volume',0.8);
  BENOS.muted=!!FS.getMeta('muted',false);
  BENOS.booted=true;
  buildMenuBar();
  applyBrightness();
  renderDesktopIcons();
  buildDock();
  startClock();
  wireDesktopEvents();
  notify('Welcome to BenOS HTML Edition','Logged in as '+BENOS.user,'👋');
  // let the user know if persistent storage isn't available in this context
  if(DB.mode!=='idb'){
    setTimeout(()=>{
      if(DB.mode==='memory') notify('Temporary storage mode','IndexedDB is blocked in this context, so changes won’t be saved after you close BenOS. Open it from http:// (not file://) for full persistence.','⚠️');
      else notify('Compatibility storage','IndexedDB is unavailable, so BenOS is saving your files with localStorage.','💾');
    },1400);
  }
  // fetch the BenMusic library in the background (large files; cached after first run)
  setTimeout(()=>{ try{ downloadMusicAssets(); }catch(e){} }, 2500);
}

/* Resolve a stored wallpaper value to a usable CSS url.
   - "asset:backgrounds:<name>"  -> cached metadata image (data URL)
   - a legacy default URL          -> treated as "use current default"
   - any other string              -> custom URL / data URL
   - null/default                  -> metadata "sierra" background, else local fallback */
async function resolveWallpaper(wp){
  if(wp && typeof wp==='string'){
    if(wp.indexOf('asset:')===0){ const d=await assetData(wp); return d || (await defaultWallpaperURL()); }
    if(!BENOS.oldWallpapers.includes(wp)) return wp;       // a genuine custom wallpaper
  }
  return await defaultWallpaperURL();
}
async function defaultWallpaperURL(){
  const preferred=[
    {dir:'Wallpapers',name:'Ocean Sky.svg'},
    {dir:'Wallpapers',name:'Clear Day.svg'},
    {dir:'Wallpapers',name:'Lemonade.svg'},
    {dir:'Wallpapers',name:'Police Sirens.svg'},
    {dir:'backgrounds',name:'sierra.png'}
  ];
  for(const entry of preferred){
    const data=await assetData(assetKey(entry.dir,entry.name));
    if(data) return data;
  }
  return BENOS.defaultWallpaper || BENOS.fallbackWallpaper;
}
async function applyWallpaper(){
  const desk=$('#desktop');
  const lg=$('#login');
  const url=await resolveWallpaper(FS.getMeta('wallpaper',null));
  applyWallpaperToElement(desk, url);
  applyWallpaperToElement(lg, url);
}

/* ---- menu bar ---- */
function buildMenuBar(){
  refreshMenuApp();
}
function refreshMenuApp(){
  const left=$('#mb-left');
  const appName = WM.focused? WM.focused.appName : 'Finder';
  left.innerHTML='';
  const apple=el('div','mb-item apple','<img src="'+BENOS.logo+'" alt="BenOS" onerror="this.replaceWith(document.createTextNode(\'\'))">');
  apple.onclick=e=>{e.stopPropagation();appleMenu(e.currentTarget.getBoundingClientRect().left, 22);};
  left.appendChild(apple);
  const name=el('div','mb-item bold',esc(appName));
  name.onclick=e=>{e.stopPropagation();appNameMenu(appName,e.currentTarget.getBoundingClientRect().left,22);};
  left.appendChild(name);
  ['File','Edit','View','Window','Help'].forEach(m=>{
    const it=el('div','mb-item',m);
    it.onclick=e=>{e.stopPropagation();genericTopMenu(m,e.currentTarget.getBoundingClientRect().left,22);};
    left.appendChild(it);
  });
}
function appleMenu(x,y){
  showCtx(x,y,[
    {label:'About This BenOS',action:openAbout},
    {sep:true},
    {label:'System Preferences…',action:()=>launchSystemApp('settings')},
    {sep:true},
    {label:'Sleep',action:sleepScreen},
    {label:'Restart…',action:()=>{ confirmAction('Restart BenOS?',restartOS); }},
    {label:'Shut Down…',action:()=>{ confirmAction('Shut down BenOS?',shutdownOS); }},
    {sep:true},
    {label:'Lock Screen',action:lockScreen},
    {label:'Log Out '+BENOS.user+'…',action:()=>{ confirmAction('Log out?',logOut); }},
  ]);
}
function appNameMenu(name,x,y){
  const items=[{label:'About '+name,action:openAbout}];
  if(WM.focused){
    items.push({sep:true});
    items.push({label:'Hide '+name,action:()=>WM.minimize(WM.focused)});
    items.push({label:'Close Window',action:()=>WM.close(WM.focused)});
  }
  items.push({sep:true},{label:'Quit '+name,action:()=>{ if(WM.focused)WM.close(WM.focused); }});
  showCtx(x,y,items);
}
function genericTopMenu(m,x,y){
  const sets={
    File:[{label:'New Finder Window',action:()=>launchSystemApp('files')},{label:'New Folder',action:()=>{quickNewFolder('desktop');}},{sep:true},{label:'Close Window',action:()=>WM.focused&&WM.close(WM.focused),disabled:!WM.focused}],
    Edit:[{label:'Undo',disabled:true},{label:'Redo',disabled:true},{sep:true},{label:'Cut',disabled:true},{label:'Copy',disabled:true},{label:'Paste',disabled:true}],
    View:[{label:'Refresh Desktop',action:renderDesktopIcons},{label:'Sort Icons',action:sortDesktopIcons},{sep:true},{label:'Wallpaper Settings',action:()=>launchSystemApp('settings')}],
    Window:[{label:'Minimize',action:()=>WM.focused&&WM.minimize(WM.focused),disabled:!WM.focused},{label:'Zoom',action:()=>WM.focused&&WM.toggleMax(WM.focused),disabled:!WM.focused},{sep:true}].concat([...WM.windows.values()].map(w=>({label:(w===WM.focused?'✓ ':'   ')+w.appName,action:()=>{w.minimized?WM.restore(w):WM.focus(w);}}))),
    Help:[{label:'BenOS Help',action:()=>showDialog({icon:'❓',title:'BenOS Help',body:'Right-click anywhere for context menus. Press Ctrl+Space for Search. Drag files from your computer onto the desktop to import them.'})}],
  };
  showCtx(x,y,sets[m]||[{label:m,disabled:true}]);
}

/* ---- clock & date ---- */
function startClock(){
  const upd=()=>{
    const d=new Date();
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const t=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    $('#mb-clock').textContent = days[d.getDay()]+' '+(d.getMonth()+1)+'/'+d.getDate()+'  '+t;
  };
  upd(); setInterval(upd,1000);
}

/* ===================================================================== */
/* DESKTOP ICONS — render, position persist, drag, select                 */
/* ===================================================================== */
let deskSel=new Set();
function renderDesktopIcons(){
  const layer=$('#icon-layer'); layer.innerHTML='';
  const items=FS.children('desktop');
  let gx=window.innerWidth-110, gy=14, col=0;
  items.forEach(n=>{
    if(n.dx==null||n.dy==null){ n.dx=gx; n.dy=gy; gy+=104; if(gy>window.innerHeight-180){gy=14;gx-=100;} FS.save(n); }
    layer.appendChild(makeDesktopIcon(n));
  });
}
function makeDesktopIcon(n){
  const d=el('div','desk-icon');
  d.style.left=n.dx+'px'; d.style.top=n.dy+'px';
  d.dataset.id=n.id;
  d.innerHTML='<div class="ic">'+iconHTML(n,54)+'</div><div class="nm">'+esc(n.name)+'</div>';
  d.addEventListener('mousedown',e=>{ if(e.button!==0)return; deskIconDrag(e,d,n); });
  d.addEventListener('dblclick',()=>openNode(n));
  d.addEventListener('click',e=>{e.stopPropagation();selectDesktop(n.id,e.shiftKey||e.metaKey||e.ctrlKey);});
  d.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();selectDesktop(n.id,false);nodeContextMenu(n,e.clientX,e.clientY,'desktop');});
  return d;
}
function selectDesktop(id,add){
  if(!add){ deskSel.clear(); $$('.desk-icon').forEach(x=>x.classList.remove('sel')); }
  deskSel.add(id);
  const elx=$('.desk-icon[data-id="'+id+'"]'); if(elx)elx.classList.add('sel');
}
function deskIconDrag(e,d,n){
  selectDesktop(n.id,e.shiftKey);
  const sx=e.clientX,sy=e.clientY; const ox=n.dx,oy=n.dy; let moved=false; let lx=e.clientX,ly=e.clientY;
  const mv=ev=>{
    lx=ev.clientX; ly=ev.clientY;
    const dx=ev.clientX-sx,dy=ev.clientY-sy;
    if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
    if(moved)d.style.pointerEvents='none';   // so elementFromPoint sees the dock beneath
    d.style.left=Math.max(0,ox+dx)+'px'; d.style.top=Math.max(0,oy+dy)+'px';
  };
  const up=()=>{
    document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
    d.style.pointerEvents='';
    if(moved){
      const over=document.elementFromPoint(lx,ly);
      const dockItem=over&&over.closest?over.closest('.dock-item'):null;
      if(dockItem && dockItem.dataset.id==='trash'){ deleteNode(n); return; }      // drop on Trash
      if(dockItem && over.closest('#dock') && (n.systemApp||n.type==='app'||/\.html?$/i.test(n.name))){ dockAdd(n.id); renderDesktopIcons(); return; } // drop app on Dock
      n.dx=parseFloat(d.style.left); n.dy=parseFloat(d.style.top); FS.save(n);
    }
  };
  document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
}
function sortDesktopIcons(){
  const items=FS.children('desktop').sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):(a.type==='folder'?-1:1));
  let gx=window.innerWidth-110, gy=14;
  items.forEach(n=>{ n.dx=gx;n.dy=gy; gy+=104; if(gy>window.innerHeight-180){gy=14;gx-=100;} FS.save(n); });
  renderDesktopIcons();
}

/* ===================================================================== */
/* DOCK                                                                    */
/* ===================================================================== */
function buildDock(){
  const dock=$('#dock'); dock.innerHTML='';
  const ids=FS.getMeta('dock',[]);
  const size=FS.getMeta('dockSize',52);
  ids.forEach(id=>{
    const n=FS.get(id); if(!n)return;
    dock.appendChild(makeDockItem(n,size));
  });
  // right side: Downloads + Trash (separated from the apps)
  dock.appendChild(el('div','dock-sep'));
  const dl=FS.get('downloads');
  if(dl) dock.appendChild(makeDockItem(dl,size));
  const tr=FS.get('trash');
  if(tr) dock.appendChild(makeTrashItem(size));
  // accept HTML5 drags from the Files app: drop an app here to pin it to the Dock
  dock.ondragover=e=>{ if((e.dataTransfer.types||[]).indexOf('benos/id')>=0){ e.preventDefault(); } };
  dock.ondrop=e=>{
    const id=e.dataTransfer.getData('benos/id'); if(!id)return;
    if(e.target.closest('.dock-item[data-id="trash"]'))return;   // Trash has its own handler
    e.preventDefault(); const n=FS.get(id); if(!n)return;
    if(n.systemApp||n.type==='app'||/\.html?$/i.test(n.name)) dockAdd(id);
    else { notify('Only apps can be pinned','Drag “'+n.name+'” to the Trash to delete it instead','⚠️'); playSound('alert'); }
  };
  updateDockRunning();
}
function makeTrashItem(size){
  const it=el('div','dock-item'); it.dataset.id='trash';
  const full=FS.children('trash').length>0;
  it.style.width=size+'px'; it.style.height=size+'px';
  const fs=Math.round(size*0.5);
  it.innerHTML='<div class="ico trash" style="width:'+size+'px;height:'+size+'px;font-size:'+fs+'px;border-radius:13px"></div><div class="run"></div><div class="tip">Trash'+(full?' ('+FS.children('trash').length+')':' (Empty)')+'</div>';
  it.addEventListener('click',()=>{ bounceDock(it); launchSystemApp('files','trash'); });
  it.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();
    showCtx(e.clientX,e.clientY,[
      {label:'Open',action:()=>launchSystemApp('files','trash')},
      {label:'Empty Trash',action:emptyTrash,disabled:!full},
    ]);
  });
  // drop a file/folder here (from the Files app) to move it to the Trash
  it.addEventListener('dragover',e=>{ if((e.dataTransfer.types||[]).indexOf('benos/id')>=0){ e.preventDefault(); it.classList.add('drop-hot'); } });
  it.addEventListener('dragleave',()=>it.classList.remove('drop-hot'));
  it.addEventListener('drop',e=>{ e.preventDefault(); e.stopPropagation(); it.classList.remove('drop-hot'); const id=e.dataTransfer.getData('benos/id'); if(id){ const n=FS.get(id); if(n)deleteNode(n); } });
  return it;
}
function makeDockItem(n,size){
  const it=el('div','dock-item');
  it.dataset.id=n.id;
  it.style.width=size+'px'; it.style.height=size+'px';
  it.innerHTML=iconHTML(n,size)+'<div class="run"></div><div class="tip">'+esc(n.name.replace(/\.html$/,''))+'</div>';
  $('.ico',it).style.width=size+'px'; $('.ico',it).style.height=size+'px';
  it.addEventListener('click',()=>{ bounceDock(it); openNode(n); });
  it.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();dockContextMenu(n,e.clientX,e.clientY);});
  return it;
}
function bounceDock(it){
  it.animate([{transform:'translateY(0)'},{transform:'translateY(-22px)'},{transform:'translateY(0)'}],{duration:520,easing:'ease-out'});
}

function updateDockRunning(){
  const running=new Set([...WM.windows.values()].map(w=>w.fileId).filter(Boolean));
  $$('.dock-item').forEach(it=>{ it.classList.toggle('running', running.has(it.dataset.id)); });
}
async function dockAdd(id){
  const ids=FS.getMeta('dock',[]); if(ids.includes(id)){return;}
  ids.push(id); await FS.setMeta('dock',ids); buildDock(); notify('Added to Dock',(FS.get(id)||{}).name||'','📌');
}
async function dockRemove(id){
  let ids=FS.getMeta('dock',[]); ids=ids.filter(x=>x!==id); await FS.setMeta('dock',ids); buildDock();
}

/* ===================================================================== */
/* NOTIFICATIONS                                                           */
/* ===================================================================== */
const NOTES=[];
function notify(title,body,icon){
  const t=el('div','toast');
  t.innerHTML='<div class="tic" style="background:rgba(0,0,0,.06)">'+(icon||'🔔')+'</div><div class="tx"><div class="tt">'+esc(title)+'</div><div class="tb">'+esc(body||'')+'</div></div>';
  $('#toast-layer').appendChild(t);
  setTimeout(()=>t.classList.add('show'),15);
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),400); },4200);
  NOTES.unshift({title,body,icon:icon||'🔔',time:now()});
  if(NOTES.length>50)NOTES.pop();
  renderNotifCenter();
  if(BENOS.booted && icon!=='⚠️' && icon!=='💥') playSound('notification');
}
function renderNotifCenter(){
  const list=$('#notif-list');
  if(NOTES.length===0){ list.innerHTML='<div class="nc-empty">No Notifications</div>'; return; }
  list.innerHTML=NOTES.map(n=>'<div class="nc-item"><div class="tt">'+(n.icon)+' '+esc(n.title)+'</div><div class="tb">'+esc(n.body||'')+'</div><div class="tm">'+new Date(n.time).toLocaleTimeString('en-US')+'</div></div>').join('');
}
function toggleNotifCenter(){ $('#notif-center').classList.toggle('open'); }

/* ===================================================================== */
/* SPOTLIGHT SEARCH                                                        */
/* ===================================================================== */
let spotSel=0, spotItems=[];
function openSpotlight(){
  $('#spotlight').style.display='flex';
  const i=$('#spot-input'); i.value=''; $('#spot-results').innerHTML=''; spotItems=[];spotSel=0;
  setTimeout(()=>i.focus(),30);
}
function closeSpotlight(){ $('#spotlight').style.display='none'; }
function spotSearch(q){
  const res=$('#spot-results');
  spotItems = FS.search(q);
  spotSel=0;
  if(!q.trim()){ res.innerHTML=''; return; }
  if(spotItems.length===0){ res.innerHTML='<div class="spot-row">No results</div>'; return; }
  res.innerHTML=spotItems.map((n,i)=>'<div class="spot-row'+(i===0?' sel':'')+'" data-i="'+i+'">'+iconHTML(n,30)+'<div><div>'+esc(n.name)+'</div></div><div class="meta">'+FS.pathOf(n.id)+'</div></div>').join('');
  $$('.spot-row',res).forEach(r=>{ r.onclick=()=>{ const n=spotItems[+r.dataset.i]; closeSpotlight(); openNode(n); }; });
}
function spotMove(d){
  if(!spotItems.length)return;
  spotSel=(spotSel+d+spotItems.length)%spotItems.length;
  $$('.spot-row').forEach((r,i)=>r.classList.toggle('sel',i===spotSel));
}
/* ===================================================================== */
/* CONTEXT MENU ENGINE — generic, supports submenus & separators          */
/* ===================================================================== */
function showCtx(x,y,items){
  const root=$('#ctx-root'); root.innerHTML=''; root.style.display='block';
  const menu=buildCtxMenu(items);
  root.appendChild(menu);
  // position within viewport
  const r=menu.getBoundingClientRect();
  if(x+r.width>window.innerWidth)x=window.innerWidth-r.width-6;
  if(y+r.height>window.innerHeight)y=window.innerHeight-r.height-6;
  menu.style.left=Math.max(2,x)+'px'; menu.style.top=Math.max(24,y)+'px';
}
function buildCtxMenu(items){
  const menu=el('div','ctx-menu');
  items.forEach(it=>{
    if(it.sep){ menu.appendChild(el('div','ctx-sep')); return; }
    const row=el('div','ctx-item'+(it.disabled?' disabled':''));
    row.innerHTML='<span>'+esc(it.label)+'</span>'+(it.submenu?'<span class="arrow">▶</span>':(it.check?'<span class="arrow">✓</span>':''));
    if(it.submenu){
      let sub=null;
      row.addEventListener('mouseenter',()=>{
        $$('.ctx-menu',menu.parentElement).forEach(m=>{if(m!==menu&&m._owner===menu)m.remove();});
        sub=buildCtxMenu(it.submenu); sub._owner=menu; menu.parentElement.appendChild(sub);
        const rr=row.getBoundingClientRect();
        let sx=rr.right-3, sy=rr.top-5;
        const sr=sub.getBoundingClientRect();
        if(sx+sr.width>window.innerWidth)sx=rr.left-sr.width+3;
        sub.style.left=sx+'px'; sub.style.top=sy+'px';
      });
    }else if(!it.disabled){
      row.addEventListener('click',()=>{ hideCtx(); try{ it.action&&it.action(); }catch(e){ benRecoverable(e.message||e); } });
    }else{
      //  "Bonk" when an unavailable option is clicked
      row.addEventListener('click',e=>{ e.stopPropagation(); playSound('alert'); });
    }
    menu.appendChild(row);
  });
  return menu;
}
function hideCtx(){ $('#ctx-root').style.display='none'; $('#ctx-root').innerHTML=''; }

/* ---- per-object context menus (DESKTOP, FILE, FOLDER, APP, DOCK, WINDOW) ---- */
function nodeContextMenu(n,x,y,origin){
  let items;
  if(n.parentId==='trash'){
    // items in the Trash get Put Back / Delete Immediately
    items=[
      {label:'Open',action:()=>openNode(n)},
      {sep:true},
      {label:'Put Back',action:()=>restoreFromTrash(n)},
      {label:'Delete Immediately…',action:()=>deleteForever(n)},
      {sep:true},
      {label:'Get Info',action:()=>showProperties(n)},
    ];
  }
  else if(n.systemApp||n.type==='app') items=appObjectMenu(n);
  else if(n.type==='folder') items=folderMenu(n);
  else items=fileMenu(n);
  showCtx(x,y,items);
}
function fileMenu(n){
  const ext=extOf(n.name).toLowerCase();
  const apps=EXT_APPS[ext]||[{label:'Text Editor',action:()=>openTextEditor(n)}];
  const openWith=apps.map(a=>({label:a.label,action:()=>a.action(n)}));
  return [
    {label:'Open',action:()=>openNode(n)},
    {label:'Open With',submenu:openWith},
    {sep:true},
    {label:'Rename',action:()=>promptRename(n)},
    {label:'Duplicate',action:async()=>{await FS.duplicate(n.id);refreshAfterFS(n.parentId);}},
    {label:'Move to Trash',action:()=>deleteNode(n)},
    {sep:true},
    {label:'Copy',action:()=>{Clip={mode:'copy',ids:[n.id]};}},
    {label:'Cut',action:()=>{Clip={mode:'cut',ids:[n.id]};}},
    {label:'Move To',submenu:moveTargets(n)},
    {sep:true},
    {label:'Edit With Text Editor',action:()=>openTextEditor(n)},
    {label:'Compress "'+n.name+'"',action:()=>compressNode(n)},
    {label:'Create Shortcut',action:()=>createShortcut(n)},
    {sep:true},
    {label:'Get Info',action:()=>showProperties(n)},
  ];
}
function folderMenu(n){
  return [
    {label:'Open',action:()=>openNode(n)},
    {label:'Open in New Window',action:()=>launchSystemApp('files',n.id)},
    {sep:true},
    {label:'New Folder',action:()=>quickNewFolder(n.id)},
    {label:'New File',action:()=>quickNewFile(n.id)},
    {sep:true},
    {label:'Rename',action:()=>promptRename(n)},
    {label:'Duplicate',action:async()=>{await FS.duplicate(n.id);refreshAfterFS(n.parentId);}},
    {label:'Move to Trash',action:()=>deleteNode(n)},
    {sep:true},
    {label:'Copy',action:()=>{Clip={mode:'copy',ids:[n.id]};}},
    {label:'Paste',action:()=>pasteInto(n.id),disabled:!Clip.ids.length},
    {label:'Move To',submenu:moveTargets(n)},
    {sep:true},
    {label:'Sort By',submenu:[{label:'Name'},{label:'Date'},{label:'Size'},{label:'Kind'}].map(s=>({label:s.label,action:()=>{}}))},
    {label:'Compress',action:()=>compressNode(n)},
    {sep:true},
    {label:'Get Info',action:()=>showProperties(n)},
  ];
}
function appObjectMenu(n){
  const inDock=FS.getMeta('dock',[]).includes(n.id);
  return [
    {label:'Open',action:()=>openNode(n)},
    {sep:true},
    inDock?{label:'Remove from Dock',action:()=>dockRemove(n.id)}:{label:'Pin to Dock',action:()=>dockAdd(n.id)},
    {label:'Show in Finder',action:()=>launchSystemApp('files',n.parentId)},
    {sep:true},
    {label:'Rename',action:()=>promptRename(n)},
    {label:'Duplicate',action:async()=>{await FS.duplicate(n.id);refreshAfterFS(n.parentId);}},
    {label:'Move to Trash',action:()=>deleteNode(n)},
    {label:'Move To',submenu:moveTargets(n)},
    {label:'Create Shortcut',action:()=>createShortcut(n)},
    {sep:true},
    {label:'Get Info',action:()=>showProperties(n)},
  ];
}
function dockContextMenu(n,x,y){
  const open=WM.byApp(n.systemApp).length>0 || [...WM.windows.values()].some(w=>w.fileId===n.id);
  showCtx(x,y,[
    {label:'Open',action:()=>openNode(n)},
    open?{label:'Show All Windows',action:()=>{[...WM.windows.values()].filter(w=>w.fileId===n.id).forEach(w=>w.minimized?WM.restore(w):WM.focus(w));}}:{label:'Open',disabled:true},
    {sep:true},
    {label:'Remove from Dock',action:()=>dockRemove(n.id)},
    {label:'Show in Finder',action:()=>launchSystemApp('files',n.parentId)},
    {sep:true},
    {label:'Get Info',action:()=>showProperties(n)},
  ]);
}
function windowMenu(win,x,y){
  showCtx(x,y,[
    {label:'Minimize',action:()=>WM.minimize(win)},
    {label:win.maximized?'Restore':'Maximize',action:()=>WM.toggleMax(win)},
    {label:'Close',action:()=>WM.close(win)},
    {sep:true},
    {label:(win.alwaysTop?'✓ ':'')+'Always on Top',action:()=>{win.alwaysTop=!win.alwaysTop;win.el.style.zIndex=win.alwaysTop?5000:++WM.zTop;}},
  ]);
}
function desktopMenu(x,y){
  showCtx(x,y,[
    {label:'New Folder',action:()=>quickNewFolder('desktop')},
    {label:'New File',action:()=>quickNewFile('desktop')},
    {sep:true},
    {label:'Paste',action:()=>pasteInto('desktop'),disabled:!Clip.ids.length},
    {label:'Refresh',action:renderDesktopIcons},
    {sep:true},
    {label:'Sort Icons',action:sortDesktopIcons},
    {label:'View Options',action:()=>showDialog({icon:'⚙️',title:'View Options',body:'Desktop icons are sized at 54px. Drag to rearrange — positions are saved automatically.'})},
    {sep:true},
    {label:'Change Wallpaper…',action:()=>launchSystemApp('settings')},
  ]);
}
/* helper: list of folders to "Move To" */
function moveTargets(n){
  const folders=[...FS.nodes.values()].filter(f=>f.type==='folder'&&f.id!==n.id&&f.id!==n.parentId);
  return folders.slice(0,18).map(f=>({label:FS.pathOf(f.id),action:async()=>{await FS.move(n.id,f.id);refreshAfterFS(n.parentId);refreshAfterFS(f.id);}}));
}

/* ===================================================================== */
/* CLIPBOARD + shared file operations                                     */
/* ===================================================================== */
let Clip={mode:null,ids:[]};
async function pasteInto(pid){
  if(!Clip.ids.length)return;
  for(const id of Clip.ids){
    if(Clip.mode==='cut')await FS.move(id,pid);
    else await FS.duplicate(id,pid);
  }
  if(Clip.mode==='cut')Clip={mode:null,ids:[]};
  refreshAfterFS(pid);
}
async function quickNewFolder(pid){ const f=await FS.createFolder(pid,'untitled folder'); refreshAfterFS(pid); promptRename(f); }
async function quickNewFile(pid){ const f=await FS.createFile(pid,'untitled.txt',''); refreshAfterFS(pid); promptRename(f); }
function promptRename(n){
  promptText('Rename','Enter a new name for "'+n.name+'":', n.name, false, async(v)=>{
    v=(v||'').trim(); if(v){ await FS.rename(n.id,v); refreshAfterFS(n.parentId); }
  });
}
/* Move an item to the Trash (recoverable). System apps cannot be trashed. */
async function deleteNode(n){
  if(n.id==='trash'||n.parentId==='trash'){ return; }
  if(n.systemApp){ // protect built-in apps
    showDialog({icon:'⚠️',title:'Can’t Move to Trash',body:'“'+n.name+'” is a system application and can’t be deleted.'}); playSound('alert'); return;
  }
  const pid=n.parentId;
  n.trashedFrom = pid; n.trashedAt = now();
  await FS.move(n.id,'trash');
  refreshAfterFS(pid); refreshAfterFS('trash');
  notify('Moved to Trash', n.name, '🗑');
}
/* permanently delete (used inside the Trash) */
async function deleteForever(n){
  showDialog({icon:'🗑',title:'Delete Immediately',body:'Permanently delete “'+n.name+'”? This cannot be undone.',buttons:[
    {label:'Cancel'},
    {label:'Delete',primary:true,onClick:async()=>{ await FS.remove(n.id); refreshAfterFS('trash'); notify('Deleted', n.name+' was permanently removed','🗑'); }}
  ]});
}
/* restore a trashed item to where it came from */
async function restoreFromTrash(n){
  const dest = (n.trashedFrom && FS.get(n.trashedFrom)) ? n.trashedFrom : 'desktop';
  await FS.move(n.id, dest);
  refreshAfterFS('trash'); refreshAfterFS(dest);
  notify('Restored', n.name+' put back', '↩️');
}
function emptyTrash(){
  const items=FS.children('trash');
  if(!items.length){ playSound('alert'); notify('Trash is empty','Nothing to remove','🗑'); return; }
  showDialog({icon:'🗑',title:'Empty Trash',body:'Permanently erase '+items.length+' item'+(items.length>1?'s':'')+'? This cannot be undone.',buttons:[
    {label:'Cancel'},
    {label:'Empty Trash',primary:true,onClick:async()=>{ for(const c of items){ await FS.remove(c.id); } refreshAfterFS('trash'); notify('Trash emptied',items.length+' item'+(items.length>1?'s':'')+' removed','🗑'); }}
  ]});
}
async function createShortcut(n){
  const s=await FS.createFile(n.parentId, n.name.replace(/(\.\w+)?$/,' alias$1'), '', n.kind);
  s.systemApp=n.systemApp; s.content=n.content; s.kind=n.kind; s.type=n.type; await FS.save(s);
  refreshAfterFS(n.parentId); notify('Shortcut created',s.name,'🔗');
}
async function compressNode(n){
  const zip=await FS.createFile(n.parentId, n.name+'.zip','[Compressed archive of '+n.name+']','zip');
  zip.size=Math.max(1024,Math.round(sizeOf(n)*0.6)); await FS.save(zip);
  refreshAfterFS(n.parentId); notify('Compressed',n.name+' → '+zip.name,'🗜');
}
function showProperties(n){
  const childCount = n.type==='folder'?FS.children(n.id).length:null;
  showDialog({icon:iconHTML(n,46).replace(/class="ico[^"]*"/,'class="ico"'),title:n.name,body:''});
  // build a richer custom dialog
  const d=$$('.dialog').pop();
  $('p',d).remove();
  const rows=[
    ['Kind', n.systemApp?'Application':(n.type==='folder'?'Folder':n.kind.toUpperCase()+' file')],
    ['Size', n.type==='folder'?(childCount+' items'):fmtSize(sizeOf(n))],
    ['Where', FS.pathOf(n.parentId)],
    ['Created', fmtDate(n.created)],
    ['Modified', fmtDate(n.modified)],
  ];
  const tbl=el('div'); tbl.style.cssText='text-align:left;font-size:12px;margin:4px 0 14px;';
  tbl.innerHTML=rows.map(r=>'<div style="display:flex;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px solid #e4e4e6"><b style="color:#666">'+r[0]+'</b><span style="text-align:right">'+esc(r[1])+'</span></div>').join('');
  $('h3',d).after(tbl);
}
function refreshAfterFS(pid){
  if(pid==='desktop'||pid==null) renderDesktopIcons();
  // refresh any open Files windows showing this folder
  [...WM.windows.values()].forEach(w=>{ if(w.systemApp==='files'&&w.refresh)w.refresh(); });
  buildDock();
}

/* ===================================================================== */
/* APPLICATION ENGINE — open nodes & launch apps                          */
/* ===================================================================== */
function openNode(n){
  if(!n)return;
  if(n.systemApp){ launchSystemApp(n.systemApp, null, n.id); return; }
  if(n.type==='folder'){ launchSystemApp('files', n.id); return; }
  if(n.type==='app'||n.kind==='app'||extOf(n.name)==='html'||extOf(n.name)==='htm'){ launchHTMLApp(n); return; }
  if(n.kind==='image'){ openImageViewer(n); return; }
  if(n.kind==='audio'){ launchSystemApp('music', null, null, n); return; }
  if(n.kind==='video'){ openVideoViewer(n); return; }
  if(n.kind==='pdf'){ openTextEditor(n); return; }
  // default: text editor
  openTextEditor(n);
}

/* launch a built-in system application (native, privileged FS access) */
function launchSystemApp(key, arg, fileId, extra){
  const meta=SYSTEM_APPS[key]; if(!meta)return;
  fileId = fileId || ('app-'+key);
  // settings/single-instance behavior: focus existing if present
  const existing = WM.byApp(key)[0];
  if(existing && key!=='files'){ existing.minimized?WM.restore(existing):WM.focus(existing); return existing; }
  const win=WM.create({title:meta.name, systemApp:key, fileId,
    width:key==='terminal'?660:(key==='browser'?900:(key==='studios'?920:760)),
    height:key==='terminal'?420:(key==='health'?540:(key==='studios'?580:520))});
  try{
    if(key==='files') buildFilesApp(win, arg||'desktop');
    else if(key==='settings') buildSettingsApp(win);
    else if(key==='browser') buildBrowserApp(win);
    else if(key==='music') buildMusicApp(win, extra);
    else if(key==='health') buildHealthApp(win);
    else if(key==='studios') buildStudiosApp(win, extra);
    else if(key==='terminal') buildTerminalApp(win);
    else if(key==='pen') buildPenApp(win);
    else if(key==='benviewer') buildImageViewerApp(win, extra);
  }catch(e){ appCrash(win, e.message||e); }
  updateDockRunning();
  return win;
}

/* launch a user HTML file as a sandboxed application with crash bridge */
function launchHTMLApp(n){
  const win=WM.create({title:n.name.replace(/\.html?$/,''), fileId:n.id, width:720,height:480});
  const bridge =
    '<script>(function(){'+
    'window.onerror=function(m){parent.postMessage({__benos:1,type:"crash",msg:m},"*");return true;};'+
    'window.addEventListener("unhandledrejection",function(e){parent.postMessage({__benos:1,type:"crash",msg:(e.reason&&e.reason.message)||String(e.reason)},"*");});'+
    '})();<\/script>';
  const html=(n.content||'').includes('<html')? (n.content) : ('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,sans-serif;margin:0">'+(n.content||'<p style=padding:20px>Empty application.</p>')+'</body></html>');
  const iframe=el('iframe');
  iframe.setAttribute('sandbox','allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-fullscreen');
  iframe.srcdoc=bridge+html;
  win.body.appendChild(iframe);
  // crash bridge listener (per window)
  win._msg=(ev)=>{ if(ev.source===iframe.contentWindow && ev.data&&ev.data.__benos&&ev.data.type==='crash'){ appCrash(win, ev.data.msg); window.removeEventListener('message',win._msg); } };
  window.addEventListener('message',win._msg);
  const oldClose=win.onClose; win.onClose=()=>{ window.removeEventListener('message',win._msg); if(oldClose)oldClose(); };
  return win;
}

/* simple built-in viewers/editors */
function openTextEditor(n){
  const win=WM.create({title:n.name+' — TextEdit', fileId:n.id, systemApp:'texteditor', width:560,height:440});
  win.appName='TextEdit';
  const ta=el('textarea');
  ta.style.cssText='width:100%;height:100%;border:none;outline:none;resize:none;padding:16px;font-family:Menlo,monospace;font-size:13px;line-height:1.5;background:#fff;';
  ta.value = typeof n.content==='string'&&!n.content.startsWith('data:')? n.content : (n.kind==='pdf'?'[PDF document — preview not available]\n\n'+n.name : '[Binary file]');
  win.body.appendChild(ta);
  const bar=el('div'); bar.style.cssText='position:absolute;bottom:0;left:0;right:0;display:flex;gap:8px;justify-content:flex-end;padding:7px 10px;background:#f3f3f5;border-top:1px solid #ddd;';
  win.body.style.paddingBottom='0';
  ta.style.height='calc(100% - 42px)';
  const save=el('button','tbtn','Save'); const saveas=el('button','tbtn','Save As…');
  save.onclick=win.guard(async()=>{ n.content=ta.value; n.size=ta.value.length; await FS.save(n); notify('Saved',n.name,'💾'); });
  saveas.onclick=win.guard(()=>{
    filePicker({mode:'save',title:'Save As',filter:['.txt'],defName:'copy of '+n.name,startFolder:n.parentId,onSelect:async r=>{
      const f=await FS.createFile(r.folder,FS.uniqueName(r.folder,r.name),ta.value);
      refreshAfterFS(n.parentId); notify('Saved',f.name,'💾');
    }});
  });
  bar.appendChild(saveas); bar.appendChild(save);
  win.body.appendChild(bar);
}
function openImageViewer(n){
  launchSystemApp('benviewer', null, null, n);
}
function openVideoViewer(n){
  const win=WM.create({title:n.name,fileId:n.id,systemApp:'player',width:640,height:420});
  win.body.style.background='#000';
  win.body.innerHTML='<video src="'+(n.content||'')+'" controls style="width:100%;height:100%;background:#000"></video>';
}
function openAbout(){
  const s=FS.stats();
  showDialog({icon:'<img src="'+BENOS.logo+'" style="width:46px;height:46px;border-radius:10px;vertical-align:middle">',title:'BenOS HTML Edition',body:'Version '+BENOS.version+' (Build '+BENOS.build+')\n\nUser: '+BENOS.user+'\nFiles: '+s.files+'   Folders: '+s.folders+'\nStorage used: '+fmtSize(s.bytes)+'\n\nA single-file operating system for the browser.\nHTML · CSS · JavaScript — no frameworks.'});
}

/* ===================================================================== */
/* SYSTEM POWER ACTIONS                                                    */
/* ===================================================================== */
function confirmAction(msg,fn){ showDialog({icon:'⚠️',title:msg,buttons:[{label:'Cancel'},{label:'OK',primary:true,onClick:fn}]}); }
function logOut(){
  [...WM.windows.values()].forEach(w=>WM.close(w,true));
  $('#desktop').style.opacity='0';$('#menubar').style.display='none';$('#dock-wrap').style.display='none';
  setTimeout(()=>{ $('#desktop').style.display='none'; showLogin(); },600);
}
function restartOS(){
  [...WM.windows.values()].forEach(w=>WM.close(w,true));
  BENOS.booted=false;
  $('#desktop').style.display='none';$('#menubar').style.display='none';$('#dock-wrap').style.display='none';
  runBoot();
}
function shutdownOS(){
  [...WM.windows.values()].forEach(w=>WM.close(w,true));
  document.body.innerHTML='<div style="position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;color:#444;font-size:20px">BenOS HTML Edition is now off. <span style=margin-left:8px;cursor:pointer;color:#888 onclick="location.reload()">⟳ Power On</span></div>';
}
function sleepScreen(){
  const o=el('div'); o.style.cssText='position:fixed;inset:0;background:#000;z-index:9400;transition:opacity .6s;opacity:0;';
  document.body.appendChild(o); setTimeout(()=>o.style.opacity='1',15);
  o.onclick=()=>{ o.style.opacity='0'; setTimeout(()=>o.remove(),600); };
}
function lockScreen(){ showLogin(); $('#login').style.opacity='1'; $('#login').style.display='flex'; }
/* ===================================================================== */
/* DESKTOP EVENTS — global wiring                                          */
/* ===================================================================== */
function wireDesktopEvents(){
  // dismiss menus on click anywhere
  document.addEventListener('mousedown',e=>{
    if(!e.target.closest('.ctx-menu')) hideCtx();
    if(!e.target.closest('#notif-center')&&!e.target.closest('#mb-notif')&&$('#notif-center').classList.contains('open')) $('#notif-center').classList.remove('open');
    if(!e.target.closest('.desk-icon')&&!e.target.closest('.window')&&e.target.closest('#desktop')){ deskSel.clear(); $$('.desk-icon').forEach(x=>x.classList.remove('sel')); }
  });
  // desktop right-click
  $('#icon-layer').addEventListener('contextmenu',e=>{ if(e.target.closest('.desk-icon'))return; e.preventDefault(); desktopMenu(e.clientX,e.clientY); });
  $('#desktop').addEventListener('contextmenu',e=>{ if(e.target.closest('.window')||e.target.closest('.desk-icon'))return; e.preventDefault(); desktopMenu(e.clientX,e.clientY); });
  document.addEventListener('contextmenu',e=>{ if(e.target.closest('#menubar')||e.target.closest('#dock')) e.preventDefault(); });

  // menu bar right side
  $('#mb-spot').onclick=openSpotlight;
  $('#mb-notif').onclick=toggleNotifCenter;
  $('#nc-clear').onclick=()=>{ NOTES.length=0; renderNotifCenter(); };
  $('#mb-wifi').onclick=openWifiPanel;
  $('#mb-control').onclick=openControlCenter;

  // spotlight input
  $('#spot-input').addEventListener('input',e=>spotSearch(e.target.value));
  $('#spotlight').addEventListener('mousedown',e=>{ if(e.target.id==='spotlight')closeSpotlight(); });

  // global keyboard
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey && e.code==='Space'){ e.preventDefault(); $('#spotlight').style.display==='flex'?closeSpotlight():openSpotlight(); return; }
    if(e.key==='Escape'){ hideCtx(); if($('#spotlight').style.display==='flex')closeSpotlight(); }
    if($('#spotlight').style.display==='flex'){
      if(e.key==='ArrowDown'){e.preventDefault();spotMove(1);}
      if(e.key==='ArrowUp'){e.preventDefault();spotMove(-1);}
      if(e.key==='Enter'){ const n=spotItems[spotSel]; if(n){closeSpotlight();openNode(n);} }
    }
    if((e.metaKey||e.ctrlKey)&&e.key==='w'&&WM.focused){ e.preventDefault(); WM.close(WM.focused); }
  });

  // ---- drag & drop import from the real computer ----
  const dz=$('#desktop');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';}));
  dz.addEventListener('drop',async e=>{
    e.preventDefault();
    if(e.target.closest('.window'))return; // windows handle their own
    if(!e.dataTransfer.files||!e.dataTransfer.files.length)return;
    await importFiles(e.dataTransfer.files,'desktop');
  });

  window.addEventListener('resize',()=>{ [...WM.windows.values()].forEach(w=>{ if(w.maximized){w.el.style.width=window.innerWidth+'px';w.el.style.height=window.innerHeight+'px';} }); });

  let edgeTimer=null;
  document.addEventListener('mousemove',e=>{
    const anyMax=[...WM.windows.values()].some(w=>w.maximized);
    if(!anyMax)return;
    if(edgeTimer)clearTimeout(edgeTimer);
    if(e.clientY<3){
      $('#menubar').classList.remove('mbar-hide');
    }else if(e.clientY>window.innerHeight-8){
      $('#dock-wrap').classList.remove('dock-hide');
    }
    edgeTimer=setTimeout(()=>{
      const anyMax2=[...WM.windows.values()].some(w=>w.maximized);
      if(!anyMax2)return;
      if(e.clientY>=3&&e.clientY<=window.innerHeight-8){
        $('#menubar').classList.add('mbar-hide');
        $('#dock-wrap').classList.add('dock-hide');
      }
    },1500);
  });
}

/* import a FileList into a target folder, persisting permanently */
async function importFiles(fileList, parentId){
  let count=0;
  for(const f of fileList){
    try{
      const kind=kindFromName(f.name,f.type);
      const asText = kind==='txt' && f.size<512000;
      const content = await readFileAs(f, asText?'text':'dataURL');
      const n=await FS.createFile(parentId, f.name, content, kind);
      n.size=f.size; n.mime=f.type; await FS.save(n);
      count++;
    }catch(err){ benRecoverable('Import failed: '+(err.message||err)); }
  }
  refreshAfterFS(parentId);
  if(count) notify('Files imported', count+' file'+(count>1?'s':'')+' added to '+FS.pathOf(parentId),'📥');
}
function readFileAs(file,mode){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=()=>rej(r.error||new Error('read error'));
    if(mode==='text')r.readAsText(file); else r.readAsDataURL(file);
  });
}

/* ===================================================================== */
/* AUDIO SYSTEM — global volume manager                                    */
/* ===================================================================== */
const Audio$={
  elements:new Set(),
  register(a){ Audio$.elements.add(a); a.volume=BENOS.muted?0:BENOS.volume; },
  setVolume(v){ BENOS.volume=Math.max(0,Math.min(1,v)); BENOS.muted=false; Audio$.apply(); FS.setMeta('volume',BENOS.volume); FS.setMeta('muted',false); },
  toggleMute(){ BENOS.muted=!BENOS.muted; Audio$.apply(); FS.setMeta('muted',BENOS.muted); },
  apply(){ Audio$.elements.forEach(a=>{ try{a.volume=BENOS.muted?0:BENOS.volume;}catch(e){} }); },
};
/* ===================================================================== */
/* PREINSTALLED APP — FILES (Finder-style file manager)                    */
/* ===================================================================== */
function buildFilesApp(win, startId){
  win.appName='Files';
  let cwd=startId||'desktop';
  let view=FS.getMeta('filesView','icon');
  const history=[cwd]; let hpos=0;
  const root=el('div','flexcol'); win.body.appendChild(root);
  root.innerHTML=
    '<div class="toolbar">'+
      '<button class="tbtn icon" data-a="back">◀</button>'+
      '<button class="tbtn icon" data-a="fwd">▶</button>'+
      '<div style="flex:1;display:flex;align-items:center;gap:6px">'+
        '<button class="tbtn icon" data-a="up">⤴</button>'+
        '<span id="fpath" style="font-size:12px;color:#555;font-weight:600"></span>'+
      '</div>'+
      '<span id="fempty" style="display:none"><button class="tbtn" data-a="empty" style="color:#c44;font-weight:600">Empty Trash</button></span>'+
      '<button class="tbtn icon" data-a="iview" title="Icon view">▦</button>'+
      '<button class="tbtn icon" data-a="lview" title="List view">☰</button>'+
      '<input id="fsearch" placeholder="Search" style="width:120px;padding:5px 9px;border:1px solid #ccc;border-radius:13px;font-size:12px;outline:none">'+
    '</div>'+
    '<div style="flex:1;display:flex;min-height:0">'+
      '<div id="fsidebar" style="width:160px;flex:0 0 160px;background:#ededf0;border-right:1px solid #d7d7da;overflow:auto;padding:10px 8px;font-size:13px"></div>'+
      '<div id="fmain" style="flex:1;overflow:auto;position:relative;background:#fff"></div>'+
    '</div>'+
    '<div style="flex:0 0 auto;padding:4px 12px;background:#f3f3f5;border-top:1px solid #ddd;font-size:11px;color:#777" id="fstatus"></div>';

  const main=$('#fmain',root), pathEl=$('#fpath',root), status=$('#fstatus',root), sidebar=$('#fsidebar',root);

  function buildSidebar(){
    const favs=[['desktop','🖥','Desktop'],['documents','📄','Documents'],['downloads','⤓','Downloads'],['applications','📦','Applications'],['pictures','🖼','Pictures'],['music-folder','🎵','Music'],['trash','🗑','Trash'],['root','💽','Internal Disk']];
    sidebar.innerHTML='<div style="font-size:11px;color:#999;font-weight:700;margin:2px 4px 6px">FAVORITES</div>'+
      favs.map(f=>'<div class="fav" data-id="'+f[0]+'" style="display:flex;gap:8px;padding:5px 8px;border-radius:6px;cursor:default;align-items:center'+(f[0]===cwd?';background:#d3d8e0':'')+'"><span>'+f[1]+'</span><span>'+f[2]+'</span></div>').join('');
    $$('.fav',sidebar).forEach(f=>f.onclick=win.guard(()=>navigate(f.dataset.id)));
  }

  function navigate(id,noHist){
    cwd=id;
    if(!noHist){ history.splice(hpos+1); history.push(id); hpos=history.length-1; }
    render();
  }
  win.refresh=()=>render();

  function render(){
    const folder=FS.get(cwd)||FS.get('desktop');
    cwd=folder.id;
    pathEl.textContent=FS.pathOf(cwd)==='/'?'Internal Disk':FS.pathOf(cwd);
    const emptyBtn=$('#fempty',root);
    emptyBtn.style.display=cwd==='trash'?'':'none';
    buildSidebar();
    let items=FS.children(cwd).sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):(a.type==='folder'?-1:1));
    const q=$('#fsearch',root).value.trim().toLowerCase();
    if(q)items=FS.search(q);
    main.innerHTML='';
    if(view==='icon'){
      const grid=el('div'); grid.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:14px;align-content:flex-start';
      items.forEach(n=>grid.appendChild(fileTile(n)));
      if(!items.length)grid.innerHTML='<div style="color:#aaa;padding:30px;width:100%;text-align:center">This folder is empty</div>';
      main.appendChild(grid);
    }else{
      const list=el('div');
      list.innerHTML='<div style="display:flex;font-size:11px;color:#888;font-weight:700;padding:6px 12px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fafafa"><div style="flex:1">Name</div><div style="width:90px">Size</div><div style="width:150px">Modified</div></div>';
      items.forEach(n=>{
        const r=el('div');
        r.style.cssText='display:flex;align-items:center;padding:5px 12px;border-bottom:1px solid #f3f3f3;font-size:13px;cursor:default';
        r.innerHTML='<div style="flex:1;display:flex;gap:9px;align-items:center">'+iconHTML(n,22)+'<span>'+esc(n.name)+'</span></div><div style="width:90px;color:#888">'+(n.type==='folder'?'--':fmtSize(sizeOf(n)))+'</div><div style="width:150px;color:#888">'+fmtDate(n.modified)+'</div>';
        r.onmouseenter=()=>r.style.background='#f0f4fb'; r.onmouseleave=()=>r.style.background='';
        r.ondblclick=win.guard(()=>{ n.type==='folder'?navigate(n.id):openNode(n); });
        r.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();nodeContextMenu(n,e.clientX,e.clientY,'files');};
        r.setAttribute('draggable','true');
        r.addEventListener('dragstart',e=>{ e.dataTransfer.setData('benos/id',n.id); });
        if(n.type==='folder'){
          r.setAttribute('data-folder-id',n.id);
          r.addEventListener('dragover',e=>{ e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect='move'; r.style.background='#d0d8e8'; });
          r.addEventListener('dragleave',()=>{ r.style.background=''; });
          r.addEventListener('drop',win.guard(async e=>{
            e.preventDefault(); e.stopPropagation(); r.style.background='';
            const id=e.dataTransfer.getData('benos/id');
            if(id && id!==n.id){ await FS.move(id,n.id); render(); refreshAfterFS('desktop'); }
          }));
        }
        list.appendChild(r);
      });
      if(!items.length)list.innerHTML+='<div style="color:#aaa;padding:30px;text-align:center">This folder is empty</div>';
      main.appendChild(list);
    }
    const s=FS.children(cwd);
    status.textContent=s.length+' items'+(Clip.ids.length?'  ·  '+Clip.ids.length+' in clipboard':'');
  }

  function fileTile(n){
    const t=el('div'); t.style.cssText='width:96px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:8px;cursor:default;text-align:center';
    t.innerHTML='<div>'+iconHTML(n,52)+'</div><div style="font-size:12px;word-break:break-word;line-height:14px;max-width:92px">'+esc(n.name)+'</div>';
    t.onmouseenter=()=>t.style.background='#eef3fc'; t.onmouseleave=()=>t.style.background='';
    t.ondblclick=win.guard(()=>{ n.type==='folder'?navigate(n.id):openNode(n); });
    t.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();nodeContextMenu(n,e.clientX,e.clientY,'files');};
    t.setAttribute('draggable','true');
    t.addEventListener('dragstart',e=>{ e.dataTransfer.setData('benos/id',n.id); });
    if(n.type==='folder'){
      t.setAttribute('data-folder-id',n.id);
      t.addEventListener('dragover',e=>{ e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect='move'; t.style.background='#d0d8e8'; });
      t.addEventListener('dragleave',()=>{ t.style.background=''; });
      t.addEventListener('drop',win.guard(async e=>{
        e.preventDefault(); e.stopPropagation(); t.style.background='';
        const id=e.dataTransfer.getData('benos/id');
        if(id && id!==n.id){ await FS.move(id,n.id); render(); refreshAfterFS('desktop'); }
      }));
    }
    return t;
  }

  // toolbar actions
  $$('[data-a]',root).forEach(b=>b.onclick=win.guard(()=>{
    const a=b.dataset.a;
    if(a==='back'&&hpos>0){hpos--;navigate(history[hpos],true);}
    else if(a==='fwd'&&hpos<history.length-1){hpos++;navigate(history[hpos],true);}
    else if(a==='up'){ const p=FS.get(cwd); if(p&&p.parentId)navigate(p.parentId); }
    else if(a==='iview'){ view='icon'; FS.setMeta('filesView','icon'); render(); }
    else if(a==='lview'){ view='list'; FS.setMeta('filesView','list'); render(); }
    else if(a==='empty'){ emptyTrash(); render(); }
  }));
  $('#fsearch',root).addEventListener('input',()=>render());

  // empty-area context menu (paste / new)
  main.addEventListener('contextmenu',e=>{ if(e.target.closest('[draggable]')||e.target.closest('[style*="cursor:default"]'))return; });
  main.addEventListener('contextmenu',e=>{
    if(e.target!==main && !e.target.closest('#fmain'))return;
    if(e.target.closest('div[draggable]'))return;
    // only when clicking blank space
    let blank=true; let p=e.target; while(p&&p!==main){ if(p.getAttribute&&p.getAttribute('draggable')){blank=false;break;} p=p.parentElement; }
    if(!blank)return;
    e.preventDefault();e.stopPropagation();
    showCtx(e.clientX,e.clientY,[
      {label:'New Folder',action:()=>quickNewFolder(cwd)},
      {label:'New File',action:()=>quickNewFile(cwd)},
      {sep:true},
      {label:'Paste',action:()=>pasteInto(cwd),disabled:!Clip.ids.length},
      {label:'Import from Computer…',action:()=>pickFiles(cwd)},
      {sep:true},
      {label:'Get Info',action:()=>showProperties(FS.get(cwd))},
    ]);
  });

  // drag&drop: internal move + external import
  main.addEventListener('dragover',e=>{ e.preventDefault();e.dataTransfer.dropEffect='copy'; });
  main.addEventListener('drop',win.guard(async e=>{
    e.preventDefault();
    const folderTile=e.target.closest('[data-folder-id]');
    if(folderTile)return;
    const innerId=e.dataTransfer.getData('benos/id');
    if(innerId){ await FS.move(innerId,cwd); render(); refreshAfterFS('desktop'); return; }
    if(e.dataTransfer.files&&e.dataTransfer.files.length){ await importFiles(e.dataTransfer.files,cwd); render(); }
  }));

  render();
}
function pickFiles(parentId){
  const inp=el('input'); inp.type='file'; inp.multiple=true;
  inp.onchange=()=>{ if(inp.files.length)importFiles(inp.files,parentId); };
  inp.click();
}
/* ===================================================================== */
/* PREINSTALLED APP — SETTINGS                                             */
/* ===================================================================== */
function buildSettingsApp(win){
  win.appName='Settings';
  const root=el('div','flexcol'); win.body.appendChild(root);
  root.style.flexDirection='row';
  const tabs=['Wallpaper','Dock','Users','Storage','System'];
  let active='Wallpaper';
  root.innerHTML='<div id="setnav" style="width:170px;flex:0 0 170px;background:#ededf0;border-right:1px solid #d7d7da;padding:12px 8px"></div><div id="setbody" style="flex:1;overflow:auto;padding:22px 26px"></div>';
  const nav=$('#setnav',root), body=$('#setbody',root);
  const icons={Wallpaper:'🖼',Dock:'⭐',Users:'👤',Storage:'💾',System:'💻'};
  function renderNav(){
    nav.innerHTML=tabs.map(t=>'<div class="snav" data-t="'+t+'" style="display:flex;gap:9px;padding:8px 10px;border-radius:7px;cursor:default;font-size:13px;align-items:center'+(t===active?';background:var(--accent);color:#fff':'')+'"><span>'+icons[t]+'</span>'+t+'</div>').join('');
    $$('.snav',nav).forEach(s=>s.onclick=win.guard(()=>{active=s.dataset.t;renderNav();renderBody();}));
  }
  function card(title,inner){ return '<div class="set-card" style="background:#fff;border:1px solid #e3e3e6;border-radius:10px;padding:18px;margin-bottom:16px"><h3 style="font-size:14px;margin-bottom:12px">'+title+'</h3>'+inner+'</div>'; }
  function renderBody(){
    body.classList.remove('set-fade-in'); void body.offsetWidth; body.classList.add('set-fade-in');
    if(active==='Wallpaper')renderWall();
    else if(active==='Dock')renderDock();
    else if(active==='Users')renderUsers();
    else if(active==='Storage')renderStorage();
    else renderSystem();
  }
  async function renderWall(){
    const cur=FS.getMeta('wallpaper',null);
    const bgs=getWallpaperEntries();
    const hasOcean=bgs.some(f=>f.name==='Ocean Sky.svg' && (f.dir||'backgrounds')==='Wallpapers');
    const effective=cur||(hasOcean?assetKey('Wallpapers','Ocean Sky.svg'):null);
    let tiles;
    if(bgs.length){
      tiles=bgs.map(f=>{ const ref=assetKey(f.dir||'backgrounds',f.name); const sel=(effective===ref); const label=f.name.replace(/\.\w+$/,'');
        return '<div class="wp" data-ref="'+ref+'" title="'+esc(label)+'" style="width:132px;height:82px;border-radius:8px;background:#cfd6e0;background-size:cover;background-position:center;cursor:pointer;position:relative;border:3px solid '+(sel?'var(--accent)':'transparent')+'"><span style="position:absolute;left:0;right:0;bottom:0;font-size:10px;text-align:center;background:rgba(0,0,0,.45);color:#fff;border-radius:0 0 4px 4px;text-transform:capitalize">'+esc(label)+'</span></div>'; }).join('');
    }else{
      tiles='<div style="font-size:12px;color:#999;line-height:1.6">No wallpaper packs are downloaded yet. They come from the BenOS metadata server on boot — if it was offline, reboot while connected, or paste a custom image URL below.</div>';
    }
    body.innerHTML=card('Desktop Wallpaper <span style="font-size:11px;color:#999;font-weight:400">— from BenOS metadata</span>',
      '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px" id="wpgrid">'+tiles+'</div>'+
      '<div style="display:flex;gap:8px;margin-top:10px"><input id="wpurl" placeholder="Paste image URL…" style="flex:1;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:12px"><button class="tbtn" id="wpset">Set</button><button class="tbtn" id="wpreset">Reset to Default (Ocean Sky)</button></div>')
      +(function(){ const sw=screen.width||window.innerWidth||1920, sh=screen.height||window.innerHeight||1080; return card('Preview <span style="font-size:11px;color:#999;font-weight:400">— '+sw+' × '+sh+' (monitor)</span>',
        '<div style="display:flex;justify-content:center"><div style="width:260px;aspect-ratio:'+sw+' / '+sh+';max-height:200px;border:6px solid #2a2a2e;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);overflow:hidden;background:#000"><div id="wppreview" style="width:100%;height:100%;background:#cfd6e0;background-size:cover;background-position:center"></div></div></div>'); })();
    // fill thumbnails + preview from the cached binaries
    for(const f of bgs){ const ref=assetKey(f.dir||'backgrounds',f.name); const d=await assetData(ref); if(d){ const t=body.querySelector('.wp[data-ref="'+ref+'"]'); if(t)t.style.backgroundImage=wallpaperCssValue(d); } }
    resolveWallpaper(effective).then(u=>{ const p=$('#wppreview',body); if(p)p.style.backgroundImage=wallpaperCssValue(u); });
    $$('.wp',body).forEach(w=>w.onclick=win.guard(async()=>{await setWall(w.dataset.ref);}));
    $('#wpset',body).onclick=win.guard(async()=>{const u=$('#wpurl',body).value.trim();if(u)await setWall(u);});
    $('#wpreset',body).onclick=win.guard(async()=>{await setWall(null);});
  }
  async function setWall(u){ await FS.setMeta('wallpaper',u); applyWallpaper(); playSound('change'); renderWall(); notify('Wallpaper changed','Desktop background updated','🖼'); }
  function renderDock(){
    const size=FS.getMeta('dockSize',52);
    body.innerHTML=card('Dock Size','<input type="range" id="dsize" min="36" max="80" value="'+size+'" style="width:100%"><div style="font-size:12px;color:#888;margin-top:6px">Current: <span id="dsv">'+size+'</span>px</div>')
      +card('Dock Items','<div style="font-size:12px;color:#888">'+FS.getMeta('dock',[]).map(id=>(FS.get(id)||{}).name||'?').join(', ')+'</div><div style="font-size:11px;color:#aaa;margin-top:8px">Tip: right-click an app and choose “Pin to Dock”, or right-click a Dock icon to remove it.</div>');
    $('#dsize',body).oninput=win.guard(async e=>{ const v=+e.target.value; $('#dsv',body).textContent=v; await FS.setMeta('dockSize',v); buildDock(); });
  }
  function renderUsers(){
    const users=JSON.parse(JSON.stringify(getUsers()));
    async function commit(){ await FS.setMeta('users',users); renderUsers(); }
    body.innerHTML=card('User Accounts',
      users.map((u,i)=>'<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #eee">'+
        '<div style="font-size:28px">'+(u.avatar||'👤')+'</div>'+
        '<div style="flex:1"><div style="font-weight:600">'+esc(u.name)+(u.name===BENOS.user?' <span style="font-size:11px;color:#888;font-weight:400">(current)</span>':'')+'</div>'+
        '<div style="font-size:11px;color:#999">'+(u.pass?'🔒 Password protected':'No password')+' · '+(u.hint?'💡 Hint set':'No hint')+'</div></div>'+
        '<button class="tbtn" data-pw="'+i+'">'+(u.pass?'Change':'Set')+' Password</button>'+ 
        '<button class="tbtn" data-hint="'+i+'">'+(u.hint?'Edit':'Set')+' Hint</button>'+ 
        (u.pass?'<button class="tbtn" data-clr="'+i+'">Remove Password</button>':'')+
        (users.length>1?'<button class="tbtn" data-del="'+i+'">Delete</button>':'')+
      '</div>').join(''))
      +card('Add User','<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="nu-name" placeholder="User name" style="flex:1;min-width:120px;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px"><input id="nu-pass" placeholder="Password (optional)" style="flex:1;min-width:120px;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px"><input id="nu-hint" placeholder="Password hint (optional)" style="flex:1;min-width:120px;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px"><button class="tbtn" id="nu-add">Add User</button></div>')
      +card('Login Behaviour','<div style="font-size:12px;color:#666;line-height:1.7">The login screen appears only when a password is set <b>or</b> more than one user exists. With a single password-free user, BenOS logs in automatically on boot.<br>Current state: <b>'+(needsLogin()?'Login required at startup':'Auto-login enabled')+'</b></div>');
    $$('[data-pw]',body).forEach(b=>b.onclick=win.guard(()=>{ const i=+b.dataset.pw; promptText('Set Password','Enter a new password for '+users[i].name+':','',true, async v=>{ users[i].pass=v||''; await commit(); notify('Password updated',users[i].name,'🔒'); }); }));
    $$('[data-hint]',body).forEach(b=>b.onclick=win.guard(()=>{ const i=+b.dataset.hint; promptText('Set Password Hint','Enter a password hint for '+users[i].name+':',users[i].hint||'', false, async v=>{ users[i].hint=v||''; await commit(); notify('Hint saved',users[i].name,'💡'); }); }));
    $$('[data-clr]',body).forEach(b=>b.onclick=win.guard(async()=>{ const i=+b.dataset.clr; users[i].pass=''; await commit(); }));
    $$('[data-del]',body).forEach(b=>b.onclick=win.guard(async()=>{ const i=+b.dataset.del; if(users.length<=1)return; const nm=users[i].name; users.splice(i,1); await commit(); notify('User removed',nm,'👤'); }));
    $('#nu-add',body).onclick=win.guard(async()=>{ const nm=$('#nu-name',body).value.trim(); if(!nm){return;} const pw=$('#nu-pass',body).value||''; const hint=$('#nu-hint',body).value||''; users.push({name:nm,pass:pw,hint:hint,avatar:'👤'}); await commit(); notify('User added',nm,'👤'); });
  }
  function renderStorage(){
    const s=FS.stats(); const total=512*1048576; const pct=Math.min(100,(s.bytes/total)*100);
    const engine = DB.mode==='idb'?'IndexedDB (persistent)':(DB.mode==='local'?'localStorage (persistent, ~5 MB)':'In-memory (not saved after the page closes)');
    body.innerHTML=card('Storage',
      '<div style="height:22px;border-radius:11px;background:#e6e6ea;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:'+Math.max(2,pct)+'%;background:linear-gradient(90deg,#3a86e0,#7ec5ff)"></div></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:13px"><span>'+fmtSize(s.bytes)+' used</span><span style="color:#888">'+fmtSize(total-s.bytes)+' available of '+fmtSize(total)+'</span></div>')
      +card('Contents','<div style="font-size:13px;line-height:1.9"><div>📄 Files: <b>'+s.files+'</b></div><div>📁 Folders: <b>'+s.folders+'</b></div><div>💾 Total items: <b>'+(s.files+s.folders)+'</b></div></div>')
      +card('Storage Engine','<div style="font-size:13px">Backend: <b>'+engine+'</b></div>'+(DB.mode==='memory'?'<div style="font-size:11px;color:#c0392b;margin-top:6px">⚠️ Persistent storage is blocked in this context. Serve BenOS over http:// for permanent saving.</div>':''));
  }
  function renderSystem(){
    const s=FS.stats();
    body.innerHTML=card('About This BenOS',
      '<div style="font-size:13px;line-height:2"><div><b>BenOS HTML Edition</b></div>'+
      '<div>Version: '+BENOS.version+'</div><div>Build: '+BENOS.build+'</div><div>User: '+BENOS.user+'</div>'+
      '<div>Resolution: '+(screen.width||window.innerWidth||1920)+' × '+(screen.height||window.innerHeight||1080)+'</div>'+
      '<div>Browser: '+navigator.userAgent.split(') ')[0].split('(').pop()+'</div>'+
      '<div>Storage engine: '+(DB.mode==='idb'?'IndexedDB':(DB.mode==='local'?'localStorage':'In-memory'))+'</div></div>')
      +card('System Files (Metadata)', (function(){
        const md=FS.getMeta('systemMetadata',null);
        if(md && md.files){
          const n=Object.keys(md.files).length;
          return '<div style="font-size:13px;line-height:1.9"><div>Source: <b>github.com/'+esc('BenjaminOriginals/BenOS-HTML')+'</b></div><div>Directory: <b>/'+esc(md.version)+'/</b></div><div>Branch: <b>'+esc(md.branch)+'</b></div><div>Files downloaded: <b>'+n+'</b></div><div>Fetched: <b>'+fmtDate(md.fetchedAt)+'</b></div></div>';
        }
        return '<div style="font-size:13px;color:#888;line-height:1.7">No metadata was downloaded this session. BenOS booted from local data (the metadata repository was offline or empty). System files are fetched from <b>github.com/BenjaminOriginals/BenOS-HTML</b> at <b>/'+esc(BENOS.version)+'/</b> on boot.</div>';
      })())
      +card('Power','<div style="display:flex;gap:8px"><button class="tbtn" onclick="confirmAction(\'Restart BenOS?\',restartOS)">Restart</button><button class="tbtn" onclick="confirmAction(\'Shut down?\',shutdownOS)">Shut Down</button><button class="tbtn" onclick="confirmAction(\'Log out?\',logOut)">Log Out</button></div>')
      +card('Reset','<div style="font-size:12px;color:#666;line-height:1.6;margin-bottom:10px">Restore BenOS to factory settings. This permanently erases all files, settings, users and installed apps.</div><button class="tbtn" style="background:#ffeaea;border-color:#f3b6b6;color:#c0392b" onclick="factoryReset()">⚠️ Restore Factory Settings</button>');
  }
  renderNav(); renderBody();
}

/* ===================================================================== */
/* PREINSTALLED APP — TERMINAL                                             */
/* ===================================================================== */
function buildTerminalApp(win){
  win.appName='Terminal';
  win.body.style.background='#1e1e1e';
  const root=el('div'); root.style.cssText='height:100%;display:flex;flex-direction:column;font-family:Menlo,Monaco,monospace;font-size:13px;color:#e6e6e6;padding:10px;overflow:hidden';
  win.body.appendChild(root);
  const out=el('div'); out.style.cssText='flex:1;overflow:auto;white-space:pre-wrap;line-height:1.45;word-break:break-word';
  const inputLine=el('div'); inputLine.style.cssText='display:flex;align-items:center;gap:6px';
  const prompt=el('span'); prompt.style.color='#5af78e';
  const inp=el('input'); inp.style.cssText='flex:1;background:transparent;border:none;outline:none;color:#e6e6e6;font-family:inherit;font-size:13px;';
  inputLine.appendChild(prompt); inputLine.appendChild(inp);
  root.appendChild(out); root.appendChild(inputLine);

  let cwd='root'; const hist=[]; let hp=0;
  const print=(t,c)=>{ const d=el('div'); if(c)d.style.color=c; d.textContent=t; out.appendChild(d); out.scrollTop=out.scrollHeight; };
  const setPrompt=()=>{ prompt.textContent='ben@benos '+(FS.pathOf(cwd)==='/'?'/':FS.pathOf(cwd))+' $'; };
  win.body.addEventListener('mousedown',()=>setTimeout(()=>inp.focus(),0));

  print('BenOS HTML Edition Terminal — type "help" for a list of commands.','#888'); print('');
  setPrompt(); setTimeout(()=>inp.focus(),60);

  function resolve(p){
    // returns node for a path (absolute or relative); null if not found
    if(!p)return FS.get(cwd);
    let base = p.startsWith('/')?'root':cwd;
    const parts=p.split('/').filter(x=>x.length);
    let cur=FS.get(base);
    for(const part of parts){
      if(part==='.')continue;
      if(part==='..'){ cur=FS.get(cur.parentId)||cur; continue; }
      const child=FS.childByName(cur.id,part);
      if(!child)return null; cur=child;
    }
    return cur;
  }
  function parentAndName(p){
    const parts=p.split('/').filter(x=>x.length); const name=parts.pop();
    const dir = parts.length? resolve((p.startsWith('/')?'/':'')+parts.join('/')) : FS.get(cwd);
    return {dir,name};
  }

  const cmds={
    help(){ print('Available commands:\n  help            show this help\n  ls [path]       list directory contents\n  cd <path>       change directory\n  pwd             print working directory\n  mkdir <name>    create a folder\n  touch <name>    create an empty file\n  cat <file>      print file contents\n  echo <text>     print text  (echo text > file to write)\n  rm <name>       remove a file or folder\n  cp <a> <b>      copy\n  mv <a> <b>      move/rename\n  open <name>     open a file/app in a window\n  tree            show the file tree\n  clear           clear the screen\n  whoami          current user\n  date            current date/time\n  neofetch        system info'); },
    ls(a){ const t=a[0]?resolve(a[0]):FS.get(cwd); if(!t){print('ls: no such file or directory: '+a[0],'#ff6b6b');return;} if(t.type!=='folder'){print(t.name);return;} const c=FS.children(t.id).sort((x,y)=>x.name.localeCompare(y.name)); if(!c.length){return;} print(c.map(n=>n.type==='folder'?n.name+'/':n.name).join('   ')); },
    cd(a){ if(!a[0]||a[0]==='~'){cwd='root';setPrompt();return;} const t=resolve(a[0]); if(!t){print('cd: no such directory: '+a[0],'#ff6b6b');return;} if(t.type!=='folder'){print('cd: not a directory: '+a[0],'#ff6b6b');return;} cwd=t.id; setPrompt(); },
    pwd(){ print(FS.pathOf(cwd)==='/'?'/':FS.pathOf(cwd)); },
    async mkdir(a){ if(!a[0]){print('mkdir: missing operand','#ff6b6b');return;} await FS.createFolder(cwd,a[0]); afterFS(); },
    async touch(a){ if(!a[0]){print('touch: missing operand','#ff6b6b');return;} await FS.createFile(cwd,a[0],''); afterFS(); },
    cat(a){ const t=resolve(a[0]); if(!t){print('cat: '+a[0]+': no such file','#ff6b6b');return;} if(t.type==='folder'){print('cat: '+a[0]+': is a directory','#ff6b6b');return;} print(typeof t.content==='string'&&!t.content.startsWith('data:')?t.content:'[binary file]'); },
    async echo(a,raw){ const gt=raw.indexOf('>'); if(gt>=0){ const text=raw.slice(5,gt).trim().replace(/^["']|["']$/g,''); const fname=raw.slice(gt+1).trim(); const {dir,name}=parentAndName(fname); if(!dir){print('echo: bad path','#ff6b6b');return;} const ex=FS.childByName(dir.id,name); if(ex){ex.content=text;ex.size=text.length;await FS.save(ex);}else{await FS.createFile(dir.id,name,text);} afterFS(); } else { print(a.join(' ')); } },
    async rm(a){ if(!a[0]){print('rm: missing operand','#ff6b6b');return;} const t=resolve(a[0]); if(!t){print('rm: '+a[0]+': no such file','#ff6b6b');return;} if(t.id==='root'){print('rm: cannot remove root','#ff6b6b');return;} await FS.remove(t.id); afterFS(); },
    async cp(a){ const s=resolve(a[0]); if(!s){print('cp: '+a[0]+': no such file','#ff6b6b');return;} const dst=a[1]?resolve(a[1]):null; await FS.duplicate(s.id, dst&&dst.type==='folder'?dst.id:cwd); afterFS(); },
    async mv(a){ const s=resolve(a[0]); if(!s){print('mv: '+a[0]+': no such file','#ff6b6b');return;} const dst=a[1]?resolve(a[1]):null; if(dst&&dst.type==='folder'){await FS.move(s.id,dst.id);}else if(a[1]){await FS.rename(s.id,a[1].split('/').pop());} afterFS(); },
    open(a){ const t=resolve(a[0]); if(!t){print('open: '+a[0]+': no such file','#ff6b6b');return;} openNode(t); print('Opening '+t.name+'…','#5af78e'); },
    tree(){ const lines=[]; (function walk(id,pre){ const c=FS.children(id).sort((x,y)=>x.name.localeCompare(y.name)); c.forEach((n,i)=>{ const last=i===c.length-1; lines.push(pre+(last?'└─ ':'├─ ')+n.name+(n.type==='folder'?'/':'')); if(n.type==='folder')walk(n.id,pre+(last?'   ':'│  ')); }); })(cwd,''); print(lines.join('\n')||'(empty)'); },
    clear(){ out.innerHTML=''; },
    whoami(){ print(BENOS.user); },
    date(){ print(new Date().toString()); },
    neofetch(){ const s=FS.stats(); print('       BenOS HTML Edition\n   ___   OS: BenOS '+BENOS.version+'\n  (o o)  Build: '+BENOS.build+'\n  ( - )  User: '+BENOS.user+'\n  /   \\  Files: '+s.files+'  Folders: '+s.folders+'\n         Storage: '+fmtSize(s.bytes)+'\n         Shell: bensh','#7ec5ff'); },
  };
  function afterFS(){ refreshAfterFS(cwd); [...WM.windows.values()].forEach(w=>{if(w.systemApp==='files'&&w.refresh)w.refresh();}); }

  inp.addEventListener('keydown',win.guard(async e=>{
    if(e.key==='Enter'){
      const raw=inp.value; const line=raw.trim();
      print(prompt.textContent+' '+raw);
      inp.value='';
      if(line){ hist.push(line); hp=hist.length;
        const parts=line.split(/\s+/); const cmd=parts[0]; const args=parts.slice(1);
        if(cmds[cmd]){ try{ await cmds[cmd](args,line); }catch(err){ print(cmd+': '+(err.message||err),'#ff6b6b'); } }
        else print('bensh: command not found: '+cmd,'#ff6b6b');
      }
      setPrompt();
    }else if(e.key==='ArrowUp'){ if(hp>0){hp--;inp.value=hist[hp]||'';} e.preventDefault(); }
    else if(e.key==='ArrowDown'){ if(hp<hist.length){hp++;inp.value=hist[hp]||'';} e.preventDefault(); }
  }));
}
/* ===================================================================== */
/* PREINSTALLED APP — BENBROWSER                         */
/* ===================================================================== */
function buildBrowserApp(win){
  win.appName='BenBrowser';
  const root=el('div','flexcol'); win.body.appendChild(root);
  root.innerHTML=
    '<div id="tabbar" style="display:flex;align-items:center;gap:2px;background:#dee1e6;padding:6px 6px 0;flex:0 0 auto;overflow-x:auto"></div>'+
    '<div class="toolbar" style="gap:6px">'+
      '<button class="tbtn icon" data-a="back">◀</button>'+
      '<button class="tbtn icon" data-a="fwd">▶</button>'+
      '<button class="tbtn icon" data-a="reload">⟳</button>'+
      '<input id="omni" placeholder="Search or type a URL" style="flex:1;padding:7px 14px;border:1px solid #ccc;border-radius:16px;font-size:13px;outline:none">'+
      '<button class="tbtn icon" data-a="ext" title="Open current page in a real browser tab">↗</button>'+
      '<button class="tbtn icon" data-a="dl" title="Downloads">⤓</button>'+
    '</div>'+
    '<div id="viewport" style="flex:1;position:relative;background:#fff;min-height:0"><div class="bb-loadbar" id="bb-load"></div></div>';
  const vp=$('#viewport',root), omni=$('#omni',root), tabbar=$('#tabbar',root);

  window.addEventListener('message', win.guard(ev=>{
    if(!ev.data || ev.data.__benos !== true || ev.data.type !== 'browser-navigate') return;
    const url = ev.data.url;
    if(url) go(url);
  }));

  let tabs=[], activeTab=0, tabSeq=0;
  function startPage(){
    return '<!DOCTYPE html><html><head><meta charset=utf-8><style>@keyframes fu{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}body{font-family:-apple-system,sans-serif;margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(160deg,#eef3fb,#dfe7f5);color:#333}h1{font-size:46px;margin-bottom:6px;background:linear-gradient(90deg,#4285f4,#34a853,#fbbc05,#ea4335);-webkit-background-clip:text;background-clip:text;color:transparent;animation:fu .5s ease}p{color:#888;margin-bottom:24px;animation:fu .5s ease .1s both}.search-row{display:flex;align-items:center;gap:10px;width:100%;max-width:540px;margin-bottom:22px;animation:fu .45s ease .1s both}.search-input{flex:1;padding:14px 16px;border-radius:18px;border:1px solid rgba(0,0,0,.14);font-size:15px;outline:none;}.search-btn{padding:13px 20px;border-radius:18px;background:linear-gradient(135deg,#34a853,#2db84d);color:#fff;font-weight:700;cursor:pointer;border:none;transition:transform .18s ease,box-shadow .18s ease;box-shadow:0 12px 24px rgba(45,184,77,.22);}.search-btn:hover{transform:translateY(-1px);box-shadow:0 16px 28px rgba(45,184,77,.26)}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:560px}.t{background:#fff;border-radius:12px;padding:16px 10px;text-align:center;text-decoration:none;color:#444;box-shadow:0 2px 10px rgba(0,0,0,.08);font-size:13px;transition:transform .18s,box-shadow .18s;animation:fu .45s ease both}.t:hover{transform:translateY(-4px) scale(1.04);box-shadow:0 8px 22px rgba(0,0,0,.16)}.t b{display:block;font-size:26px;margin-bottom:6px}</style></head><body><h1>BenBrowser</h1><p>Your gateway to the web inside BenOS</p><div class=search-row><input id="bb-search" class="search-input" placeholder="Search the web" autocomplete="off"><button id="bb-search-btn" class="search-btn">Search</button></div><div class=g>'+
    [['🔍','Search','https://html.duckduckgo.com/html/?q=BenBrowser'],['📖','Wikipedia','https://www.wikipedia.org'],['🎨','Scratch','https://scratch.mit.edu'],['🌐','Example','https://example.com'],['🐙','GitHub','https://github.com'],['📚','MDN','https://developer.mozilla.org'],['⤓','Test Download','#download']].map((t,i)=>'<a class=t style="animation-delay:'+(i*0.05)+'s" href="'+t[2]+'" data-benbrowser="'+esc(t[2])+'" target="_self"><b>'+t[0]+'</b>'+t[1]+'</a>').join('')+
    '</div><script>const searchInput=document.getElementById("bb-search");const searchBtn=document.getElementById("bb-search-btn");const searchGo=()=>{const q=searchInput.value.trim()||"BenBrowser";window.parent.postMessage({__benos:true,type:"browser-navigate",url:"https://html.duckduckgo.com/html/?q="+encodeURIComponent(q)},"*");};searchBtn.addEventListener("click",searchGo);searchInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchGo();}});document.querySelectorAll("a[data-benbrowser]").forEach(a=>{a.addEventListener("click",e=>{e.preventDefault();const url=a.getAttribute("data-benbrowser");window.parent.postMessage({__benos:true,type:"browser-navigate",url},"*");});});