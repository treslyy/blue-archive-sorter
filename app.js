const TEST_MODE = new URLSearchParams(location.search).get("dataset") === "npc-mob-test";
const DATA_URL = TEST_MODE ? "data/npc-mob-sort-test.json" : "characters.json";
const STORAGE_KEY = TEST_MODE ? "ba-sorter-progress-npc-mob-test-v1" : "ba-sorter-progress-v2";
const $ = id => document.getElementById(id);
let allCharacters = [], activeCharacters = [], rankedGroups = [];
let pending = [], current = null, low = 0, high = 0, mid = 0;
let comparisonsDone = 0, history = [];

async function loadData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("캐릭터 데이터를 불러오지 못했습니다.");
    const data = await response.json();
    allCharacters = (Array.isArray(data) ? data : data.characters || []).filter(c => c && c.id && c.name);
    const ids = allCharacters.map(c => c.id);
    if (new Set(ids).size !== ids.length) throw new Error("캐릭터 데이터에 중복된 id가 있습니다.");
    const schools = [...new Set(allCharacters.map(c => c.school).filter(Boolean))].sort();
    schools.forEach(school => { const o=document.createElement("option");o.value=school;o.textContent=school;$("schoolFilter").append(o); });
    updateSetup();
    $("resumeButton").hidden = !localStorage.getItem(STORAGE_KEY);
    if (!allCharacters.length) $("rosterStatus").textContent = "현재 캐릭터 데이터가 비어 있습니다. characters.json에 캐릭터를 추가하면 정렬할 수 있습니다.";
    readSharedResult();
  } catch (e) { $("rosterStatus").textContent = e.message + " GitHub Pages 주소에서 접속해 주세요."; }
}
function getFiltered() {
  const school=$("schoolFilter").value,type=$("typeFilter").value,q=$("searchInput").value.trim().toLowerCase();
  return allCharacters.filter(c=>(!school||c.school===school)&&(!type||c.type===type)&&(!q||c.name.toLowerCase().includes(q)));
}
function updateSetup() {
  activeCharacters=getFiltered();
  $("rosterStatus").textContent = TEST_MODE
    ? `검토용 테스트 데이터 · 선택 ${activeCharacters.length}명 / 전체 ${allCharacters.length}명 (NPC ${allCharacters.filter(c=>c.type==="npc").length}명 · 모브 ${allCharacters.filter(c=>c.type==="mob").length}종) · 정식 명단에는 반영되지 않습니다.`
    : `선택된 캐릭터: ${activeCharacters.length}명 / 전체 ${allCharacters.length}명`;
  $("startButton").disabled=activeCharacters.length<2;
}
["schoolFilter","typeFilter","searchInput"].forEach(id=>$ (id).addEventListener(id==="searchInput"?"input":"change",updateSetup));

function snapshot() {
  return JSON.stringify({rankedGroups:rankedGroups.map(g=>g.map(c=>c.id)),pending:pending.map(c=>c.id),current:current?.id||null,low,high,mid,comparisonsDone});
}
function restoreSnapshot(s) {
  const x=JSON.parse(s),map=new Map(allCharacters.map(c=>[c.id,c]));
  const get = id => { const c=map.get(id); if(!c) throw new Error("저장된 캐릭터를 찾을 수 없습니다."); return c; };
  rankedGroups=x.rankedGroups.map(g=>g.map(get));
  pending=x.pending.map(get);
  current=x.current?get(x.current):null;
  low=x.low;high=x.high;mid=x.mid;comparisonsDone=x.comparisonsDone;
}
function saveProgress() {
  if(!current){localStorage.removeItem(STORAGE_KEY);$("resumeButton").hidden=true;return;}
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify({ids:activeCharacters.map(c=>c.id),state:snapshot(),history}));$("resumeButton").hidden=false; } catch {}
}
function beginSort(items) {
  if(items.length<2)return;
  activeCharacters=items.slice();rankedGroups=[[activeCharacters[0]]];
  pending=activeCharacters.slice(1);current=pending.shift()||null;
  low=0;high=rankedGroups.length;comparisonsDone=0;history=[];
  $("setup").hidden=true;$("resultPanel").hidden=true;$("sortPanel").hidden=false;
  if(current){mid=Math.floor((low+high)/2);showComparison();}else finishSort();
  saveProgress();
}
function showCharacter(id,c,group=null) {
  const b=$(id);b.replaceChildren();
  if(c.image){const img=document.createElement("img");img.src=c.image;img.alt=c.name;img.onerror=()=>img.remove();b.append(img);}
  const n=document.createElement("strong");n.textContent=c.name;b.append(n);
  if(c.school){const s=document.createElement("small");s.textContent=c.school;b.append(s);}
  if(group && group.length>1){
    const tie=document.createElement("small");tie.textContent=`공동 순위 · 총 ${group.length}명`;b.append(tie);
    const names=document.createElement("small");names.textContent=group.map(member=>member.name).join(" / ");b.append(names);
  }
}
function showComparison() {
  const group=rankedGroups[mid];
  showCharacter("leftChoice",group[0],group);
  showCharacter("rightChoice",current);
  $("progressText").textContent="캐릭터 비교 중";
  $("progressCount").textContent=`비교 ${comparisonsDone}회 · 남은 캐릭터 ${pending.length+1}명 · 현재 공동 순위 그룹 ${group.length}명`;
  $("progressBar").style.width=Math.min(100,comparisonsDone/Math.max(1,activeCharacters.length*Math.ceil(Math.log2(activeCharacters.length)))*100)+"%";
}
function choose(side) {
  if(!current)return;
  history.push(snapshot());
  // 왼쪽 캐릭터를 선택하면 현재 캐릭터는 그 그룹보다 낮은 순위이므로 뒤쪽을 탐색합니다.
  // 오른쪽 캐릭터를 선택하면 현재 캐릭터가 더 높은 순위이므로 앞쪽을 탐색합니다.
  if(side==="left") { low=mid+1; comparisonsDone++; }
  else if(side==="right") { high=mid; comparisonsDone++; }
  else {
    rankedGroups[mid].push(current);
    comparisonsDone++;
    nextItem();saveProgress();return;
  }
  if(low>=high){rankedGroups.splice(low,0,[current]);nextItem();}
  else {mid=Math.floor((low+high)/2);showComparison();}
  saveProgress();
}
function nextItem() {
  current=pending.shift()||null;low=0;high=rankedGroups.length;
  if(!current){finishSort();return;}
  mid=Math.floor((low+high)/2);showComparison();
}
function finishSort() {
  $("sortPanel").hidden=true;$("resultPanel").hidden=false;
  const total=rankedGroups.reduce((n,g)=>n+g.length,0);
  $("resultSummary").textContent=`${total}명의 정렬이 완료되었습니다. 공동 순위는 같은 순위로 표시됩니다.`;
  $("topRanking").replaceChildren();
  $("rankingList").replaceChildren();
  let rank=1;
  rankedGroups.forEach(group=>{
    group.forEach(c=>{
      const li=document.createElement("li");
      li.textContent=rank+"위 · "+c.name;
      if(group.length>1)li.textContent+=" (공동 "+group.length+"명)";
      $("rankingList").append(li);
      if(rank<=10){
        const card=document.createElement("article");card.className="top-card";
        if(c.image){
          const img=document.createElement("img");img.src=c.image;img.alt=c.name;img.loading="lazy";
          img.onerror=()=>{const placeholder=document.createElement("div");placeholder.className="top-image-placeholder";placeholder.textContent="이미지 없음";img.replaceWith(placeholder);};
          card.append(img);
        }else{
          const placeholder=document.createElement("div");placeholder.className="top-image-placeholder";placeholder.textContent="이미지 없음";card.append(placeholder);
        }
        const label=document.createElement("strong");label.textContent=rank+"위"+(group.length>1?" (공동 "+group.length+"명)":"");
        const name=document.createElement("span");name.textContent=c.name;
        card.append(label,name);$("topRanking").append(card);
      }
    });
    rank+=group.length;
  });
  localStorage.removeItem(STORAGE_KEY);$("resumeButton").hidden=true;
}
function resumeSort() {
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)),map=new Map(allCharacters.map(c=>[c.id,c]));
    activeCharacters=saved.ids.map(id=>{const c=map.get(id);if(!c)throw new Error();return c;});
    restoreSnapshot(saved.state);
    if(!current)throw new Error();
    history=Array.isArray(saved.history)?saved.history:[];
    $("setup").hidden=true;$("resultPanel").hidden=true;$("sortPanel").hidden=false;showComparison();
  } catch { alert("저장된 진행 상황을 불러오지 못했습니다. 캐릭터 데이터가 변경되었을 수 있습니다."); }
}
function readSharedResult() {
  const code=new URLSearchParams(location.search).get("result");if(!code)return;
  try {
    const data=JSON.parse(decodeURIComponent(escape(atob(code))));
    const map=new Map(allCharacters.map(c=>[c.id,c]));
    const groups=data.groups ? data.groups.map(g=>g.map(id=>map.get(id)).filter(Boolean)) : (data.ids||[]).map(id=>[map.get(id)]).filter(g=>g[0]);
    rankedGroups=groups.filter(g=>g.length);
    if(rankedGroups.length){$("setup").hidden=true;finishSort();}
  } catch { /* 잘못된 공유 링크는 무시 */ }
}
$("startButton").addEventListener("click",()=>beginSort(activeCharacters));
$("resumeButton").addEventListener("click",resumeSort);
$("leftChoice").addEventListener("click",()=>choose("left"));
$("rightChoice").addEventListener("click",()=>choose("right"));
$("tieButton").addEventListener("click",()=>choose("tie"));
document.addEventListener("keydown",event=>{
  if($("sortPanel").hidden || !current || event.altKey || event.ctrlKey || event.metaKey) return;
  if(event.key==="ArrowLeft" || event.key==="ArrowRight" || event.key==="ArrowDown"){
    event.preventDefault();
    choose(event.key==="ArrowLeft"?"left":event.key==="ArrowRight"?"right":"tie");
  }
});
$("undoButton").addEventListener("click",()=>{const s=history.pop();if(!s)return;restoreSnapshot(s);showComparison();saveProgress();});
$("stopButton").addEventListener("click",()=>{$("sortPanel").hidden=true;$("setup").hidden=false;saveProgress();});
$("resetButton").addEventListener("click",()=>{if(confirm("저장된 진행 상황을 삭제할까요?")){localStorage.removeItem(STORAGE_KEY);$("resumeButton").hidden=true;}});
$("restartButton").addEventListener("click",()=>{$("resultPanel").hidden=true;$("setup").hidden=false;});
$("copyButton").addEventListener("click",async()=>{
  const groups=rankedGroups.map(g=>g.map(c=>c.id));
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify({v:2,groups}))));
  const url=new URL(location.href);url.searchParams.set("result",encoded);
  try{await navigator.clipboard.writeText(url.toString());$("copyStatus").textContent="결과 링크를 복사했습니다.";}catch{$("copyStatus").textContent="브라우저에서 클립보드 복사를 허용해 주세요.";}
});
$("textButton").addEventListener("click",async()=>{
  let rank=1;const lines=[];
  rankedGroups.forEach(group=>{
    group.forEach(c=>lines.push(`${rank}위. ${c.name}${group.length>1?` (공동 ${group.length}명)`:""}`));
    rank+=group.length;
  });
  try{await navigator.clipboard.writeText(lines.join("\n"));$("copyStatus").textContent="순위 텍스트를 복사했습니다.";}catch{$("copyStatus").textContent="브라우저에서 클립보드 복사를 허용해 주세요.";}
});
loadData();