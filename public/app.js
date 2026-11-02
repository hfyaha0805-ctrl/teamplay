const socket = {
  handlers: {},
  ws: null,
  on(event, callback) {
    (this.handlers[event] ||= []).push(callback);
  },
  emit(event, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  },
  connect(mode, payload = {}) {
    if (this.ws) this.ws.close();
    const url = new URL("/ws", window.location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("mode", mode);
    if (payload.code) url.searchParams.set("code", payload.code);
    url.searchParams.set("name", payload.name || "玩家");
    url.searchParams.set("animal", payload.animal || "rabbit");
    this.ws = new WebSocket(url);
    this.ws.onmessage = event => {
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      (this.handlers[packet.event] || []).forEach(fn => fn(packet.data));
    };
    this.ws.onerror = () => toast("连接出现问题，请刷新页面后重试。");
    this.ws.onclose = event => {
      if (event.code !== 1000) toast("连接已断开，请刷新页面后重新加入。");
    };
  }
};
const $ = id => document.getElementById(id);
const views = ["homeView","lobbyView","initialView","gameView","revealView","finishView"];
const ROUND_MS = 30_000;
const animals = ["rabbit","fox","cat","dog","panda","bird","hamster","capybara","seal","frog","hedgehog","otter"];
const animalNames = {rabbit:"白兔",fox:"橘狐",cat:"小猫",dog:"小狗",panda:"熊猫",bird:"小鸟",hamster:"仓鼠",capybara:"水豚",seal:"海豹",frog:"青蛙",hedgehog:"刺猬",otter:"水獭"};
const animalPalette = {rabbit:["#fff3e9","#e8b8aa"],fox:["#e99a62","#f4d5b6"],cat:["#f3c47d","#e9a0a0"],dog:["#c89a75","#f1d7b5"],panda:["#fff8eb","#303b37"],bird:["#f1cf68","#e5a94e"],hamster:["#f7e4ce","#d89d84"],capybara:["#b98763","#f1d4b4"],seal:["#d8e9e9","#9fc6ca"],frog:["#a8c77d","#719b57"],hedgehog:["#d7b18a","#a87553"],otter:["#b9825d","#f0d5b7"]};
let selectedAnimal = "rabbit", room = null, myId = null, myIndex = -1, myName = "玩家 1";
let currentDraft = "", timerFrame = null, lastRoomStatus = "", revealTimeout = null;

function animalSvg(type, accent) {
  const p=animalPalette[type]||animalPalette.rabbit, base=p[0], c=accent||p[1], ink="#555b50", cream="#fff8ee";
  const shapes = {
    rabbit:'<path d="M27 35C17 10 20 2 28 5c8 3 10 20 10 30M47 35C44 13 51 4 58 10c6 7-1 22-5 28" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="45" rx="22" ry="20" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/>',
    fox:'<path d="M17 34 21 7 38 20 54 7 63 34Q63 57 40 62Q17 57 17 34Z" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><path d="M25 43Q40 34 55 43Q52 59 40 59Q28 59 25 43Z" fill="'+cream+'"/>',
    cat:'<path d="M17 34 18 7 36 21 55 7 63 34Q63 58 40 62Q17 58 17 34Z" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/>',
    dog:'<path d="M22 27Q5 13 10 39Q13 54 28 49M58 27Q75 13 70 39Q67 54 52 49" fill="'+c+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="44" rx="23" ry="21" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/>',
    panda:'<circle cx="22" cy="24" r="13" fill="'+c+'"/><circle cx="58" cy="24" r="13" fill="'+c+'"/><circle cx="40" cy="43" r="24" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="30" cy="40" rx="6" ry="8" fill="'+ink+'"/><ellipse cx="50" cy="40" rx="6" ry="8" fill="'+ink+'"/>',
    bird:'<path d="M17 47Q13 20 39 17Q66 16 64 45Q61 67 40 66Q20 64 17 47Z" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><path d="M20 49Q31 38 43 52Q32 62 20 49Z" fill="'+c+'"/><path d="m57 37 17 7-17 7Z" fill="#e6a34c" stroke="'+ink+'" stroke-width="1.8"/>',
    hamster:'<circle cx="23" cy="27" r="12" fill="'+c+'" stroke="'+ink+'" stroke-width="2"/><circle cx="57" cy="27" r="12" fill="'+c+'" stroke="'+ink+'" stroke-width="2"/><ellipse cx="40" cy="44" rx="25" ry="22" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="27" cy="49" rx="8" ry="7" fill="'+cream+'"/><ellipse cx="53" cy="49" rx="8" ry="7" fill="'+cream+'"/>',
    capybara:'<ellipse cx="25" cy="27" rx="7" ry="8" fill="'+c+'"/><ellipse cx="55" cy="27" rx="7" ry="8" fill="'+c+'"/><ellipse cx="40" cy="44" rx="25" ry="22" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="51" rx="13" ry="8" fill="'+cream+'"/>',
    seal:'<ellipse cx="40" cy="44" rx="27" ry="23" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><path d="M20 59Q10 68 8 58M60 59Q70 68 72 58" fill="none" stroke="'+c+'" stroke-width="5" stroke-linecap="round"/><ellipse cx="40" cy="51" rx="13" ry="8" fill="'+cream+'"/>',
    frog:'<circle cx="25" cy="25" r="12" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><circle cx="55" cy="25" r="12" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="47" rx="26" ry="20" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="53" rx="14" ry="9" fill="#d8e9b7"/>',
    hedgehog:'<path d="M15 48Q8 26 22 17L25 27 33 12 39 25 48 11 51 27 63 19 61 38Q64 61 40 64Q18 62 15 48Z" fill="'+c+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="47" rx="22" ry="18" fill="'+base+'" stroke="'+ink+'" stroke-width="2.2"/>',
    otter:'<circle cx="23" cy="27" r="8" fill="'+c+'" stroke="'+ink+'" stroke-width="2"/><circle cx="57" cy="27" r="8" fill="'+c+'" stroke="'+ink+'" stroke-width="2"/><ellipse cx="40" cy="44" rx="24" ry="22" fill="'+base+'" stroke="'+ink+'" stroke-width="2.5"/><ellipse cx="40" cy="52" rx="14" ry="9" fill="'+cream+'"/>'
  };
  const eyes=type==="panda"?'<circle cx="30" cy="40" r="2.2" fill="'+cream+'"/><circle cx="50" cy="40" r="2.2" fill="'+cream+'"/>':'<ellipse cx="31" cy="41" rx="2.4" ry="3.2" fill="'+ink+'"/><ellipse cx="49" cy="41" rx="2.4" ry="3.2" fill="'+ink+'"/>';
  const mouth=type==="bird"?'':'<ellipse cx="40" cy="49" rx="3.3" ry="2.5" fill="'+c+'"/><path d="M36 53Q40 57 44 53" fill="none" stroke="'+ink+'" stroke-width="1.7" stroke-linecap="round"/>';
  return '<svg viewBox="0 0 80 80" aria-hidden="true">'+(shapes[type]||shapes.rabbit)+eyes+'<circle cx="24" cy="50" r="4" fill="#e99b91" opacity=".48"/><circle cx="56" cy="50" r="4" fill="#e99b91" opacity=".48"/>'+mouth+'</svg>';
}
function showView(id) { views.forEach(v => $(v).classList.toggle("hidden", v !== id)); window.scrollTo({top:0,behavior:"smooth"}); }
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2300); }
function renderAnimalChoices() {
  $("animalChoices").innerHTML=animals.map(a=>'<button type="button" class="animal-choice '+(a===selectedAnimal?'selected':'')+'" data-animal="'+a+'" title="'+animalNames[a]+'" aria-label="选择'+animalNames[a]+'" aria-pressed="'+(a===selectedAnimal)+'">'+animalSvg(a)+'<span>'+animalNames[a]+'</span></button>').join("");
  $("animalChoices").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    if(room?.status!=="waiting")return toast("游戏开始后暂时不能更换小动物。");
    const next=b.dataset.animal;if(next===selectedAnimal)return;
    selectedAnimal=next;socket.emit("player:animal",{animal:selectedAnimal});renderAnimalChoices();
    toast(animalNames[selectedAnimal]+"加入你的队伍了！");
  }));
}
function enterRoom(code) { $("roomCode").textContent=code; showView("lobbyView"); }
function getMyPlayer() { return room?.players.find(p=>p.id===myId); }
function updateLobby() {
  if(!room)return;
  $("roomCode").textContent=room.code;
  room.players.forEach((p,i)=>{
    if(i>1)return;
    $("animal"+i).innerHTML=animalSvg(p.animal);
    $("name"+i).textContent=p.name+(p.id===myId?"（你）":"");
    $("state"+i).textContent=!p.connected?"连接中断":p.ready?"已准备":"尚未准备";
    $("slot"+i).classList.toggle("empty-slot",false);
  });
  if(room.players.length<2){$("animal1").textContent="＋";$("name1").textContent="等待玩家";$("state1").textContent="分享房间码邀请好友";$("slot1").classList.add("empty-slot");}
  const me=getMyPlayer();if(me)selectedAnimal=me.animal;
  renderAnimalChoices();
  $("readyBtn").disabled=!!me?.ready;
  $("readyBtn").textContent=me?.ready?"已准备，等待对方…":"我准备好了　↗";
  $("lobbyHint").textContent=room.players.length<2?"等待另一位玩家加入房间":room.players.every(p=>p.ready)?"双方已就绪，正在开始…":"两个人都准备好后开始游戏";
}
function renderHistory() {
  const list=room?.history||[], players=room?.players||[];
  $("historyCount").textContent=list.length+" ROUNDS";
  $("historyList").innerHTML=list.length?list.map(h=>'<div class="history-item"><small>ROUND '+String(h.round).padStart(2,"0")+'</small><div class="history-answers"><span class="history-creature">'+animalSvg(players[0]?.animal||"rabbit")+'<b>'+escapeHtml(h.words[0])+'</b></span><span class="history-dot">·</span><span class="history-creature">'+animalSvg(players[1]?.animal||"fox")+'<b>'+escapeHtml(h.words[1])+'</b></span></div></div>').join(""):'<p class="empty-history">你们的联想旅程会记录在这里。</p>';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderGame() {
  if(!room)return;
  $("roundLabel").textContent="ROUND "+String(room.round).padStart(2,"0")+" · ASSOCIATION";
  $("roundCount").textContent=String(room.round).padStart(2,"0");
  const last=room.history[room.history.length-1];
  $("promptWords").innerHTML=last?'<span class="prompt-word">'+escapeHtml(last.words[0])+'</span><span class="prompt-plus">+</span><span class="prompt-word">'+escapeHtml(last.words[1])+'</span>':"";
  const me=getMyPlayer(), other=room.players.find(p=>p.id!==myId);
  $("legend0").textContent=me?.name||"你";$("legend1").textContent=other?.name||"对方";
  $("runner0").innerHTML=animalSvg(me?.animal||"rabbit");$("runner1").innerHTML=animalSvg(other?.animal||"fox");
  $("runner0").setAttribute("aria-label",animalNames[me?.animal]||"你的动物");$("runner1").setAttribute("aria-label",animalNames[other?.animal]||"对方的动物");
  $("runner0").style.borderColor="var(--moss)";$("runner1").style.borderColor="var(--clay)";
  $("roundWord").disabled=!!me?.submitted;$("submitWord").disabled=!!me?.submitted;$("roundWord").value=currentDraft;
  $("waitingNote").textContent=me?.submitted?"你已经抵达终点，正在等对方。":"提交后，小动物会先抵达终点等你。";
  $("trackState").textContent=room.players.every(p=>p.submitted)?"即将揭晓":room.players.some(p=>p.submitted)?"一位玩家已抵达":"双方正在思考";
  renderHistory();startTrack();
}
function positionRunner(el, angle) {
  const stage=$("runner0").parentElement, size=stage.clientWidth;
  const radius=size*(132/360), center=size/2, rad=angle*Math.PI/180;
  el.style.left=(center+radius*Math.cos(rad))+"px";
  el.style.top=(center+radius*Math.sin(rad))+"px";
}
function startTrack() {
  if(timerFrame)cancelAnimationFrame(timerFrame);
  const draw=()=>{
    if(!room||room.status!=="round")return;
    const me=getMyPlayer(), other=room.players.find(p=>p.id!==myId);
    const endAt=room.roundEndsAt||room.roundStartedAt+ROUND_MS,duration=Math.max(1,endAt-room.roundStartedAt);
    const now=Date.now(),elapsed=Math.max(0,now-room.roundStartedAt),progress=Math.min(1,elapsed/duration);
    const p0=me?.submitted?1:progress,p1=other?.submitted?1:progress;
    positionRunner($("runner0"),-90+180*p0);positionRunner($("runner1"),-90-180*p1);
    const left=Math.max(0,endAt-now);
    $("countdown").innerHTML=Math.ceil(left/1000)+'<span>.'+Math.floor((left%1000)/100)+'</span>';
    $("centerSub").textContent=me?.submitted?"已抵达终点":"准备相遇";
    $("progressRing").style.strokeDashoffset=829*(1-progress);
    if(left>0)timerFrame=requestAnimationFrame(draw);
  };
  draw();
}
function showReveal() {
  if(timerFrame)cancelAnimationFrame(timerFrame);
  const r=room.reveal;if(!r)return;
  $("revealRound").textContent="ROUND "+String(r.round).padStart(2,"0");
  $("revealWords").innerHTML=r.words.map((w,i)=>{
    const p=room.players[i];
    return '<div class="reveal-word"><div class="reveal-animal">'+animalSvg(p?.animal||(i===0?"rabbit":"fox"))+'</div><small>'+escapeHtml(p?.name||("玩家 "+(i+1)))+'</small><strong>'+escapeHtml(w)+'</strong></div>';
  }).join("");
  const same=r.words[0]===r.words[1];
  $("revealTitle").textContent=same?"你们想到一起了！":"你们想到了……";
  $("revealMessage").textContent=same?"两个念头，在这里刚好重合。":"思路在这里分开了，再向前走一步。";
  showView("revealView");
}
function showFinish() {
  if(timerFrame)cancelAnimationFrame(timerFrame);
  $("finishRounds").textContent=room.winner.rounds;$("finalWord").textContent=room.winner.word;
  $("finishHistory").innerHTML=room.history.map(h=>'<div class="history-item"><small>R'+String(h.round).padStart(2,"0")+'</small><div class="history-answers"><span class="history-creature">'+animalSvg(room.players[0]?.animal||"rabbit")+'<b>'+escapeHtml(h.words[0])+'</b></span><span class="history-dot">·</span><span class="history-creature">'+animalSvg(room.players[1]?.animal||"fox")+'<b>'+escapeHtml(h.words[1])+'</b></span></div></div>').join("");
  showView("finishView");
}
function syncRoom(next) {
  room=next;
  if(room.status==="waiting"){showView("lobbyView");updateLobby();}
  else if(room.status==="initial"){
    showView("initialView");
    const me=getMyPlayer();$("initialWord").disabled=!!me?.submitted;$("initialSubmit").disabled=!!me?.submitted;
    $("initialStatus").textContent=me?.submitted?"已提交，等待对方写下第一个词。":"提交后会等待对方，不会提前看到答案。";
  } else if(room.status==="round"){
    if(lastRoomStatus!=="round"||room.round!==Number($("roundCount").textContent))currentDraft="";
    showView("gameView");renderGame();
  } else if(room.status==="reveal"){showReveal();}
  else if(room.status==="finished"){showFinish();}
  lastRoomStatus=room.status;
}
socket.on("room:joined",({code,playerId})=>{myId=playerId;enterRoom(code);});
socket.on("room:update",next=>{const was=room?.status;syncRoom(next);if(was==="round"&&next.status==="reveal")showReveal();});
socket.on("game:error",message=>toast(message));
$("createBtn").addEventListener("click",()=>{myName=$("playerName").value.trim()||"玩家 1";socket.connect("create",{name:myName,animal:selectedAnimal});});
$("joinBtn").addEventListener("click",()=>{myName=$("playerName").value.trim()||"玩家 2";const code=$("joinCode").value.trim().toUpperCase();if(code.length!==5)return toast("请输入5位房间码。");socket.connect("join",{code,name:myName,animal:selectedAnimal});});
$("joinCode").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
$("copyCode").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(room?.code||"");toast("房间码已复制。");}catch{toast("复制失败，请手动记录房间码。");}});
$("readyBtn").addEventListener("click",()=>socket.emit("player:ready"));
$("initialSubmit").addEventListener("click",()=>{const word=$("initialWord").value.trim();if(!word)return toast("先写下一个词语。");socket.emit("player:initial-submit",{word});});
$("initialWord").addEventListener("keydown",e=>{if(e.key==="Enter")$("initialSubmit").click();});
$("roundWord").addEventListener("input",e=>{currentDraft=e.target.value;socket.emit("player:draft",{word:currentDraft});});
$("submitWord").addEventListener("click",()=>{const word=$("roundWord").value.trim();if(!word)return toast("先写下一个词语。");socket.emit("player:submit",{word});});
$("roundWord").addEventListener("keydown",e=>{if(e.key==="Enter")$("submitWord").click();});
$("restartBtn").addEventListener("click",()=>socket.emit("game:restart",{name:myName,animal:selectedAnimal}));
$("themeToggle").addEventListener("click",()=>{document.documentElement.classList.toggle("dark");localStorage.setItem("wordloop-theme",document.documentElement.classList.contains("dark")?"dark":"light");});
if(localStorage.getItem("wordloop-theme")==="dark")document.documentElement.classList.add("dark");
renderAnimalChoices();
