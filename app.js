const DATA_URL = "characters.json";
const STORAGE_KEY = "ba-sorter-progress-v1";
const $ = id => document.getElementById(id);
let allCharacters = [], activeCharacters = [], ranked = [];
let pending = [], current = null, low = 0, high = 0, mid = 0;
let comparisonsDone = 0, history = [];

async function loadData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("캐릭터 데이터를 불러오지 못했습니다.");
    const data = await response.json();
    allCharacters = (Array.isArray(data) ? data : data.characters || []).filter(c => c && c.id && c.name);
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
  $("rosterStatus").textContent=`선택된 캐릭터: ${activeCharacters.length}명 / 전체 ${allCharacters.length}명`;
  $("startButton").disabled=activeCharacters.length<2;
}
["schoolFilter","typeFilter","searchInput"].forEach(id=>$ (id).addEventListener(id==="searchInput"?"input":"change",updateSetup));

function snapshot() {
  return JSON.stringify({ranked:ranked.map(c=>c.id),pending:pending.map(c=>c.id),current:current?.id||null,low,high,mid,comparisonsDone});
}
function restoreSnapshot(s) {
  const x=JSON.parse(s),map=new Map(allCharacters.map(c=>[c.id,c]));
  ranked=x.ranked.map(id=>map.get(id)).filter(Boolean);
  pending=x.pending.map(id=>map.get(id)).filter(Boolean);
  current=x.current?map.get(x.current):null;
  low=x.low;high=x.high;mid=x.mid;comparisonsDone=x.comparisonsDone;
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify({ids:activeCharacters.map(c=>c.id),state:snapshot()}));$("resumeButton").hidden=false; } catch {}
}
function beginSort(items) {
  if(items.length<2)return;
  activeCharacters=items.slice();ranked=[activeCharacters[0]];
  pending=activeCharacters.slice(1);current=pending.shift()||null;
  low=0;high=ranked.length;comparisonsDone=0;history=[];
  $("setup").hidden=true;$("resultPanel").hidden=true;$("sortPanel").hidden=false;
  if(current){mid=Math.floor((low+high)/2);showComparison();}else finishSort();
  saveProgress();
}
function showCharacter(id,c) {
  const b=$(id);b.replaceChildren();
  if(c.image){const img=document.createElement("img");img.src=c.image;img.alt=c.name;img.onerror=()=>img.remove();b.append(img);}
  const n=document.createElement("strong");n.textContent=c.name;b.append(n);
  if(c.school){const s=document.createElement("small");s.textContent=c.school;b.append(s);}
}
function showComparison() {
  showCharacter("leftChoice",ranked[mid]);
  showCharacter("rightChoice",current);
  $("progressText").textContent="캐릭터 비교 중";
  $("progressCount").textContent=`비교 ${comparisonsDone}회 · 남은 캐릭터 ${pending.length+1}명`;
  $("progressBar").style.width=Math.min(100,comparisonsDone/Math.max(1,activeCharacters.length*Math.ceil(Math.log2(activeCharacters.length)))*100)+"%";
}
function choose(side) {
  if(!current)return;
  history.push(snapshot());
  if(side==="left") high=mid;
  else if(side==="right") low=mid+1;
  else { comparisonsDone++; ranked.splice(mid,0,current); nextItem(); saveProgress(); return; }
  comparisonsDone++;
  if(low>=high){ranked.splice(low,0,current);nextItem();}
  else {mid=Math.floor((low+high)/2);showComparison();}
  saveProgress();
}
function nextItem() {
  current=pending.shift()||null;low=0;high=ranked.length;
  if(!current){finishSort();return;}
  mid=Math.floor((low+high)/2);showComparison();
}
function finishSort() {
  $("sortPanel").hidden=true;$("resultPanel").hidden=false;
  $("resultSummary").textContent=`${ranked.length}명의 정렬이 완료되었습니다.`;
  $("rankingList").replaceChildren();
  ranked.forEach((c,i)=>{const li=document.createElement("li");li.textContent=`${i+1}위 · ${c.name}`;$("rankingList").append(li);});
  localStorage.removeItem(STORAGE_KEY);$("resumeButton").hidden=true;
}
function resumeSort() {
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)),map=new Map(allCharacters.map(c=>[c.id,c]));
    activeCharacters=saved.ids.map(id=>map.get(id)).filter(Boolean);
    restoreSnapshot(saved.state);
    if(!current)throw new Error();
    $("setup").hidden=true;$("resultPanel").hidden=true;$("sortPanel").hidden=false;showComparison();
  } catch { alert("저장된 진행 상황을 불러오지 못했습니다. 캐릭터 데이터가 변경되었을 수 있습니다."); }
}
function readSharedResult() {
  const code=new URLSearchParams(location.search).get("result");if(!code)return;
  try {
    const data=JSON.parse(decodeURIComponent(escape(atob(code))));
    const map=new Map(allCharacters.map(c=>[c.id,c]));
    const shared=data.ids.map(id=>map.get(id)).filter(Boolean);
    if(shared.length){ranked=shared;$("setup").hidden=true;finishSort();}
  } catch { /* 잘못된 공유 링크는 무시 */ }
}
$("startButton").addEventListener("click",()=>beginSort(activeCharacters));
$("resumeButton").addEventListener("click",resumeSort);
$("leftChoice").addEventListener("click",()=>choose("left"));
$("rightChoice").addEventListener("click",()=>choose("right"));
$("tieButton").addEventListener("click",()=>choose("tie"));
$("undoButton").addEventListener("click",()=>{const s=history.pop();if(!s)return;restoreSnapshot(s);showComparison();saveProgress();});
$("stopButton").addEventListener("click",()=>{$("sortPanel").hidden=true;$("setup").hidden=false;saveProgress();});
$("resetButton").addEventListener("click",()=>{if(confirm("저장된 진행 상황을 삭제할까요?")){localStorage.removeItem(STORAGE_KEY);$("resumeButton").hidden=true;}});
$("restartButton").addEventListener("click",()=>{$("resultPanel").hidden=true;$("setup").hidden=false;});
$("copyButton").addEventListener("click",async()=>{
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify({v:1,ids:ranked.map(c=>c.id)}))));
  const url=new URL(location.href);url.searchParams.set("result",encoded);
  try{await navigator.clipboard.writeText(url.toString());$("copyStatus").textContent="결과 링크를 복사했습니다.";}catch{$("copyStatus").textContent="브라우저에서 클립보드 복사를 허용해 주세요.";}
});
$("textButton").addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText(ranked.map((c,i)=>`${i+1}위. ${c.name}`).join("\n"));$("copyStatus").textContent="순위 텍스트를 복사했습니다.";}catch{$("copyStatus").textContent="브라우저에서 클립보드 복사를 허용해 주세요.";}
});
loadData();