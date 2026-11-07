const DATA_URL = "characters.json";
const STORAGE_KEY = "ba-sorter-progress-v1";
const $ = (id) => document.getElementById(id);
let allCharacters = [];
let activeCharacters = [];
let queue = [];
let current = null;
let history = [];
let ranked = [];
let comparisonsDone = 0;

async function loadData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("데이터 파일을 불러오지 못했습니다.");
    const data = await response.json();
    allCharacters = Array.isArray(data) ? data : (data.characters || []);
    allCharacters = allCharacters.filter(c => c && c.id && c.name);
    const schools = [...new Set(allCharacters.map(c => c.school).filter(Boolean))].sort();
    for (const school of schools) {
      const option = document.createElement("option");
      option.value = school; option.textContent = school;
      $("schoolFilter").append(option);
    }
    updateSetup();
    const saved = localStorage.getItem(STORAGE_KEY);
    $("resumeButton").hidden = !saved;
    if (!allCharacters.length) $("rosterStatus").textContent = "현재 등록된 캐릭터가 없습니다. characters.json에 캐릭터 데이터를 추가하면 정렬을 시작할 수 있습니다.";
  } catch (error) {
    $("rosterStatus").textContent = error.message + " (로컬 파일이 아닌 GitHub Pages 주소에서 열어주세요.)";
  }
}

function getFiltered() {
  const school = $("schoolFilter").value;
  const type = $("typeFilter").value;
  const query = $("searchInput").value.trim().toLowerCase();
  return allCharacters.filter(c =>
    (!school || c.school === school) &&
    (!type || c.type === type) &&
    (!query || c.name.toLowerCase().includes(query))
  );
}
function updateSetup() {
  activeCharacters = getFiltered();
  $("rosterStatus").textContent = `선택된 캐릭터: ${activeCharacters.length}명 / 전체 ${allCharacters.length}명`;
  $("startButton").disabled = activeCharacters.length < 2;
}
["schoolFilter","typeFilter","searchInput"].forEach(id => $(id).addEventListener(id === "searchInput" ? "input" : "change", updateSetup));

function beginSort(items) {
  if (items.length < 2) return;
  ranked = []; comparisonsDone = 0; history = [];
  queue = [];
  let runs = items.map(item => [item]);
  while (runs.length > 1) {
    const next = [];
    for (let i=0;i<runs.length;i+=2) {
      if (i+1 < runs.length) next.push({left:runs[i],right:runs[i+1],out:[]});
      else next.push(runs[i]);
    }
    queue.push(...next.filter(x => !Array.isArray(x)));
    runs = next.map(x => Array.isArray(x) ? x : x);
    // Build merge rounds explicitly below.
    if (runs.length === 1) break;
    const merged = [];
    for (let i=0;i<runs.length;i+=2) {
      if (i+1 < runs.length) merged.push({left:runs[i],right:runs[i+1],out:[]});
      else merged.push(runs[i]);
    }
    runs = merged;
  }
  // Standard iterative merge plan, retaining each round's merge jobs.
  queue = [];
  let level = items.map(item => [item]);
  while (level.length > 1) {
    const jobs = [];
    const next = [];
    for (let i=0;i<level.length;i+=2) {
      if (i+1 < level.length) {
        const job = {left:level[i],right:level[i+1],out:[]};
        jobs.push(job); next.push(job.out);
      } else next.push(level[i]);
    }
    queue.push(...jobs);
    level = next;
  }
  current = null;
  $("setup").hidden = true; $("resultPanel").hidden = true; $("sortPanel").hidden = false;
  nextComparison();
  saveProgress();
}
function nextComparison() {
  while (queue.length && queue[0].left.length === 0) {
    const job = queue.shift();
    job.out.push(...job.right);
  }
  if (!queue.length) { finishSort(); return; }
  current = queue[0];
  if (!current.left.length || !current.right.length) {
    const rest = current.left.length ? current.left : current.right;
    current.out.push(...rest); queue.shift(); nextComparison(); return;
  }
  renderChoice("leftChoice", current.left[0]);
  renderChoice("rightChoice", current.right[0]);
  $("progressText").textContent = "캐릭터 비교 중";
  $("progressCount").textContent = `비교 ${comparisonsDone}회`;
  $("progressBar").style.width = Math.min(100, comparisonsDone / Math.max(1, allCharacters.length * Math.log2(allCharacters.length)) * 100) + "%";
}
function renderChoice(id, character) {
  const button = $(id);
  button.replaceChildren();
  if (character.image) {
    const img = document.createElement("img"); img.src = character.image; img.alt = character.name;
    img.onerror = () => img.remove(); button.append(img);
  }
  const name = document.createElement("strong"); name.textContent = character.name; button.append(name);
  if (character.school) { const school = document.createElement("small"); school.textContent = character.school; button.append(school); }
}
function choose(side) {
  if (!current) return;
  history.push(JSON.stringify({queue, comparisonsDone}));
  const left = current.left.shift();
  const right = current.right.shift();
  if (side === "left") current.out.push(left, ...(side === "tie" ? [right] : []));
  else if (side === "right") current.out.push(right);
  else current.out.push(left, right);
  comparisonsDone++;
  nextComparison(); saveProgress();
}
function finishSort() {
  ranked = queue.length ? [] : (queue[0]?.out || []);
  // The final merged run is stored as the output array of the final job.
  const finalJob = window.__finalJob;
  if (finalJob) ranked = finalJob.out;
  if (!ranked.length) ranked = activeCharacters.slice();
  $("sortPanel").hidden = true; $("resultPanel").hidden = false;
  $("resultSummary").textContent = `${ranked.length}명의 정렬이 완료되었습니다.`;
  $("rankingList").replaceChildren();
  ranked.forEach((c,i) => { const li=document.createElement("li"); li.textContent=`${i+1}위 · ${c.name}`; $("rankingList").append(li); });
  localStorage.removeItem(STORAGE_KEY);
}
function saveProgress() {
  if (!current) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({version:1,ids:activeCharacters.map(c=>c.id),queue,comparisonsDone})); } catch {}
}
function resumeSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const byId = new Map(allCharacters.map(c=>[c.id,c]));
    activeCharacters = saved.ids.map(id=>byId.get(id)).filter(Boolean);
    if (activeCharacters.length < 2) throw new Error();
    queue = saved.queue; comparisonsDone = saved.comparisonsDone || 0;
    $("setup").hidden=true; $("sortPanel").hidden=false; $("resultPanel").hidden=true;
    nextComparison();
  } catch { alert("저장된 진행 상황을 불러오지 못했습니다."); }
}
$("startButton").addEventListener("click",()=>beginSort(activeCharacters.slice()));
$("resumeButton").addEventListener("click",resumeSort);
$("leftChoice").addEventListener("click",()=>choose("left"));
$("rightChoice").addEventListener("click",()=>choose("right"));
$("tieButton").addEventListener("click",()=>choose("tie"));
$("undoButton").addEventListener("click",()=>{
  const previous=history.pop(); if(!previous)return;
  const state=JSON.parse(previous); queue=state.queue; comparisonsDone=state.comparisonsDone; nextComparison(); saveProgress();
});
$("stopButton").addEventListener("click",()=>{saveProgress();$("sortPanel").hidden=true;$("setup").hidden=false;});
$("resetButton").addEventListener("click",()=>{if(confirm("저장된 진행 상황을 삭제할까요?")){localStorage.removeItem(STORAGE_KEY);$("resumeButton").hidden=true;}});
$("restartButton").addEventListener("click",()=>{ $("resultPanel").hidden=true;$("setup").hidden=false;});
$("copyButton").addEventListener("click",async()=>{
  const payload={v:1,ids:ranked.map(c=>c.id)};
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url=new URL(location.href);url.searchParams.set("result",encoded);
  await navigator.clipboard.writeText(url.toString());$("copyStatus").textContent="결과 링크를 복사했습니다.";
});
$("textButton").addEventListener("click",async()=>{
  await navigator.clipboard.writeText(ranked.map((c,i)=>`${i+1}위. ${c.name}`).join("\n"));
  $("copyStatus").textContent="순위 텍스트를 복사했습니다.";
});
loadData();