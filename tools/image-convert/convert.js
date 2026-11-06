(function(){
'use strict';
var EN = document.documentElement.lang === 'en';
function T(ja,en){ return EN ? en : ja; }
var MAX_PIXELS = 100e6, MAX_FILES = 300;
var items = [];            // {id,file,name}
var results = [];          // {name,blob,mtime,url}
var nextId = 1, busy = false, cancelled = false;
var support = {jpg:true, png:true, webp:false, avif:false};
var $ = function(id){return document.getElementById(id);};
var MIME = {jpg:'image/jpeg', png:'image/png', webp:'image/webp', avif:'image/avif'};

function setStatus(t){ $('status').textContent = t; }
function setProg(v,m){ var p=$('prog'); if(v==null){p.hidden=true;return;} p.hidden=false; p.max=m; p.value=v; }
function tick(){ return new Promise(function(r){setTimeout(r,0);}); }
function showErrs(list){
  var e=$('errs'); e.textContent='';
  if(!list.length){e.hidden=true;return;}
  e.hidden=false;
  var p=document.createElement('strong'); p.textContent=T('次のファイルは処理できませんでした。','These files could not be processed:'); e.appendChild(p);
  var ul=document.createElement('ul');
  list.forEach(function(s){var li=document.createElement('li');li.textContent=s;ul.appendChild(li);});
  e.appendChild(ul);
}
function mk(tag,cls,text){var e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e;}
function canvasBlob(c,type,q){ return new Promise(function(res){ try{ c.toBlob(res,type,q); }catch(e){ res(null); } }); }

/* 書き出し対応の検出(実際に1pxを書き出して確かめる) */
async function detect(){
  var c=document.createElement('canvas'); c.width=c.height=1;
  var ctx=c.getContext('2d'); if(ctx){ ctx.fillStyle='#fff'; ctx.fillRect(0,0,1,1); }
  for(var k of ['webp','avif']){
    var b=await canvasBlob(c,MIME[k],0.8);
    support[k]=!!(b&&b.type===MIME[k]);
  }
  var sel=$('fmt');
  if(support.avif){ var o=document.createElement('option'); o.value='avif'; o.textContent=T('AVIF(このブラウザは書き出し可)','AVIF (this browser can export it)'); sel.appendChild(o); }
  $('avifnote').textContent = support.avif ? T('AVIFへの書き出しに対応したブラウザです。','This browser can export AVIF.') : T('このブラウザはAVIFへの書き出しに対応していないため、AVIFは選べません(読み込みは別です)。','This browser cannot export AVIF, so AVIF is not offered as an output (reading AVIF is a separate matter).');
  if(!support.webp){ sel.querySelector('option[value="webp"]').textContent=T('WebP(このブラウザでは書き出せない可能性)','WebP (this browser may not be able to export it)'); }
  update();
}

/* ---------- 画面 ---------- */
function outExt(){ return $('fmt').value==='jpg'?'jpg':$('fmt').value; }
function clean(s){ return s.replace(/[\\\/:*?"<>|\u0000-\u001f]/g,'_'); }
function baseName(n){ return n.replace(/\.[^.\/\\]+$/,''); }
function update(){
  var f=$('fmt').value;
  $('qwrap').hidden = (f==='png');
  $('bgwrap').hidden = (f!=='jpg');
  $('qv').textContent=$('quality').value;
}
function render(){
  var ul=$('list'); ul.textContent='';
  $('work').hidden = items.length===0;
  $('count').textContent = items.length+T('枚',items.length===1?' file':' files');
  items.forEach(function(it){
    var li=mk('li'); li.dataset.id=it.id;
    li.appendChild(mk('span','fn',it.name));
    var st=mk('span','st',it.state||T('待機中','Waiting')); if(it.bad) st.className='st ng'; li.appendChild(st);
    if(it.out){
      var a=mk('a','dlk',T('保存('+it.out.name+')','Save ('+it.out.name+')')); a.href=it.out.url; a.download=it.out.name; a.setAttribute('aria-label',T(it.out.name+' を保存','Save '+it.out.name)); li.appendChild(a);
    }
    var x=mk('button','ghost sm',T('外す','Remove')); x.type='button'; x.setAttribute('aria-label',T(it.name+' を一覧から外す','Remove '+it.name+' from the list')); x.disabled=busy;
    x.addEventListener('click',function(){ items=items.filter(function(i){return i!==it;}); freeResults(); render(); });
    li.appendChild(x);
    ul.appendChild(li);
  });
}
function freeResults(){
  results.forEach(function(r){URL.revokeObjectURL(r.url);}); results=[];
  items.forEach(function(i){delete i.out; if(!i.bad) i.state=T('待機中','Waiting');});
  $('res').hidden=true;
}
function setBusy(){ ['go','pick','clear','fmt','edge','quality','bg'].forEach(function(id){$(id).disabled=busy;}); $('cancel').hidden=!busy; Array.prototype.forEach.call(document.querySelectorAll('#list button'),function(b){b.disabled=busy;}); }

function addFiles(fileList){
  if(busy) return;
  var errs=[], files=Array.prototype.slice.call(fileList);
  var imgs=files.filter(function(f){return /^image\//.test(f.type)||/\.(webp|avif|png|jpe?g|gif|bmp|ico|svg|hei[cf])$/i.test(f.name);});
  if(files.length-imgs.length) errs.push(T('画像ではないファイルを'+(files.length-imgs.length)+'件、無視しました。','Ignored '+(files.length-imgs.length)+' non-image file(s).'));
  var room=MAX_FILES-items.length;
  if(imgs.length>room){ errs.push(T('1回に扱えるのは'+MAX_FILES+'枚までです。'+(imgs.length-room)+'枚は追加していません。','Up to '+MAX_FILES+' files at a time. '+(imgs.length-room)+' file(s) were not added.')); imgs=imgs.slice(0,Math.max(0,room)); }
  freeResults();
  imgs.forEach(function(f){ items.push({id:nextId++,file:f,name:f.name}); });
  showErrs(errs); render();
  setStatus(imgs.length?T(items.length+'枚を追加しました。設定して「変換する」を押してください。',items.length+' file(s) in the list. Adjust the settings, then press "Convert".'):T('追加できた画像はありません。','No images were added.'));
}

/* ---------- 変換 ---------- */
/*HEIF-BEGIN*/
/* ---------- HEIC/HEIF(コンテナだけを自前で読む。HEVCの復号はブラウザ・OSに任せる) ---------- */
var HEIF=(function(){
  function fourcc(u,o){ return String.fromCharCode(u[o],u[o+1],u[o+2],u[o+3]); }
  function R(u){ this.u=u; this.dv=new DataView(u.buffer,u.byteOffset,u.byteLength); }
  R.prototype.n=function(o,sz){ var d=this.dv; if(sz===0)return 0; if(sz===1)return d.getUint8(o); if(sz===2)return d.getUint16(o); if(sz===3)return (d.getUint16(o)<<8)|d.getUint8(o+2); if(sz===4)return d.getUint32(o); if(sz===8){ var hi=d.getUint32(o),lo=d.getUint32(o+4); return hi*4294967296+lo; } throw new Error(T('HEIF: 不正なサイズ','HEIF: invalid size field')); };
  /* 子ボックスを列挙する [{type,start,end,body}] */
  function boxes(r,start,end){
    var out=[],o=start;
    while(o+8<=end){
      var size=r.n(o,4),type=fourcc(r.u,o+4),hdr=8;
      if(size===1){ size=r.n(o+8,8); hdr=16; } else if(size===0){ size=end-o; }
      if(type==='uuid') hdr+=16;
      if(size<hdr||o+size>end) throw new Error(T('HEIF: ボックスが壊れています('+type+')','HEIF: corrupt box ('+type+')'));
      out.push({type:type,start:o,end:o+size,body:o+hdr});
      o+=size;
    }
    return out;
  }
  function find(list,t){ for(var i=0;i<list.length;i++) if(list[i].type===t) return list[i]; return null; }
  function cstr(u,o,end){ var s=''; while(o<end&&u[o]){ s+=String.fromCharCode(u[o]); o++; } return {s:s,next:o+1}; }

  function parse(buf){
    var u=buf instanceof Uint8Array?buf:new Uint8Array(buf), r=new R(u);
    var top=boxes(r,0,u.length);
    var ftyp=find(top,'ftyp'); if(!ftyp) throw new Error(T('HEIF: ftypがありません','HEIF: no ftyp box'));
    var brands=[fourcc(u,ftyp.body)]; for(var o=ftyp.body+8;o+4<=ftyp.end;o+=4) brands.push(fourcc(u,o));
    var meta=find(top,'meta'); if(!meta) throw new Error(T('HEIF: metaがありません','HEIF: no meta box'));
    var mb=boxes(r,meta.body+4,meta.end);  /* metaはFullBox */
    var hdlr=find(mb,'hdlr'); var handler=hdlr?fourcc(u,hdlr.body+8):'';
    if(handler!=='pict') throw new Error(T('HEIF: 画像ではありません(hdlr='+handler+')','HEIF: not an image (hdlr='+handler+')'));
    var pitm=find(mb,'pitm'); if(!pitm) throw new Error(T('HEIF: 主画像(pitm)がありません','HEIF: no primary image (pitm)'));
    var primary=u[pitm.body]===0?r.n(pitm.body+4,2):r.n(pitm.body+4,4);
    var items={};
    function item(id){ return items[id]||(items[id]={id:id,type:'',hidden:false,props:[],refs:{},extents:[],cm:0}); }
    /* iinf / infe */
    var iinf=find(mb,'iinf');
    if(iinf){
      var iv=u[iinf.body], p0=iinf.body+4+(iv===0?2:4);
      boxes(r,p0,iinf.end).forEach(function(b){
        if(b.type!=='infe') return;
        var v=u[b.body], flags=r.n(b.body+1,3)&0xffffff, o=b.body+4;
        if(v<2) return; /* v0/v1は画像では使われない */
        var id=v===2?r.n(o,2):r.n(o,4); o+=v===2?2:4; o+=2; /* protection_index */
        var it=item(id); it.type=fourcc(u,o); it.hidden=!!(flags&1);
      });
    }
    /* iloc */
    var iloc=find(mb,'iloc'); if(!iloc) throw new Error(T('HEIF: ilocがありません','HEIF: no iloc box'));
    (function(){
      var v=u[iloc.body], o=iloc.body+4;
      var a=u[o],b=u[o+1]; o+=2;
      var offS=a>>4,lenS=a&15,baseS=b>>4,idxS=(v===1||v===2)?(b&15):0;
      var cnt=v<2?r.n(o,2):r.n(o,4); o+=v<2?2:4;
      for(var i=0;i<cnt;i++){
        var id=v<2?r.n(o,2):r.n(o,4); o+=v<2?2:4;
        var cm=0; if(v===1||v===2){ cm=r.n(o,2)&15; o+=2; }
        o+=2; /* data_reference_index */
        var base=r.n(o,baseS); o+=baseS;
        var ec=r.n(o,2); o+=2;
        var it=item(id); it.cm=cm; it.extents=[];
        for(var e=0;e<ec;e++){
          if(idxS){ o+=idxS; }
          var eo=r.n(o,offS); o+=offS; var el=r.n(o,lenS); o+=lenS;
          it.extents.push({off:base+eo,len:el});
        }
      }
    })();
    /* idat */
    var idat=find(mb,'idat');
    /* iref */
    var iref=find(mb,'iref');
    if(iref){
      var rv=u[iref.body], is=rv===0?2:4;
      boxes(r,iref.body+4,iref.end).forEach(function(b){
        var o=b.body, from=r.n(o,is); o+=is; var n=r.n(o,2); o+=2; var to=[];
        for(var k=0;k<n;k++){ to.push(r.n(o,is)); o+=is; }
        var it=item(from); (it.refs[b.type]=it.refs[b.type]||[]).push.apply(it.refs[b.type],to);
      });
    }
    /* iprp: ipco + ipma */
    var props=[];
    var iprp=find(mb,'iprp');
    if(iprp){
      var pb=boxes(r,iprp.body,iprp.end), ipco=find(pb,'ipco');
      if(ipco) props=boxes(r,ipco.body,ipco.end).map(function(b){ return parseProp(r,b); });
      pb.forEach(function(b){
        if(b.type!=='ipma') return;
        var v=u[b.body], fl=r.n(b.body+1,3)&0xffffff, o=b.body+4;
        var cnt=r.n(o,4); o+=4;
        for(var i=0;i<cnt;i++){
          var id=v<1?r.n(o,2):r.n(o,4); o+=v<1?2:4;
          var ac=u[o++], it=item(id);
          for(var k=0;k<ac;k++){
            var x; if(fl&1){ x=r.n(o,2); o+=2; x&=0x7fff; } else { x=u[o++]&0x7f; }
            if(x>0&&props[x-1]) it.props.push({p:props[x-1],idx:x});
          }
        }
      });
    }
    function data(it){
      var parts=[],total=0;
      it.extents.forEach(function(e){
        var src,start;
        if(it.cm===0){ src=u; start=e.off; }
        else if(it.cm===1){ if(!idat) throw new Error(T('HEIF: idatがありません','HEIF: no idat box')); src=u.subarray(idat.body,idat.end); start=e.off; }
        else throw new Error(T('HEIF: 対応していない格納方法です(construction_method='+it.cm+')','HEIF: unsupported storage method (construction_method='+it.cm+')'));
        var len=e.len||(src.length-start);
        if(start+len>src.length) throw new Error(T('HEIF: データがファイルの範囲外です','HEIF: data lies outside the file'));
        parts.push(src.subarray(start,start+len)); total+=len;
      });
      if(parts.length===1) return parts[0];
      var out=new Uint8Array(total),p=0; parts.forEach(function(x){ out.set(x,p); p+=x.length; }); return out;
    }
    function prop(it,t){ for(var i=0;i<it.props.length;i++) if(it.props[i].p.type===t) return it.props[i].p; return null; }
    var pi=items[primary]; if(!pi) throw new Error(T('HEIF: 主画像の情報がありません','HEIF: primary image item is missing'));
    var res={brands:brands,primary:primary,type:pi.type,items:items,data:data,prop:prop};
    var ispe=prop(pi,'ispe');
    res.transforms=pi.props.map(function(x){return x.p;}).filter(function(p){return p.type==='clap'||p.type==='irot'||p.type==='imir';});
    res.colr=prop(pi,'colr'); res.pixi=prop(pi,'pixi');
    res.aux=Object.keys(items).filter(function(k){ var a=items[k].refs.auxl; return a&&a.indexOf(primary)>=0; }).map(function(k){ var c=prop(items[k],'auxC'); return c?c.urn:'?'; });
    if(pi.type==='grid'){
      var g=data(pi), gl=(g[1]&1)?4:2, gr=new R(g);
      res.rows=g[2]+1; res.cols=g[3]+1; res.width=gr.n(4,gl); res.height=gr.n(4+gl,gl);
      res.tiles=(pi.refs.dimg||[]).map(function(id){ return items[id]; });
      if(res.tiles.length!==res.rows*res.cols) throw new Error(T('HEIF: グリッドのタイル数が合いません('+res.tiles.length+'/'+res.rows*res.cols+')','HEIF: grid tile count mismatch ('+res.tiles.length+'/'+res.rows*res.cols+')'));
      res.tiles.forEach(function(t){ if(!t||t.type!=='hvc1') throw new Error(T('HEIF: HEVC以外のタイルです('+(t&&t.type)+')','HEIF: tile is not HEVC ('+(t&&t.type)+')')); });
      var t0=prop(res.tiles[0],'ispe'); res.tileW=t0?t0.w:0; res.tileH=t0?t0.h:0;
      if(!res.tileW) throw new Error(T('HEIF: タイルの大きさが分かりません','HEIF: tile size unknown'));
    } else if(pi.type==='hvc1'){
      res.rows=res.cols=1; res.tiles=[pi];
      res.width=ispe?ispe.w:0; res.height=ispe?ispe.h:0; res.tileW=res.width; res.tileH=res.height;
      if(!res.width) throw new Error(T('HEIF: 画像の大きさ(ispe)がありません','HEIF: image size (ispe) missing'));
    } else {
      throw new Error(T('HEIF: 対応していない画像の種類です('+pi.type+')','HEIF: unsupported image type ('+pi.type+')'));
    }
    res.tiles.forEach(function(t){ if(!prop(t,'hvcC')) throw new Error(T('HEIF: hvcCがありません','HEIF: no hvcC box')); });
    return res;
  }
  function parseProp(r,b){
    var u=r.u,o=b.body,p={type:b.type};
    if(b.type==='hvcC'){ p.raw=u.slice(o,b.end); p.codec=codecString(p.raw); p.nalLen=(u[o+21]&3)+1; }
    else if(b.type==='ispe'){ p.w=r.n(o+4,4); p.h=r.n(o+8,4); }
    else if(b.type==='irot'){ p.angle=(u[o]&3)*90; }
    else if(b.type==='imir'){ p.axis=u[o]&1; }
    else if(b.type==='clap'){
      var d=r.dv; p.wN=d.getUint32(o); p.wD=d.getUint32(o+4); p.hN=d.getUint32(o+8); p.hD=d.getUint32(o+12);
      p.xN=d.getInt32(o+16); p.xD=d.getUint32(o+20); p.yN=d.getInt32(o+24); p.yD=d.getUint32(o+28);
    }
    else if(b.type==='colr'){
      p.kind=fourcc(u,o);
      if(p.kind==='nclx'){ p.primaries=r.n(o+4,2); p.transfer=r.n(o+6,2); p.matrix=r.n(o+8,2); p.fullRange=!!(u[o+10]&0x80); }
    }
    else if(b.type==='pixi'){ var n=u[o+4]; p.bits=[]; for(var i=0;i<n;i++) p.bits.push(u[o+5+i]); }
    else if(b.type==='auxC'){ p.urn=cstr(u,o+4,b.end).s; }
    return p;
  }
  /* ISO/IEC 14496-15 付属書E の書式: hvc1.<空間><profile>.<互換フラグ(ビット逆順)>.<L|H><level>.<制約バイト> */
  function codecString(h){
    var ps=h[1]>>6, tier=(h[1]>>5)&1, pidc=h[1]&31;
    var cf=((h[2]<<24)|(h[3]<<16)|(h[4]<<8)|h[5])>>>0, rev=0;
    for(var i=0;i<32;i++){ if(cf&(1<<i)) rev|=(1<<(31-i)); }
    var s='hvc1.'+(['','A','B','C'][ps])+pidc+'.'+(rev>>>0).toString(16).toUpperCase()+'.'+(tier?'H':'L')+h[12];
    var cons=[]; for(var k=6;k<12;k++) cons.push(h[k]);
    while(cons.length&&cons[cons.length-1]===0) cons.pop();
    cons.forEach(function(c){ s+='.'+c.toString(16).toUpperCase(); });
    return s;
  }
  function looksHeif(u){
    if(u.length<12||fourcc(u,4)!=='ftyp') return false;
    var b=[]; var sz=new DataView(u.buffer,u.byteOffset,u.byteLength).getUint32(0);
    for(var o=8;o+4<=Math.min(sz,u.length);o+=4) if(o!==12) b.push(fourcc(u,o));
    return b.some(function(x){ return /^(heic|heix|heim|heis|hevc|hevx|heif|mif1|msf1)$/.test(x); }) && !b.some(function(x){return x==='avif'||x==='avis';}) || b[0]==='heic'||b[0]==='heix';
  }
  /* nclx の番号を WebCodecs の VideoColorSpaceInit に直す(分かるものだけ) */
  function colorSpace(c){
    if(!c||c.kind!=='nclx') return undefined;
    var P={1:'bt709',5:'bt470bg',6:'smpte170m',9:'bt2020',12:'smpte432'}, T={1:'bt709',6:'smpte170m',8:'linear',13:'iec61966-2-1',16:'pq',18:'hlg'}, M={0:'rgb',1:'bt709',5:'bt470bg',6:'smpte170m',9:'bt2020-ncl'};
    var cs={fullRange:c.fullRange};
    if(P[c.primaries]) cs.primaries=P[c.primaries];
    if(T[c.transfer]) cs.transfer=T[c.transfer];
    if(M[c.matrix]) cs.matrix=M[c.matrix];
    return cs;
  }
  /* WebCodecs で各タイルを復号し、キャンバスに並べてから clap / irot / imir を順に当てる */
  async function decode(buf, maxPixels){
    var h=parse(buf);
    if(h.width*h.height>maxPixels) throw new Error(T('画像が大きすぎます('+h.width+'×'+h.height+'、上限1億画素)','Image too large ('+h.width+'×'+h.height+'; limit is 100 megapixels)'));
    if(typeof VideoDecoder==='undefined') { var e=new Error('nowebcodecs'); e.heic=true; throw e; }
    var groups={};  /* 同じhvcCを持つタイルは1つのデコーダで */
    h.tiles.forEach(function(t,i){ var hc=h.prop(t,'hvcC'); var k=hc.codec+'#'+Array.prototype.join.call(hc.raw,','); (groups[k]=groups[k]||{hc:hc,list:[]}).list.push(i); });
    var cv=document.createElement('canvas'); cv.width=h.width; cv.height=h.height;
    var ctx=cv.getContext('2d'); if(!ctx) throw new Error(T('キャンバスを作れません(画像が大きすぎる可能性)','Could not create a canvas (the image may be too large)'));
    var cs=colorSpace(h.colr);
    for(var key in groups){
      var g=groups[key];
      var cfg={codec:g.hc.codec, description:g.hc.raw, codedWidth:h.tileW, codedHeight:h.tileH, optimizeForLatency:true};
      if(cs) cfg.colorSpace=cs;
      var sup=null; try{ sup=await VideoDecoder.isConfigSupported(cfg); }catch(e){ sup=null; }
      if(!sup||!sup.supported){
        if(cs){ delete cfg.colorSpace; try{ sup=await VideoDecoder.isConfigSupported(cfg); }catch(e){ sup=null; } }
        if(!sup||!sup.supported){ var e2=new Error('nohevc'); e2.heic=true; e2.codec=g.hc.codec; throw e2; }
      }
      await new Promise(function(resolve,reject){
        var err=null, got=0;
        var dec=new VideoDecoder({
          output:function(f){
            try{
              var i=f.timestamp, col=i%h.cols, row=Math.floor(i/h.cols);
              ctx.drawImage(f, col*h.tileW, row*h.tileH, f.displayWidth, f.displayHeight);
              got++;
            }catch(e){ err=err||e; } finally { f.close(); }
          },
          error:function(e){ err=err||e; }
        });
        try{
          dec.configure(cfg);
          g.list.forEach(function(i){
            dec.decode(new EncodedVideoChunk({type:'key', timestamp:i, data:h.data(h.tiles[i])}));
          });
          dec.flush().then(function(){
            dec.close();
            if(err) reject(err); else if(got!==g.list.length) reject(new Error(T('HEVCの復号でタイルが足りません('+got+'/'+g.list.length+')','HEVC decoding returned too few tiles ('+got+'/'+g.list.length+')'))); else resolve();
          },function(e){ try{dec.close();}catch(x){} reject(err||e); });
        }catch(e){ try{dec.close();}catch(x){} reject(e); }
      });
    }
    /* 変形はipmaに並んだ順(仕様では clap → irot → imir の順に並ぶ) */
    h.transforms.forEach(function(t){
      var w=cv.width, ht=cv.height, n=document.createElement('canvas'), c2;
      if(t.type==='clap'){
        if(!t.wD||!t.hD||!t.xD||!t.yD) return;
        var cw=Math.round(t.wN/t.wD), ch=Math.round(t.hN/t.hD);
        var left=Math.round(t.xN/t.xD+(w-1)/2-(cw-1)/2), top=Math.round(t.yN/t.yD+(ht-1)/2-(ch-1)/2);
        left=Math.max(0,Math.min(left,w-1)); top=Math.max(0,Math.min(top,ht-1));
        cw=Math.max(1,Math.min(cw,w-left)); ch=Math.max(1,Math.min(ch,ht-top));
        if(cw===w&&ch===ht) return;
        n.width=cw; n.height=ch; c2=n.getContext('2d'); c2.drawImage(cv,left,top,cw,ch,0,0,cw,ch);
      } else if(t.type==='irot'){
        if(!t.angle) return;
        var sw=t.angle!==180; n.width=sw?ht:w; n.height=sw?w:ht; c2=n.getContext('2d');
        /* irotは反時計回り */
        if(t.angle===90){ c2.translate(0,w); c2.rotate(-Math.PI/2); }
        else if(t.angle===180){ c2.translate(w,ht); c2.rotate(Math.PI); }
        else { c2.translate(ht,0); c2.rotate(Math.PI/2); }
        c2.drawImage(cv,0,0);
      } else if(t.type==='imir'){
        n.width=w; n.height=ht; c2=n.getContext('2d');
        /* axis=0は上下反転、1は左右反転(Safari・macOSとlibheifの解釈に合わせる。仕様の文面とは読みが分かれる) */
        if(t.axis===0){ c2.translate(0,ht); c2.scale(1,-1); } else { c2.translate(w,0); c2.scale(-1,1); }
        c2.drawImage(cv,0,0);
      }
      if(c2){ cv.width=cv.height=0; cv=n; }
    });
    return {im:cv, w:cv.width, h:cv.height, heif:h};
  }
  return {parse:parse, decode:decode, looksHeif:looksHeif, codecString:codecString};
})();
/*HEIF-END*/

var HEIC_HELP=T('別の方法は下の「HEICが開けないとき」を見てください。',' See "If your HEIC will not open" below for other options.');
var CANT_READ=T('このブラウザでは画像として読み込めませんでした','This browser could not read the file as an image');
function isHeicName(f){ return /\.hei[cf]$/i.test(f.name)||/^image\/hei[cf]/.test(f.type); }
async function sniffHeif(file){ try{ return HEIF.looksHeif(new Uint8Array(await file.slice(0,64).arrayBuffer())); }catch(e){ return false; } }
async function decode(file){
  try{ return await decodeNative(file); }
  catch(e){
    if(e.message!==CANT_READ) throw e;
    if(!(isHeicName(file)||await sniffHeif(file))) throw e;
  }
  /* ブラウザが直接開けないHEIC: WebCodecs(ブラウザやOSのHEVCデコーダ)で開く */
  try{ return await HEIF.decode(await file.arrayBuffer(), MAX_PIXELS); }
  catch(e){
    if(e.message==='nowebcodecs') throw new Error(T('このブラウザはHEICを開けません(HEICを直接開く機能も、HEVCを復号するWebCodecsもありません)。Safariで試してください。','This browser cannot open HEIC: it has neither native HEIC support nor WebCodecs to decode HEVC. Try Safari.')+HEIC_HELP);
    if(e.message==='nohevc') throw new Error(T('このブラウザ・端末では、HEICの中身(HEVC)を復号できません('+e.codec+')。HEVCの復号はブラウザやOSの機能を使うため、Firefoxや一部のLinuxなどでは使えません。Safari、またはmacOS・WindowsのChromeやEdgeで試してください。','This browser or device cannot decode the HEVC data inside this HEIC ('+e.codec+'). HEVC decoding comes from the browser or OS, so it is unavailable in Firefox and on some Linux setups. Try Safari, or Chrome or Edge on macOS or Windows.')+HEIC_HELP);
    if(/^HEIF: /.test(e.message)) throw new Error(T('HEICとして読めませんでした(','Could not read this as HEIC (')+e.message.slice(6)+')');
    throw new Error(T('HEICの復号に失敗しました('+(e.message||e)+')。','HEIC decoding failed ('+(e.message||e)+').')+HEIC_HELP);
  }
}
async function decodeNative(file){
  var url=URL.createObjectURL(file);
  try{
    var im=await new Promise(function(res,rej){var i=new Image(); i.onload=function(){res(i);}; i.onerror=function(){rej(new Error('decode'));}; i.src=url;});
    if(im.decode){ try{ await im.decode(); }catch(e){} }
    var w=im.naturalWidth,h=im.naturalHeight;
    if(!w||!h) throw new Error(T('サイズを取得できません','Could not read the image size'));
    if(w*h>MAX_PIXELS) throw new Error(T('画像が大きすぎます('+w+'×'+h+'、上限1億画素)','Image too large ('+w+'×'+h+'; limit is 100 megapixels)'));
    return {im:im,w:w,h:h};
  } catch(e){
    if(e.message==='decode'){
      if(window.createImageBitmap){ try{ var bm=await createImageBitmap(file); return {im:bm,w:bm.width,h:bm.height}; }catch(e2){} }
      throw new Error(CANT_READ);
    }
    throw e;
  } finally { setTimeout(function(){URL.revokeObjectURL(url);},0); }
}
var SAFE_PIXELS=16777216; /* iPhoneのSafariのキャンバス上限(約1,677万画素) */
var IS_IOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
async function draw(d,w,h,f,mime,q){
  var c=document.createElement('canvas'); c.width=w; c.height=h;
  var ctx=c.getContext('2d'), b=null;
  if(ctx){
    if(f==='jpg'){ ctx.fillStyle=$('bg').value||'#ffffff'; ctx.fillRect(0,0,w,h); }
    ctx.drawImage(d.im,0,0,w,h);
    b=await canvasBlob(c,mime,f==='png'?undefined:q);
  }
  c.width=c.height=0;
  return b;
}
async function convertOne(file){
  var f=$('fmt').value, mime=MIME[f];
  var q=parseInt($('quality').value,10)/100, edge=parseInt($('edge').value,10)||0;
  var d=await decode(file), w=d.w, h=d.h, note='';
  if(edge>0&&Math.max(w,h)>edge){ var s=edge/Math.max(w,h); w=Math.max(1,Math.round(w*s)); h=Math.max(1,Math.round(h*s)); }
  /* iOSは上限を超えると白紙の画像になることがあるため、先に縮める */
  if(IS_IOS&&w*h>SAFE_PIXELS){ var k0=Math.sqrt(SAFE_PIXELS/(w*h))*0.99; w=Math.max(1,Math.floor(w*k0)); h=Math.max(1,Math.floor(h*k0)); note=T('端末の上限のため'+w+'×'+h+'に縮小','Scaled to '+w+'×'+h+' (device limit)'); }
  try{
    var b=await draw(d,w,h,f,mime,q);
    if(!b&&w*h>SAFE_PIXELS){ /* 4800万画素のHEICなどでスマホの上限を超えたら、上限内に縮めてやり直す */
      var k=Math.sqrt(SAFE_PIXELS/(w*h))*0.99; w=Math.max(1,Math.floor(w*k)); h=Math.max(1,Math.floor(h*k));
      b=await draw(d,w,h,f,mime,q); if(b) note=T('端末の上限のため'+w+'×'+h+'に縮小','Scaled to '+w+'×'+h+' (device limit)');
    }
  } finally { if(d.im.close) d.im.close(); else if(d.im.getContext){ d.im.width=d.im.height=0; } }
  if(!b) throw new Error(T('変換に失敗しました(画像が大きすぎる可能性。長辺を小さくしてください)','Conversion failed (the image may be too large; try a smaller long-edge value)'));
  if(b.type!==mime) throw new Error(T('このブラウザは'+f.toUpperCase()+'への書き出しに対応していません','This browser cannot export '+f.toUpperCase()));
  b.note=note;
  return b;
}
async function run(){
  if(busy||!items.length) return;
  busy=true; cancelled=false; setBusy(); freeResults(); showErrs([]);
  var errs=[], used={}, ok=0, ext=outExt();
  items.forEach(function(i){delete i.bad; i.state=T('待機中','Waiting');}); render(); setBusy();
  var snap=items.slice();
  for(var i=0;i<snap.length;i++){
    if(cancelled) break;
    var it=snap[i];
    setStatus(T('変換中 ','Converting ')+(i+1)+' / '+snap.length+' : '+it.name); setProg(i,snap.length);
    var row=document.querySelector('#list li[data-id="'+it.id+'"] .st'); if(row) row.textContent=T('変換中…','Converting...');
    try{
      var b=await convertOne(it.file);
      var base=clean(baseName(it.name))||'image', nm=base+'.'+ext, n=2;
      while(used[nm.toLowerCase()]) nm=base+'-'+(n++)+'.'+ext;
      used[nm.toLowerCase()]=1;
      var r={name:nm,blob:b,mtime:it.file.lastModified||Date.now(),url:URL.createObjectURL(b)};
      results.push(r); it.out=r; it.state=T('完了 ','Done ')+(b.size/1024).toFixed(0)+' KB'+(b.note?' ('+b.note+')':''); ok++;
    }catch(e){
      it.bad=true; it.state=T('失敗','Failed'); errs.push(it.name+' : '+(e.message==='decode'?T('画像として読み込めませんでした','Could not read as an image'):e.message));
    }
    await tick();
  }
  setProg(null); busy=false; setBusy(); render(); setBusy();
  showErrs(errs);
  $('res').hidden = results.length===0;
  setStatus(EN?((cancelled?'Cancelled. ':'Finished. ')+ok+' converted'+(errs.length?', '+errs.length+' failed':'')+'.'):((cancelled?'中止しました。':'完了しました。')+'成功 '+ok+' 枚'+(errs.length?'、失敗 '+errs.length+' 枚':'')+'。'));
}

/* ---------- ZIP(保存のみ) ---------- */
var CRC=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(u8){var c=0xFFFFFFFF;for(var i=0;i<u8.length;i++)c=CRC[(c^u8[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function dosTime(ms){
  var d=new Date(ms||Date.now()); var y=d.getFullYear(); if(y<1980){y=1980;}
  return {t:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), d:((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};
}
async function buildZip(entries){
  var parts=[], central=[], offset=0, enc=new TextEncoder();
  for(var i=0;i<entries.length;i++){
    var e=entries[i], nm=enc.encode(e.name), buf=new Uint8Array(await e.blob.arrayBuffer());
    var crc=crc32(buf), tm=dosTime(e.mtime), size=buf.length;
    var lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,0,true);
    lh.setUint16(10,tm.t,true); lh.setUint16(12,tm.d,true); lh.setUint32(14,crc,true);
    lh.setUint32(18,size,true); lh.setUint32(22,size,true); lh.setUint16(26,nm.length,true); lh.setUint16(28,0,true);
    parts.push(lh.buffer,nm,buf);
    var ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
    ch.setUint16(12,tm.t,true); ch.setUint16(14,tm.d,true); ch.setUint32(16,crc,true);
    ch.setUint32(20,size,true); ch.setUint32(24,size,true); ch.setUint16(28,nm.length,true);
    ch.setUint32(42,offset,true);
    central.push(ch.buffer,nm);
    offset+=30+nm.length+size;
    if(i%3===2) await tick();
  }
  var csize=0; central.forEach(function(p){csize+=p.byteLength;});
  var end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,entries.length,true); end.setUint16(10,entries.length,true);
  end.setUint32(12,csize,true); end.setUint32(16,offset,true);
  return new Blob(parts.concat(central,[end.buffer]),{type:'application/zip'});
}
async function dlZip(){
  if(busy||!results.length) return;
  var total=0; results.forEach(function(r){total+=r.blob.size;});
  if(total>3.9e9){ showErrs([T('合計サイズがZIPの上限(約4GB)を超えます。分けて処理してください。','The total size exceeds the ZIP limit (about 4 GB). Please process in smaller batches.')]); return; }
  busy=true; setBusy(); setStatus(T('ZIPを作成中…','Building ZIP...'));
  try{
    var zip=await buildZip(results);
    var url=URL.createObjectURL(zip), a=document.createElement('a');
    a.href=url; a.download='converted.zip'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},60000);
    setStatus(T(results.length+'枚をZIPにしました('+(zip.size/1048576).toFixed(1)+' MB)。ダウンロードを確認してください。',results.length+' file(s) zipped ('+(zip.size/1048576).toFixed(1)+' MB). Check your downloads.'));
  } finally { busy=false; setBusy(); }
}

/* ---------- イベント ---------- */
$('pick').onclick=function(){$('file').click();};
$('file').onchange=function(){ var l=Array.prototype.slice.call(this.files); this.value=''; addFiles(l); };
var dz=$('drop');
['dragenter','dragover'].forEach(function(n){dz.addEventListener(n,function(e){e.preventDefault();dz.classList.add('over');});});
['dragleave','drop'].forEach(function(n){dz.addEventListener(n,function(e){e.preventDefault();dz.classList.remove('over');});});
dz.addEventListener('drop',function(e){ if(e.dataTransfer&&e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
$('go').onclick=run;
$('cancel').onclick=function(){cancelled=true; setStatus(T('中止しています…','Cancelling...'));};
$('dlzip').onclick=dlZip;
$('clear').onclick=function(){ items=[]; freeResults(); showErrs([]); render(); setStatus(T('すべて外しました。','All files removed.')); };
['fmt','quality','edge','bg'].forEach(function(id){ $(id).addEventListener('input',function(){ update(); }); $(id).addEventListener('change',function(){ update(); if(results.length) { freeResults(); render(); setStatus(T('設定を変えたので、もう一度「変換する」を押してください。','Settings changed. Press "Convert" again.')); } }); });
update(); render(); detect();
})();
