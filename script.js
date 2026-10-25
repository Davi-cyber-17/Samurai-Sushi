const $=id=>document.getElementById(id);
const COL=['#00e5ff','#ff2d95','#39ff88','#ffd23f'];
const CNAME=['Ciano','Magenta','Verde','Âmbar'];
const SIDE=['bottom','top','left','right'];      // lado da tela de cada jogador (controle local)
const PANG=[90,-90,180,0];                       // direção do assento de cada jogador no prato (graus, y para baixo)
const A=1120,CX=560,CY=560,PR=430;               // arena lógica quadrada; prato com raio PR
const BASE=515,ARC=160,RO=335,RI=215,REST=395;   // base dos hashis, alcance (graus), raio dos pratos, raio de repouso
const GRAB_T=.38,INTRO=2.4;
const FONT='"Orbitron","Segoe UI",system-ui,sans-serif';
const ITC={1:'#ff7a59',2:'#ff3d6b',3:'#ffb067',4:'#39ff88',5:'#ffd23f',9:'#7dff4f'};

/* Fases. out/inn = itens no prato externo/interno; haz = wasabis (armadilhas);
   mul = velocidade; tol = tolerância de mira (graus); win = pontos para vencer a fase. */
const LV=[
  {name:'Esteira Zen',     tip:'Toque na hora certa!',     out:4, inn:0,haz:0,mul:1,   tol:18,win:5, stun:.9, types:[1,2],        bot:{react:1.6,err:.12}},
  {name:'Hora do Rush',    tip:'Mais pratos, mais velocidade',out:6, inn:0,haz:0,mul:1.2, tol:15,win:6, stun:1,  types:[1,2,3],      bot:{react:2.0,err:.10}},
  {name:'Alerta Wasabi',   tip:'Não pegue o wasabi!',        out:8, inn:0,haz:1,mul:1.4, tol:13,win:7, stun:1.1,types:[1,2,3,4],    bot:{react:2.4,err:.09}},
  {name:'Duplo Giro',      tip:'Dois pratos, sentidos opostos',out:9,inn:5,haz:2,mul:1.6, tol:11,win:9, stun:1.2,types:[1,2,3,4,5],  bot:{react:2.8,err:.08}},
  {name:'O Último Sashimi',tip:'Pegue o último do prato!',   out:11,inn:7,haz:3,mul:1.85,tol:9, win:11,stun:1.3,types:[1,2,3,4,5],  bot:{react:3.2,err:.07}}
];

/* Servidores ICE: ajudam a conectar celular (4G) com computador (Wi-Fi).
   Os TURN abaixo são públicos/gratuitos; para uso sério, coloque o seu. */
const PEER_CFG={debug:0,config:{iceServers:[
  {urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:global.stun.twilio.com:3478'},
  {urls:['turn:openrelay.metered.ca:80','turn:openrelay.metered.ca:443','turns:openrelay.metered.ca:443?transport=tcp'],username:'openrelayproject',credential:'openrelayproject'}
]}};
const PREFIX='tlsashimi-';

let mode=null,G=null,me=0,isHost=false,started=false,peer=null,conns=[],hostConn=null,endShown=false,endT=0,lastSend=0,roomCode='';
let startLv=0,viewRot=0,rails=[],FX=[];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rad=d=>d*Math.PI/180;
const ease=t=>t*t*(3-2*t);
function angDiff(a,b){return ((a-b)%360+540)%360-180}
function norm(a){return ((a%360)+360)%360}

function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('on',s.id===id));
  const playing=id==='none';
  $('exitBtn').classList.toggle('on',playing);
  $('hud').classList.toggle('on',playing);
  $('rails').classList.toggle('on',playing);
}
function toMenu(){
  try{peer&&peer.destroy()}catch(e){}
  peer=null;conns=[];hostConn=null;mode=null;G=null;started=false;isHost=false;roomCode='';
  rails=[];$('rails').innerHTML='';FX=[];viewRot=0;
  $('onMsg').textContent='';show('menu');
}
function setHud(){
  if(!G){$('hud').textContent='';return}
  $('hud').innerHTML='FASE <b>'+(G.lv+1)+'</b>/'+LV.length+' · META <b>'+LV[G.lv].win+'</b>'+(mode==='online'?' · SALA <b>'+roomCode+'</b>':'');
}
function buildLvRow(){
  const row=$('lvRow');row.innerHTML='';
  LV.forEach((l,i)=>{
    const b=document.createElement('button');b.textContent=i+1;b.title=l.name;b.className=i===startLv?'sel':'';
    b.onclick=()=>{startLv=i;buildLvRow()};row.appendChild(b);
  });
  $('lvName').textContent=LV[startLv].name;
}
buildLvRow();

/* ---------- lógica (host / local) ---------- */
function randType(c){
  const pool=c.types.filter(t=>t!==5);
  if(c.types.includes(5)&&Math.random()<.12)return 5;
  return pool[Math.floor(Math.random()*pool.length)];
}
function fillPlate(){
  const c=LV[G.lv],sz=[c.out,c.inn],slots=[];
  G.rings.forEach((r,k)=>{r.it=[];for(let i=0;i<sz[k];i++){r.it.push(randType(c));slots.push([k,i])}});
  for(let h=0;h<c.haz&&slots.length>2;h++){
    const [k,i]=slots.splice(Math.floor(Math.random()*slots.length),1)[0];G.rings[k].it[i]=9;
  }
}
function newGame(n,bots,lv,prev,humans){
  const c=LV[lv];
  G={lv,n,bots:bots||[],humans:humans||n,rings:[{ang:0,it:[]}],spd:70*c.mul,tgt:70*c.mul,tm:2,
     scores:[0,0,0,0],stun:[0,0,0,0],anim:[0,0,0,0],aim:PANG.slice(),hit:[-1,-1,-1,-1],
     over:-1,intro:INTRO,flash:0,wins:prev?prev.wins.slice():[0,0,0,0],tot:prev?prev.tot.slice():[0,0,0,0],
     botT:[0,0,0,0],botTg:[null,null,null,null]};
  if(c.inn)G.rings.push({ang:0,it:[]});
  fillPlate();
  endShown=false;endT=0;FX.length=0;
}
const edibleLeft=()=>G.rings.some(r=>r.it.some(t=>t>0&&t!==9));
function itemPos(k,i){
  const r=G.rings[k],N=r.it.length,R=k?RI:RO,a=rad(r.ang+i*360/N);
  return [CX+R*Math.cos(a),CY+R*Math.sin(a)];
}
function burst(k,i,t){
  const [x,y]=itemPos(k,i),col=ITC[t];
  for(let j=0;j<14;j++){
    const a=Math.random()*Math.PI*2,s=140+Math.random()*320;
    FX.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.6,max:.6,r:5+Math.random()*7,col});
  }
  FX.push({x,y,vx:0,vy:-90,life:1,max:1,txt:t===9?'!':(t===5?'+2':'+1'),col:t===9?'#ff5555':'#fff'});
}
function endLevel(w){
  G.over=w;G.wins[w]++;
  for(let p=0;p<G.n;p++)G.tot[p]+=G.scores[p];
}
/* item que está dentro da zona fixa do jogador p (o mais próximo do centro da zona) */
function reach(p){
  const c=LV[G.lv],a=PANG[p];
  let best=null,bd=1e9;
  G.rings.forEach((r,k)=>{
    const N=r.it.length,tol=c.tol*(k?1.3:1);
    for(let i=0;i<N;i++){
      if(!r.it[i])continue;
      const d=Math.abs(angDiff(r.ang+i*360/N,a))/tol;
      if(d<=1&&d<bd){bd=d;best=[k,i]}
    }
  });
  return best?{k:best[0],i:best[1],d:bd}:null;
}
function grab(p){
  if(!G||G.over>=0||G.intro>0||p>=G.n||G.stun[p]>0||G.anim[p]>.15)return;
  const c=LV[G.lv];
  G.anim[p]=GRAB_T;
  const r0=reach(p),best=r0&&[r0.k,r0.i];
  if(!best){G.hit[p]=-1;G.stun[p]=c.stun;return}
  const [k,i]=best,t=G.rings[k].it[i];
  burst(k,i,t);
  G.rings[k].it[i]=0;G.hit[p]=k;
  if(t===9){                                   // wasabi: trava mais tempo e, nas fases difíceis, tira ponto
    G.stun[p]=c.stun*1.6;
    if(G.lv>=3&&G.scores[p]>0)G.scores[p]--;
    return;
  }
  G.scores[p]+=t===5?2:1;
  if(!edibleLeft()){G.scores[p]++;fillPlate();G.flash=.6}   // o último do prato vale +1
  if(G.scores[p]>=c.win)endLevel(p);
}
function spinRings(s,dt){
  G.rings[0].ang=norm(G.rings[0].ang+s*dt);
  if(G.rings[1])G.rings[1].ang=norm(G.rings[1].ang-s*.8*dt);
}
function botThink(b,dt){
  const bt=LV[G.lv].bot;
  if(G.stun[b]>0||G.anim[b]>.05)return;
  const tg=reach(b);
  // item bom bem no meio da zona: o robô reage com um pouco de atraso
  if(tg&&G.rings[tg.k].it[tg.i]!==9&&tg.d<.75&&Math.random()<dt*bt.react)grab(b);
  else if(Math.random()<dt*bt.err)grab(b);   // erro humano: toque fora de hora
}
function step(dt){
  const c=LV[G.lv];
  if(G.intro>0){G.intro-=dt;spinRings(G.spd*.35,dt);return}
  G.flash=Math.max(0,G.flash-dt);
  G.tm-=dt;
  if(G.tm<=0){
    G.tm=(1.2+Math.random()*2.2)/(1+G.lv*.18);
    G.tgt=(Math.random()<.45?-1:1)*Math.sign(G.tgt||1)*(45+Math.random()*95)*c.mul;
  }
  G.spd+=(G.tgt-G.spd)*Math.min(1,dt*2.5);
  spinRings(G.spd,dt);
  for(let p=0;p<4;p++){G.stun[p]=Math.max(0,G.stun[p]-dt);G.anim[p]=Math.max(0,G.anim[p]-dt)}
  for(const b of G.bots)botThink(b,dt);
}

/* ---------- fases / campanha ---------- */
function goLevel(lv,prev){
  const n=G.n,b=G.bots,h=G.humans;
  newGame(n,b,lv,prev,h);
  $('end').classList.remove('on');
    setHud();
  if(mode==='online'&&isHost)broadcast({t:'start',n,lv,wins:G.wins,tot:G.tot});
}
function advance(){
  if(!G||G.over<0||!(mode==='local'||isHost))return;
  const solo=mode==='local'&&G.humans===1,last=G.lv>=LV.length-1,prev={wins:G.wins,tot:G.tot};
  if(solo){
    if(G.over===0&&!last)goLevel(G.lv+1,prev);
    else if(G.over!==0)goLevel(G.lv,prev);
  }else if(!last)goLevel(G.lv+1,prev);
}
function restartCampaign(){
  if(!G||!(mode==='local'||isHost))return;
  goLevel(startLv,null);
}
function champion(){
  let b=0;
  for(let p=1;p<G.n;p++)if(G.wins[p]>G.wins[b]||(G.wins[p]===G.wins[b]&&G.tot[p]>G.tot[b]))b=p;
  return b;
}
function showEnd(){
  const ctl=mode==='local'||isHost,solo=mode==='local'&&G.humans===1;
  const t=[...Array(G.n)].map((_,p)=>G.tot[p]),mx=Math.max(...t),ws=t.map((v,p)=>v===mx?p:-1).filter(p=>p>=0);
  let title,col;
  if(ws.length>1){title='Empate!';col='#ffffff'}
  else{
    const w=ws[0];col=COL[w];
    title=solo?(w===0?'Você venceu o jogo!':'O robô venceu o jogo'):(mode==='online'&&w===me?'Você venceu o jogo!':'Campeão: '+CNAME[w]+'!');
  }
  const sub='Pontos totais: '+t.map((v,p)=>(solo&&p===1?'Robô':CNAME[p])+' '+v).join(' · ');
  $('endTxt').textContent=title;$('endTxt').style.color=col;$('endTxt').style.textShadow='0 0 16px '+col;
  $('endSub').textContent=sub;
  $('nextBtn').style.display='none';
  $('again').style.display=ctl?'':'none';
  $('endWait').textContent=ctl?'':'Aguardando o host...';
  $('end').classList.add('on');
}

/* ---------- modo local ---------- */
function startLocal(n){
  mode='local';started=true;
  if(n===1)newGame(2,[1],startLv,null,1);else newGame(n,[],startLv,null,n);
  beginPlay([...Array(G.humans)].map((_,p)=>({p,side:SIDE[p]})),0);
}
function beginPlay(list,rot){
  viewRot=rot||0;buildRails(list);setHud();show('none');layout();
}

/* ---------- modo online (PeerJS, salas por código) ---------- */
function randCode(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ';let s='';for(let i=0;i<4;i++)s+=a[Math.floor(Math.random()*a.length)];return s}
function broadcast(m){conns.forEach(c=>{try{c.send(m)}catch(e){}})}
function drawDots(n){
  $('dots').innerHTML='';
  for(let i=0;i<4;i++){
    const d=document.createElement('div');d.className='dot'+(i<n?' on':'')+(i===me?' me':'');d.style.color=COL[i];$('dots').appendChild(d);
  }
  $('lobMsg').textContent=n+'/4 jogadores · '+(isHost?(n<2?'aguardando amigos...':'pronto para começar'):'aguardando o host iniciar')+' · você é '+CNAME[me];
  $('startBtn').style.display=isHost?'':'none';
  $('startBtn').disabled=n<2;
}
function copyLink(){
  const url=location.origin+location.pathname+'?sala='+roomCode;
  const done=()=>{$('copyBtn').textContent='Link copiado!';setTimeout(()=>$('copyBtn').textContent='Copiar link de convite',1800)};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url).then(done,()=>prompt('Copie o link:',url));
  else prompt('Copie o link:',url);
}
function hostRoom(){
  if(typeof Peer==='undefined'){$('onMsg').textContent='Biblioteca online não carregou. Verifique sua conexão.';return}
  const code=randCode();
  mode='online';isHost=true;started=false;me=0;conns=[];roomCode=code;
  $('onMsg').textContent='Criando sala...';
  peer=new Peer(PREFIX+code,PEER_CFG);
  peer.on('open',()=>{$('roomCode').textContent=code;$('onMsg').textContent='';drawDots(1);show('lobby')});
  peer.on('disconnected',()=>{try{peer.reconnect()}catch(e){}});
  peer.on('error',e=>{
    if(e.type==='unavailable-id'){try{peer.destroy()}catch(x){}hostRoom()}
    else{toMenu();show('online');$('onMsg').textContent='Erro ao criar sala. Tente de novo.'}
  });
  peer.on('connection',c=>{
    c.on('open',()=>{
      if(started||conns.length>=3){c.send({t:'full'});setTimeout(()=>c.close(),300);return}
      conns.push(c);c.slot=conns.length;c.send({t:'you',slot:c.slot});
      broadcast({t:'lobby',n:1+conns.length});drawDots(1+conns.length);
    });
    c.on('data',d=>{
      if(!d||!G||!started||c.slot===undefined)return;
      if(d.t==='grab')grab(c.slot);
    });
    c.on('close',()=>{
      if(!conns.includes(c))return;
      conns=conns.filter(x=>x!==c);
      if(!started){conns.forEach((x,i)=>{x.slot=i+1;x.send({t:'you',slot:i+1})});broadcast({t:'lobby',n:1+conns.length});drawDots(1+conns.length)}
    });
  });
}
function hostStart(){
  if(conns.length<1)return;
  started=true;newGame(1+conns.length,[],startLv,null);
  broadcast({t:'start',n:G.n,lv:G.lv,wins:G.wins,tot:G.tot});
  beginPlay([{p:0,side:'bottom'}],0);
}
function onStart(d){
  newGame(d.n,[],d.lv,{wins:d.wins,tot:d.tot});started=true;
  $('end').classList.remove('on');
  beginPlay([{p:me,side:'bottom'}],90-PANG[me]);
}
function applyState(s){
  s.r.forEach((rs,k)=>{
    const r=G.rings[k];if(!r)return;
    for(let i=0;i<rs.it.length;i++)if(r.it[i]>0&&!rs.it[i])burst(k,i,r.it[i]);
    r.it=rs.it;r.ang=rs.a;
  });
  G.spd=s.spd;G.scores=s.sc;G.stun=s.st;G.anim=s.an;G.hit=s.hi;
  G.over=s.ov;G.intro=s['in'];G.flash=s.fl;G.wins=s.wn;G.tot=s.tt;
}
function joinRoom(){
  const code=$('codeIn').value.trim().toUpperCase();
  if(code.length!==4){$('onMsg').textContent='Digite o código de 4 letras.';return}
  if(typeof Peer==='undefined'){$('onMsg').textContent='Biblioteca online não carregou. Verifique sua conexão.';return}
  mode='online';isHost=false;roomCode=code;$('onMsg').textContent='Conectando...';
  peer=new Peer(PEER_CFG);
  let ok=false;
  const fail=m=>{if(ok)return;try{peer.destroy()}catch(e){}peer=null;mode=null;$('onMsg').textContent=m};
  setTimeout(()=>fail('Sala não encontrada ou conexão bloqueada.'),12000);
  peer.on('error',()=>fail('Sala não encontrada.'));
  peer.on('open',()=>{
    hostConn=peer.connect(PREFIX+code,{reliable:true});
    hostConn.on('open',()=>{ok=true;$('roomCode').textContent=code;drawDots(1);show('lobby')});
    hostConn.on('data',d=>{
      if(d.t==='you'){me=d.slot}
      else if(d.t==='lobby')drawDots(d.n);
      else if(d.t==='full'){ok=false;fail('Sala cheia ou partida em andamento.');show('online')}
      else if(d.t==='start')onStart(d);
      else if(d.t==='state'&&G)applyState(d.s);
    });
    hostConn.on('close',()=>{if(mode==='online'&&!isHost){toMenu();show('online');$('onMsg').textContent='O host saiu da sala.'}});
  });
}
(function(){ // link de convite ?sala=ABCD
  const s=new URLSearchParams(location.search).get('sala');
  if(s){$('codeIn').value=s.slice(0,4).toUpperCase();show('online')}
})();

/* ---------- controles: um botão de toque por jogador (a mesa gira, os hashis ficam parados) ---------- */
function buildRails(list){
  const box=$('rails');box.innerHTML='';rails=[];
  list.forEach(({p,side})=>{
    const el=document.createElement('div');el.className='rail';el.style.setProperty('--pc',COL[p]);
    el.innerHTML='<div class="rin"><div class="rbadge"><span class="rn"></span><b class="rs"></b><i class="rw"></i></div>'+
      '<div class="rtrack"><span class="rhint"></span></div></div>';
    box.appendChild(el);
    const r={p,side,el,rin:el.firstChild,track:el.querySelector('.rtrack'),
      sc:el.querySelector('.rs'),nm:el.querySelector('.rn'),wn:el.querySelector('.rw'),hint:el.querySelector('.rhint'),
      stun:null,txt:'',wtxt:'',htxt:'',cmp:false,down:null};
    r.base=mode==='online'?'VOCÊ':'P'+(p+1);r.nm.textContent=r.base;
    bindRail(r);rails.push(r);
  });
}
function bindRail(r){
  const el=r.el;
  el.addEventListener('pointerdown',e=>{
    e.preventDefault();
    if(r.down===null){r.down=e.pointerId;el.classList.add('press');fire(r.p)}   // pega no instante do toque
  });
  const up=e=>{if(r.down===e.pointerId){r.down=null;el.classList.remove('press')}};
  el.addEventListener('pointerup',up);
  el.addEventListener('pointercancel',up);
  el.addEventListener('pointerleave',up);
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
function fire(p){
  if(!G||G.over>=0)return;
  if(mode==='online'&&!isHost){
    if(hostConn&&hostConn.open){
      hostConn.send({t:'grab'});
      if(G.stun[me]<=0&&G.anim[me]<=.15&&G.intro<=0)G.anim[me]=GRAB_T;
    }
  }else grab(p);
}
function updateRails(){
  if(!G)return;
  const c=LV[G.lv];
  for(const r of rails){
    const p=r.p,tot=String(G.tot[p]+G.scores[p]),wt=r.base+' '+G.scores[p]+'/'+c.win;
    if(r.txt!==tot){r.txt=tot;r.sc.textContent=tot}
    if(r.wtxt!==wt){r.wtxt=wt;r.nm.textContent=wt}
    if(!r.wn.textContent)r.wn.textContent='PTS';
    const st=G.stun[p]>0;
    if(st!==r.stun){r.stun=st;r.el.classList.toggle('stun',st)}
    const ht=st?'TRAVADO!':(r.cmp?'PEGAR':'TOQUE PARA PEGAR');
    if(r.htxt!==ht){r.htxt=ht;r.hint.textContent=ht}
  }
}

/* teclado: cada jogador tem uma tecla de pegar */
const KM={KeyS:0,KeyK:1,ArrowDown:2,Numpad5:3};
function keyMap(code){
  const single=mode==='online'||(mode==='local'&&G&&G.humans===1);
  if(single){
    if(code==='KeyS'||code==='ArrowDown'||code==='Space'||code==='Enter')return mode==='online'?me:0;
    return null;
  }
  const p=KM[code];return p!==undefined&&G&&p<G.humans?p:null;
}
addEventListener('keydown',e=>{
  if(!G||document.querySelector('.screen.on'))return;
  const p=keyMap(e.code);if(p===null)return;
  e.preventDefault();
  if(!e.repeat)fire(p);
});

/* ---------- layout responsivo ---------- */
const cv=$('cv'),ctx=cv.getContext('2d');
if(!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){r=Math.min(r,w/2,h/2);this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath()};
}
const probe=document.createElement('div');
probe.style.cssText='position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(probe);
function insets(){const s=getComputedStyle(probe);return{t:parseFloat(s.paddingTop)||0,r:parseFloat(s.paddingRight)||0,b:parseFloat(s.paddingBottom)||0,l:parseFloat(s.paddingLeft)||0}}

let sc=1,ox=0,oy=0,dpr=1;
function layout(){
  const vv=window.visualViewport;
  const W=Math.round(vv?vv.width:innerWidth),H=Math.round(vv?vv.height:innerHeight);
  dpr=Math.min(window.devicePixelRatio||1,2.5);
  cv.width=Math.round(innerWidth*dpr);cv.height=Math.round(innerHeight*dpr);
  const ins=insets(),m=Math.min(W,H);
  const T=Math.round(clamp(m*.125,46,84)),pad=Math.round(clamp(m*.015,6,14)),topH=H<520?26:38;
  const has={bottom:0,top:0,left:0,right:0};
  rails.forEach(r=>has[r.side]=1);
  const x0=ins.l+pad+(has.left?T+pad:0),x1=W-ins.r-pad-(has.right?T+pad:0);
  const y0=ins.t+topH+(has.top?T+pad:0),y1=H-ins.b-pad-(has.bottom?T+pad:0);
  const S=Math.max(140,Math.floor(Math.min(x1-x0,y1-y0)));
  const cx=(x0+x1)/2,cy=(y0+y1)/2,sx=Math.round(cx-S/2),sy=Math.round(cy-S/2);
  sc=S/A;ox=sx;oy=sy;
  $('rails').style.setProperty('--T',T+'px');
  const wide=Math.round(Math.min(W-ins.l-ins.r-2*pad,Math.max(S,Math.min(W*.62,S*1.9))));
  for(const r of rails){
    let x,y,w,h,L;
    if(r.side==='bottom'||r.side==='top'){
      w=wide;h=T;L=wide;x=Math.round(cx-wide/2);y=r.side==='bottom'?sy+S+pad:sy-pad-T;
    }else{
      w=T;h=S;L=S;y=sy;x=r.side==='left'?sx-pad-T:sx+S+pad;
    }
    const e=r.el.style;e.left=x+'px';e.top=y+'px';e.width=w+'px';e.height=h+'px';
    r.rin.style.width=L+'px';r.rin.style.height=T+'px';
    r.rin.style.transform='translate(-50%,-50%)'+(r.side==='top'?' rotate(180deg)':r.side==='left'?' rotate(90deg)':r.side==='right'?' rotate(-90deg)':'');
    r.cmp=L<330;r.rin.classList.toggle('cmp',r.cmp);
  }
}
addEventListener('resize',layout);
addEventListener('orientationchange',()=>{setTimeout(layout,150);setTimeout(layout,500)});
if(window.visualViewport)window.visualViewport.addEventListener('resize',layout);
layout();

/* ---------- desenho ---------- */
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function glow(c,b){ctx.shadowColor=c;ctx.shadowBlur=b}
function noGlow(){ctx.shadowBlur=0}
function toView(x,y){
  if(!viewRot)return[x,y];
  const r=rad(viewRot),c=Math.cos(r),s=Math.sin(r),dx=x-CX,dy=y-CY;
  return[CX+dx*c-dy*s,CY+dx*s+dy*c];
}
function drawPlate(){
  const R=PR,ang=G.rings[0].ang;
  const g=ctx.createRadialGradient(CX,CY,100,CX,CY,R);g.addColorStop(0,'#141b36');g.addColorStop(1,'#0a0f22');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,R,0,7);ctx.fill();
  for(let k=0;k<12;k++){
    const a0=rad(ang+k*30);
    ctx.fillStyle=k%2?'rgba(0,229,255,.05)':'rgba(255,45,149,.05)';
    ctx.beginPath();ctx.moveTo(CX,CY);ctx.arc(CX,CY,R-14,a0,a0+Math.PI/6);ctx.closePath();ctx.fill();
  }
  if(G.rings[1]){ // trilho do prato interno (gira ao contrário)
    ctx.strokeStyle='rgba(255,45,149,.25)';ctx.lineWidth=3;ctx.setLineDash([8,12]);
    ctx.beginPath();ctx.arc(CX,CY,RI+60,0,7);ctx.stroke();ctx.setLineDash([]);
  }
  ctx.strokeStyle='rgba(0,229,255,.55)';ctx.lineWidth=4;
  for(let k=0;k<72;k++){
    const a=rad(ang+k*5),r1=R-(k%6?20:34);
    ctx.beginPath();ctx.moveTo(CX+r1*Math.cos(a),CY+r1*Math.sin(a));ctx.lineTo(CX+(R-8)*Math.cos(a),CY+(R-8)*Math.sin(a));ctx.stroke();
  }
  glow('#00e5ff',30);ctx.strokeStyle='#00e5ff';ctx.lineWidth=7;ctx.beginPath();ctx.arc(CX,CY,R,0,7);ctx.stroke();
  glow('#ff2d95',24);ctx.strokeStyle='#ff2d95';ctx.lineWidth=6;ctx.fillStyle='#04060f';
  ctx.beginPath();ctx.arc(CX,CY,125,0,7);ctx.fill();ctx.stroke();noGlow();
  if(G.flash>0){ctx.fillStyle='rgba(255,255,255,'+(G.flash*.35).toFixed(3)+')';ctx.beginPath();ctx.arc(CX,CY,R,0,7);ctx.fill()}
  // zona de acerto fixa de cada jogador (o que passar aqui na hora do toque é pego)
  ctx.lineCap='butt';
  const tz=LV[G.lv].tol;
  for(let p=0;p<G.n;p++){
    ctx.strokeStyle=COL[p];ctx.globalAlpha=G.stun[p]>0?.12:.45;ctx.lineWidth=10;
    ctx.beginPath();ctx.arc(CX,CY,R+22,rad(PANG[p]-tz),rad(PANG[p]+tz));ctx.stroke();
    ctx.globalAlpha=G.stun[p]>0?.04:.10;ctx.fillStyle=COL[p];
    ctx.beginPath();ctx.moveTo(CX,CY);ctx.arc(CX,CY,R-14,rad(PANG[p]-tz),rad(PANG[p]+tz));ctx.closePath();ctx.fill();
  }
  ctx.globalAlpha=1;
}
function stripes(x,y,w,h,r){
  ctx.save();rr(x,y,w,h,r);ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,.26)';ctx.lineWidth=6;
  for(let i=x-60;i<x+w+60;i+=28){ctx.beginPath();ctx.moveTo(i,y+h+10);ctx.lineTo(i+54,y-10);ctx.stroke()}
  ctx.restore();
}
function outline(x,y,w,h,r){ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=3;rr(x,y,w,h,r);ctx.stroke()}
function slab(c0,c1,gc){
  glow(gc,16);const g=ctx.createLinearGradient(-75,-48,75,48);g.addColorStop(0,c0);g.addColorStop(1,c1);
  ctx.fillStyle=g;rr(-75,-48,150,96,30);ctx.fill();noGlow();
  stripes(-75,-48,150,96,30);outline(-75,-48,150,96,30);
}
function nigiri(c0,c1,gc,label){
  ctx.fillStyle='#eef3ff';rr(-60,-18,120,62,24);ctx.fill();
  ctx.fillStyle='rgba(120,140,190,.28)';rr(-50,26,100,14,7);ctx.fill();
  outline(-60,-18,120,62,24);
  glow(gc,16);const g=ctx.createLinearGradient(-72,-54,72,0);g.addColorStop(0,c0);g.addColorStop(1,c1);
  ctx.fillStyle=g;rr(-72,-54,144,56,24);ctx.fill();noGlow();
  stripes(-72,-54,144,56,24);outline(-72,-54,144,56,24);
  if(label){ctx.fillStyle='#3a2a00';ctx.font='900 28px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,0,-26)}
}
function maki(){
  glow('#39ff88',14);ctx.fillStyle='#0b1118';ctx.beginPath();ctx.arc(0,0,46,0,7);ctx.fill();noGlow();
  ctx.strokeStyle='#39ff88';ctx.lineWidth=3;ctx.stroke();
  ctx.fillStyle='#f3f7ff';ctx.beginPath();ctx.arc(0,0,33,0,7);ctx.fill();
  ctx.fillStyle='#39ff88';ctx.beginPath();ctx.arc(0,0,15,0,7);ctx.fill();
  ctx.fillStyle='#ff7a59';ctx.beginPath();ctx.arc(0,0,7,0,7);ctx.fill();
}
function wasabi(){
  const pu=1+.07*Math.sin(performance.now()/120);ctx.scale(pu,pu);
  glow('#ff2d2d',20);
  ctx.beginPath();
  for(let j=0;j<24;j++){const a=j*Math.PI/12,r=j%2?36:50;ctx[j?'lineTo':'moveTo'](r*Math.cos(a),r*Math.sin(a))}
  ctx.closePath();
  const g=ctx.createRadialGradient(-8,-10,4,0,0,50);g.addColorStop(0,'#b8ff6a');g.addColorStop(1,'#1f8f2f');
  ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#ff3b3b';ctx.lineWidth=4;ctx.stroke();noGlow();
  ctx.fillStyle='#7a0000';ctx.font='900 40px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('!',0,3);
}
function drawItem(t,k,i,N){
  const r=G.rings[k],R=k?RI:RO,a=rad(r.ang+i*360/N);
  const ks=Math.min(1,(2*Math.PI*R/N)*.82/150,k?.9:1);
  ctx.save();ctx.translate(CX+R*Math.cos(a),CY+R*Math.sin(a));ctx.rotate(a+Math.PI/2);ctx.scale(ks,ks);
  if(t===1)slab('#ffb067','#ff4f7b','#ff7a59');
  else if(t===2)slab('#ff7a8a','#a8123a','#ff3d6b');
  else if(t===3)nigiri('#ffb067','#ff4f7b','#ff7a59');
  else if(t===4)maki();
  else if(t===5)nigiri('#fff3a0','#ffb100','#ffd23f','x2');
  else if(t===9)wasabi();
  ctx.restore();
}
function drawHashi(p){
  const c=COL[p],sa=rad(PANG[p]),ux=Math.cos(sa),uy=Math.sin(sa);
  const bx=CX+BASE*ux,by=CY+BASE*uy,a=rad(G.aim[p]),vx=Math.cos(a),vy=Math.sin(a),dead=G.stun[p]>0;
  let rd=REST,gap=30;
  if(G.anim[p]>0){
    const t=1-G.anim[p]/GRAB_T,h=G.hit[p],tr=h===0?RO:h===1?RI:RO+22;
    const e=t<.4?ease(t/.4):t<.6?1:1-ease((t-.6)/.4);
    rd=REST+(tr-REST)*e;gap=8+22*Math.abs(1-2*t);
  }
  const tx=CX+rd*vx,ty=CY+rd*vy,nx=-uy,ny=ux,mx=-vy,my=vx;
  // marcador na borda do prato
  ctx.globalAlpha=dead?.3:1;
  glow(c,18);ctx.strokeStyle='#fff';ctx.lineWidth=10;ctx.lineCap='round';
  ctx.beginPath();ctx.arc(CX,CY,PR+22,rad(G.aim[p]-2.6),rad(G.aim[p]+2.6));ctx.stroke();noGlow();
  // guia de pontaria
  ctx.setLineDash([10,14]);ctx.strokeStyle=c;ctx.globalAlpha=dead?.1:.28;ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(CX+150*vx,CY+150*vy);ctx.stroke();ctx.setLineDash([]);
  ctx.globalAlpha=dead?.45:1;
  // base
  glow(c,22);ctx.fillStyle='#070b1a';ctx.strokeStyle=c;ctx.lineWidth=6;
  ctx.beginPath();ctx.arc(bx,by,44,0,7);ctx.fill();ctx.stroke();noGlow();
  const bg=ctx.createRadialGradient(bx-10,by-12,4,bx,by,34);bg.addColorStop(0,c);bg.addColorStop(1,'rgba(0,0,0,.6)');
  ctx.fillStyle=bg;ctx.beginPath();ctx.arc(bx,by,32,0,7);ctx.fill();
  // hashis
  ctx.lineCap='round';
  for(const s of[-1,1]){
    const x0=bx+nx*s*26,y0=by+ny*s*26,x1=tx+mx*s*gap/2,y1=ty+my*s*gap/2;
    glow(c,12);ctx.strokeStyle='#e8f3ff';ctx.lineWidth=13;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();noGlow();
    ctx.strokeStyle=c;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x0+(x1-x0)*.3,y0+(y1-y0)*.3);ctx.stroke();
  }
  ctx.globalAlpha=1;
}
function drawBadge(p){
  const va=rad(PANG[p]+viewRot),ux=Math.cos(va),uy=Math.sin(va);
  const x=CX+498*ux-150*uy,y=CY+498*uy+150*ux,c=COL[p];
  const tag=mode==='online'?(p===me?'VOCÊ':'P'+(p+1)):(G.bots.includes(p)?'BOT':'P'+(p+1));
  ctx.globalAlpha=G.stun[p]>0?.5:1;
  ctx.fillStyle='rgba(6,10,24,.88)';glow(c,14);ctx.strokeStyle=c;ctx.lineWidth=4;rr(x-62,y-30,124,60,14);ctx.fill();ctx.stroke();noGlow();
  ctx.fillStyle=c;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='700 15px '+FONT;ctx.fillText(tag+' '+G.scores[p]+'/'+LV[G.lv].win,x,y-14);
  ctx.font='900 30px '+FONT;glow(c,12);ctx.fillText(G.tot[p]+G.scores[p],x,y+10);noGlow();
  ctx.globalAlpha=1;
}
function drawFx(){
  for(const f of FX){
    const [x,y]=toView(f.x,f.y);
    ctx.globalAlpha=clamp(f.life/f.max,0,1);
    if(f.txt){ctx.fillStyle=f.col;ctx.font='900 46px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';glow(f.col,14);ctx.fillText(f.txt,x,y);noGlow()}
    else{ctx.fillStyle=f.col;glow(f.col,10);ctx.beginPath();ctx.arc(x,y,f.r,0,7);ctx.fill();noGlow()}
  }
  ctx.globalAlpha=1;
}
function drawBanner(){
  const c=LV[G.lv],al=Math.min(1,G.intro/.45,(INTRO-G.intro)/.25);
  if(al<=0)return;
  ctx.globalAlpha=clamp(al,0,1);
  ctx.fillStyle='rgba(4,6,15,.85)';glow('#00e5ff',24);ctx.strokeStyle='#00e5ff';ctx.lineWidth=4;rr(CX-390,CY-135,780,270,22);ctx.fill();ctx.stroke();noGlow();
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#ff2d95';ctx.font='700 26px '+FONT;ctx.fillText('FASE '+(G.lv+1)+' DE '+LV.length,CX,CY-88);
  ctx.fillStyle='#fff';ctx.font='900 62px '+FONT;glow('#00e5ff',22);ctx.fillText(c.name.toUpperCase(),CX,CY-28);noGlow();
  ctx.fillStyle='#ffd23f';ctx.font='700 28px '+FONT;ctx.fillText(c.tip,CX,CY+38);
  ctx.fillStyle='#9fb2d8';ctx.font='700 24px '+FONT;ctx.fillText('META: '+c.win+' PONTOS',CX,CY+90);
  ctx.globalAlpha=1;
}
function drawDone(){
  const al=clamp((performance.now()-0)*0+1,0,1),w=G.over,col=COL[w];
  ctx.fillStyle='rgba(4,6,15,.85)';glow(col,24);ctx.strokeStyle=col;ctx.lineWidth=4;rr(CX-330,CY-90,660,180,22);ctx.fill();ctx.stroke();noGlow();
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#fff';ctx.font='900 48px '+FONT;ctx.fillText('FASE '+(G.lv+1)+' CONCLUÍDA',CX,CY-26);
  ctx.fillStyle=col;ctx.font='700 28px '+FONT;
  const nm=mode==='online'&&w===me?'VOCÊ':(G.bots.includes(w)?'BOT':'P'+(w+1));
  ctx.fillText(nm+' fechou a fase',CX,CY+34);
}
function draw(){
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
  if(!G)return;
  ctx.setTransform(dpr*sc,0,0,dpr*sc,dpr*ox,dpr*oy);
  ctx.save();
  if(viewRot){ctx.translate(CX,CY);ctx.rotate(rad(viewRot));ctx.translate(-CX,-CY)}
  drawPlate();
  G.rings.forEach((r,k)=>{const N=r.it.length;for(let i=0;i<N;i++)if(r.it[i])drawItem(r.it[i],k,i,N)});
  for(let p=0;p<G.n;p++)drawHashi(p);
  ctx.restore();
  // camada em pé (textos)
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#9fb2d8';ctx.font='700 20px '+FONT;ctx.fillText('FASE',CX,CY-26);
  ctx.fillStyle='#fff';glow('#ff2d95',14);ctx.font='900 58px '+FONT;ctx.fillText(G.lv+1,CX,CY+22);noGlow();
  for(let p=0;p<G.n;p++)if(!rails.some(r=>r.p===p))drawBadge(p);
  drawFx();
  if(G.intro>0)drawBanner();
  if(G.over>=0&&G.lv<LV.length-1)drawDone();
}

/* ---------- loop ---------- */
let last=performance.now();
function loop(t){
  const dt=Math.min(.05,(t-last)/1000);last=t;
  if(G&&mode){
    const auth=mode==='local'||isHost;
    if(auth){if(G.over<0&&(mode==='local'||started))step(dt)}
    else{ // cliente: extrapola entre snapshots
      if(G.intro>0)G.intro=Math.max(0,G.intro-dt);
      spinRings(G.spd*(G.intro>0?.35:1),dt);
      for(let p=0;p<4;p++){G.anim[p]=Math.max(0,G.anim[p]-dt);G.stun[p]=Math.max(0,G.stun[p]-dt)}
    }
    if(mode==='online'&&isHost&&started&&t-lastSend>45){
      lastSend=t;
      broadcast({t:'state',s:{r:G.rings.map(r=>({a:+r.ang.toFixed(2),it:r.it})),spd:G.spd,sc:G.scores,st:G.stun,an:G.anim,hi:G.hit,ov:G.over,'in':G.intro,fl:G.flash,wn:G.wins,tt:G.tot}});
    }
    for(let i=FX.length-1;i>=0;i--){
      const f=FX[i];f.life-=dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.vx*=.96;f.vy*=f.txt?1:.96;
      if(f.life<=0)FX.splice(i,1);
    }
    if(G.over>=0){
      if(!endT)endT=t;
      else if(G.lv<LV.length-1){
        if(auth&&!endShown&&t-endT>1600){endShown=true;goLevel(G.lv+1,{wins:G.wins,tot:G.tot})}
      }else if(!endShown&&t-endT>900){endShown=true;showEnd()}
    }else endT=0;
    updateRails();
  }
  draw();requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
