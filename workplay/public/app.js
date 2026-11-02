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
const animals = ["rabbit","fox","cat","dog","panda","bird","hamster"];
const animalNames = {rabbit:"白兔",fox:"橘狐",cat:"小猫",dog:"小狗",panda:"熊猫",bird:"小鸟",hamster:"仓鼠"};
let selectedAnimal = "rabbit", room = null, myId = null, myIndex = -1, myName = "玩家 1";
let currentDraft = "", timerFrame = null, lastRoomStatus = "", revealTimeout = null;

function animalSvg(type, accent) {
  const c = accent || (type === "fox" || type === "bird" ? "#d58b6b" : "#8da384");
  const dark = "#555b50", cream = "#f7f2e8";
  const shapes = {
    rabbit:`<path d="M27 34C18 10 20 3 28 5c8 2 9 20 8 29M47 34C45 13 51 5 58 10c6 6-1 21-5 29" fill="${cream}" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="40" cy="44" rx="22" ry="21" fill="${cream}" stroke="${dark}" stroke-width="2.5"/>`,
    fox:`<path d="M17 28 22 7 38 19 54 7 61 29Q63 55 40 61Q17 55 17 28" fill="${c}" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/><path d="M29 44Q40 35 51 44Q49 57 40 57Q31 57 29 44" fill="${cream}"/>`,
    cat:`<path d="M18 31 19 8 36 20 54 8 61 32Q62 57 40 60Q18 57 18 31" fill="${cream}" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 15 31 23 23 27M56 15 49 23 57 27" fill="none" stroke="${c}" stroke-width="4"/>`,
    dog:`<path d="M20 25Q5 16 12 43Q16 54 28 47M60 25Q75 16 68 43Q64 54 52 47" fill="${c}" stroke="${dark}" stroke-width="2.5"/><ellipse cx="40" cy="43" rx="23" ry="21" fill="${cream}" stroke="${dark}" stroke-width="2.5"/>`,
    panda:`<ellipse cx="22" cy="25" rx="12" ry="15" fill="${dark}"/><ellipse cx="58" cy="25" rx="12" ry="15" fill="${dark}"/><circle cx="40" cy="42" r="24" fill="${cream}" stroke="${dark}" stroke-width="2.5"/>`,
    bird:`<path d="M18 45Q15 17 42 17Q67 18 62 47Q54 66 32 60Z" fill="${c}" stroke="${dark}" stroke-width="2.5"/><path d="m57 39 17 7-17 6" fill="#e5b75e" stroke="${dark}" stroke-width="2"/>`,
    hamster:`<circle cx="23" cy="27" r="12" fill="#e8b9a0" stroke="${dark}" stroke-width="2"/><circle cx="57" cy="27" r="12" fill="#e8b9a0" stroke="${dark}" stroke-width="2"/><ellipse cx="40" cy="43" rx="25" ry="22" fill="${cream}" stroke="${dark}" stroke-width="2.5"/>`
  };
  return `<svg viewBox="0 0 80 80" aria-hidden="true">${shapes[type] || shapes.rabbit}<ellipse cx="32" cy="40" rx="2.3" ry="3" fill="${dark}"/><ellipse cx="49" cy="40" rx="2.3" ry="3" fill="${dark}"/><ellipse cx="40" cy="48" rx="3" ry="2.2" fill="${c}"/><path d="M36 52Q40 56 44 52" fill="none" stroke="${dark}" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}
function showView(id) { views.forEach(v => $(v).classList.toggle("hidden", v !== id)); window.scrollTo({top:0,behavior:"smooth"}); }
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2300); }
function renderAnimalChoices() {
  $("animalChoices").innerHTML = animals.map(a=>`<button class="animal-choice ${a===selectedAnimal?"selected":""}" data-animal="${a}" title="${animalNames[a]}">${animalSvg(a)}</button>`).join("");
  $("animalChoices").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{selectedAnimal=b.dataset.animal;renderAnimalChoices();}));
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
  const me=getMyPlayer();
  $("readyBtn").disabled=!!me?.ready;
  $("readyBtn").textContent=me?.ready?"已准备，等待对方…":"我准备好了　↗";
  $("lobbyHint").textContent=room.players.length<2?"等待另一位玩家加入房间":room.players.every(p=>p.ready)?"双方已就绪，正在开始…":"两个人都准备好后开始游戏";
}
function renderHistory() {
  const list=room?.history||[];
  $("historyCount").textContent=`${list.length} ROUNDS`;
  $("historyList").innerHTML=list.length?list.map(h=>`<div class="history-item"><small>ROUND ${String(h.round).padStart(2,"0")}</small><div><b>${escapeHtml(h.words[0])}</b>　·　${escapeHtml(h.words[1])}</div></div>`).join(""):`<p class="empty-history">你们的联想旅程会记录在这里。</p>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderGame() {
  if(!room)return;
  $("roundLabel").textContent=`ROUND ${String(room.round).padStart(2,"0")} · ASSOCIATION`;
  $("roundCount").textContent=String(room.round).padStart(2,"0");
  const last=room.history[room.history.length-1];
  $("promptWords").innerHTML=last?`<span class="prompt-word">${escapeHtml(last.words[0])}</span><span class="prompt-plus">+</span><span class="prompt-word">${escapeHtml(last.words[1])}</span>`:"";
  const me=getMyPlayer(), other=room.players.find(p=>p.id!==myId);
  $("legend0").textContent=me?.name||"你";$("legend1").textContent=other?.name||"对方";
  $("runner0").innerHTML=animalSvg(me?.animal||"rabbit");
  $("runner1").innerHTML=animalSvg(other?.animal||"fox");
  $("runner0").style.borderColor="var(--moss)";$("runner1").style.borderColor="var(--clay)";
  $("roundWord").disabled=!!me?.submitted;
  $("submitWord").disabled=!!me?.submitted;
  $("roundWord").value=currentDraft;
  $("waitingNote").textContent=me?.submitted?"你已经抵达终点，正在等对方。":"提交后，小动物会先抵达终点等你。";
  $("trackState").textContent=room.players.every(p=>p.submitted)?"即将揭晓":room.players.some(p=>p.submitted)?"一位玩家已抵达":"双方正在思考";
  renderHistory();
  startTrack();
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
    const now=Date.now(), elapsed=Math.max(0,now-room.roundStartedAt);
    const progress=Math.min(1,elapsed/20000);
    const p0=me?.submitted?1:progress, p1=other?.submitted?1:progress;
    // Each runner covers half the circle in opposite directions.
    positionRunner($("runner0"),-90+180*p0);
    positionRunner($("runner1"),-90-180*p1);
    const left=Math.max(0,20000-elapsed);
    $("countdown").innerHTML=`${Math.ceil(left/1000)}<span>.${Math.floor((left%1000)/100)}</span>`;
    $("centerSub").textContent=me?.submitted?"已抵达终点":"准备相遇";
    $("progressRing").style.strokeDashoffset=829*(1-progress);
    timerFrame=requestAnimationFrame(draw);
  };
  draw();
}
function showReveal() {
  if(timerFrame)cancelAnimationFrame(timerFrame);
  const r=room.reveal;if(!r)return;
  $("revealRound").textContent=`ROUND ${String(r.round).padStart(2,"0")}`;
  $("revealWords").innerHTML=r.words.map(w=>`<div class="reveal-word">${escapeHtml(w)}</div>`).join("");
  const same=r.words[0]===r.words[1];
  $("revealTitle").textContent=same?"你们想到一起了！":"你们想到了……";
  $("revealMessage").textContent=same?"两个念头，在这里刚好重合。":"思路在这里分开了，再向前走一步。";
  showView("revealView");
}
function showFinish() {
  if(timerFrame)cancelAnimationFrame(timerFrame);
  $("finishRounds").textContent=room.winner.rounds;
  $("finalWord").textContent=room.winner.word;
  $("finishHistory").innerHTML=room.history.map(h=>`<div class="history-item"><small>R${String(h.round).padStart(2,"0")}</small><div>${escapeHtml(h.words[0])}　·　${escapeHtml(h.words[1])}</div></div>`).join("");
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
$("restartBtn").addEventListener("click",()=>socket.emit("game:restart",{}));
$("themeToggle").addEventListener("click",()=>{document.documentElement.classList.toggle("dark");localStorage.setItem("wordloop-theme",document.documentElement.classList.contains("dark")?"dark":"light");});
if(localStorage.getItem("wordloop-theme")==="dark")document.documentElement.classList.add("dark");
renderAnimalChoices();
