const TEST_MODE = new URLSearchParams(location.search).get("dataset") === "npc-mob-test";
const DATA_URL = TEST_MODE ? "data/npc-mob-sort-test.json" : "characters.json";
const STORAGE_KEY = TEST_MODE ? "ba-sorter-progress-npc-mob-test-v1" : "ba-sorter-progress-v2";
let TOP_CROPS = {};
const $ = id => document.getElementById(id);
let allCharacters = [], activeCharacters = [], rankedGroups = [];
let pending = [], current = null, low = 0, high = 0, mid = 0;
let comparisonsDone = 0, history = [];

async function loadData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("캐릭터 데이터를 불러오지 못했습니다.");
    const data = await response.json();
    try {
      const cropResponse = await fetch("crop-settings-all.json");
      if (!cropResponse.ok) throw new Error("크롭 설정 파일을 불러오지 못했습니다.");
      const cropData = await cropResponse.json();
      const cropEntries = Object.entries(cropData.crops || {});
      const validCrops = cropData.version === 1 && cropEntries.length === 203 &&
        cropEntries.every(([id, crop]) => /^roster-\d{3}$/.test(id) &&
          Number.isFinite(crop.x) && Number.isFinite(crop.y) &&
          Number.isFinite(crop.zoom) && crop.zoom > 0);
      if (!validCrops) throw new Error("크롭 설정 파일의 형식이 올바르지 않습니다.");
      TOP_CROPS = cropData.crops;
    } catch (cropError) {
      console.warn("개별 얼굴 크롭 설정을 적용하지 못했습니다.", cropError);
      TOP_CROPS = {};
    }
    allCharacters = (Array.isArray(data) ? data : data.characters || []).filter(c => c && c.id && c.name);
    const ids = allCharacters.map(c => c.id);
    if (new Set(ids).size !== ids.length) throw new Error("캐릭터 데이터에 중복된 id가 있습니다.");
    const schools = [...new Set(allCharacters.map(c => c.school).filter(Boolean))].sort();
    const schoolContainer = $("schoolCheckboxes");
    schools.forEach(school => {
      const label = document.createElement("label");
      label.className = "school-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = school;
      checkbox.checked = true;
      checkbox.addEventListener("change", updateSetup);
      const name = document.createElement("span");
      name.textContent = school;
      label.append(checkbox, name);
      schoolContainer.append(label);
    });
    renderRosterList();
    updateSetup();
    $("resumeButton").hidden = !localStorage.getItem(STORAGE_KEY);
    if (!allCharacters.length) $("rosterStatus").textContent = "현재 캐릭터 데이터가 비어 있습니다. characters.json에 캐릭터를 추가하면 정렬할 수 있습니다.";
    readSharedResult();
  } catch (e) { $("rosterStatus").textContent = e.message + " GitHub Pages 주소에서 접속해 주세요."; }
}
function renderRosterList() {
  const bySchool = new Map();
  [...allCharacters].sort((a,b) => (a.school||"기타").localeCompare(b.school||"기타","ko") || a.name.localeCompare(b.name,"ko")).forEach(c => {
    const school = c.school || "기타";
    if (!bySchool.has(school)) bySchool.set(school, []);
    bySchool.get(school).push(c.name);
  });
  const lines = [];
  bySchool.forEach((names, school) => { lines.push(`[${school}]`, ...names, ""); });
  $("rosterText").textContent = lines.join("\n").trim();
}
function getFiltered() {
  const selectedSchools = new Set([...document.querySelectorAll("#schoolCheckboxes input:checked")].map(input => input.value));
  const q = $("searchInput").value.trim().toLowerCase();
  return allCharacters.filter(c => selectedSchools.has(c.school) && (!q || c.name.toLowerCase().includes(q)));
}
function updateSetup() {
  activeCharacters=getFiltered();
  $("rosterStatus").textContent = TEST_MODE
    ? `검토용 테스트 데이터 · 선택 ${activeCharacters.length}명 / 전체 ${allCharacters.length}명 · 정식 명단에는 반영되지 않습니다.`
    : `선택된 캐릭터: ${activeCharacters.length}명 / 전체 ${allCharacters.length}명`;
  $("startButton").disabled=activeCharacters.length<2;
}
$("searchInput").addEventListener("input", updateSetup);
$("selectAllSchools").addEventListener("click", () => {
  document.querySelectorAll("#schoolCheckboxes input").forEach(input => { input.checked = true; });
  updateSetup();
});
$("clearSchools").addEventListener("click", () => {
  document.querySelectorAll("#schoolCheckboxes input").forEach(input => { input.checked = false; });
  updateSetup();
});

$("showRosterButton").addEventListener("click", () => { $("rosterViewer").hidden = false; });
$("hideRosterButton").addEventListener("click", () => { $("rosterViewer").hidden = true; });

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
function shuffleCharacters(items) {
  const shuffled=items.slice();
  for(let i=shuffled.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
  }
  return shuffled;
}
function beginSort(items) {
  if(items.length<2)return;
  // 매번 새 소트를 시작할 때 비교 대상의 등장 순서를 무작위로 섞습니다.
  activeCharacters=shuffleCharacters(items);rankedGroups=[[activeCharacters[0]]];
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
function applyPortraitCrop(frame,img,crop) {
  if(!crop || !img.naturalWidth || !img.naturalHeight) return;
  const frameW=frame.clientWidth,frameH=frame.clientHeight;
  const fit=Math.min(frameW/img.naturalWidth,frameH/img.naturalHeight);
  const imageW=img.naturalWidth*fit*crop.zoom;
  const imageH=img.naturalHeight*fit*crop.zoom;
  const left=imageW<=frameW?(frameW-imageW)/2:-(crop.x/100)*(imageW-frameW);
  const top=imageH<=frameH?(frameH-imageH)/2:-(crop.y/100)*(imageH-frameH);
  img.style.width=imageW+"px";
  img.style.height=imageH+"px";
  img.style.left=left+"px";
  img.style.top=top+"px";
}
function finishSort() {
  $("sortPanel").hidden=true;$("resultPanel").hidden=false;
  const total=rankedGroups.reduce((n,g)=>n+g.length,0);
  $("resultSummary").textContent=`${total}명의 정렬이 완료되었습니다. 공동 순위는 같은 순위로 표시됩니다.`;
  $("topRanking").replaceChildren();
  $("rankingList").replaceChildren();
  let rank=1, topCardCount=0, textColumn=null, textColumnCount=0;
  rankedGroups.forEach(group=>{
    group.forEach(c=>{
      if(rank>10){
        if(!textColumn || textColumnCount>=40){
          textColumn=document.createElement("ol");
          textColumn.className="ranking";
          $("rankingList").append(textColumn);
          textColumnCount=0;
        }
        const li=document.createElement("li");
        const rankLabel=document.createElement("span");
        rankLabel.className="ranking-rank";
        rankLabel.textContent=rank+"";
        const nameLabel=document.createElement("span");
        nameLabel.className="ranking-name";
        nameLabel.textContent=c.name+(group.length>1?" (공동 "+group.length+"명)":"");
        li.append(rankLabel,nameLabel);
        textColumn.append(li);
        textColumnCount++;
      }
      if(rank<=10){
        const columnIndex=Math.floor(topCardCount/5);
        let column=$("topRanking").children[columnIndex];
        if(!column){
          column=document.createElement("div");
          column.className="top-ranking-column";
          $("topRanking").append(column);
        }
        const card=document.createElement("article");card.className="top-card";
        let imageToLoad=null;
        if(c.image){
          const img=document.createElement("img");img.alt=c.name;img.loading="lazy";
          const crop=TOP_CROPS[c.id];
          if(crop){
            const frame=document.createElement("div");frame.className="top-card-portrait";
            img.addEventListener("load",()=>applyPortraitCrop(frame,img,crop));
            img.onerror=()=>{const placeholder=document.createElement("div");placeholder.className="top-image-placeholder";placeholder.textContent="이미지 없음";frame.replaceWith(placeholder);};
            frame.append(img);card.append(frame);
          }else{
            img.onerror=()=>{const placeholder=document.createElement("div");placeholder.className="top-image-placeholder";placeholder.textContent="이미지 없음";img.replaceWith(placeholder);};
            card.append(img);
          }
          imageToLoad=img;
        }else{
          const placeholder=document.createElement("div");placeholder.className="top-image-placeholder";placeholder.textContent="이미지 없음";card.append(placeholder);
        }
        const label=document.createElement("strong");label.textContent=rank+"위"+(group.length>1?" (공동 "+group.length+"명)":"");
        const name=document.createElement("span");name.textContent=c.name;
        card.append(label,name);column.append(card);
        if(imageToLoad) imageToLoad.src=c.image;
        topCardCount++;
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

function copyComputedStyles(source, target) {
  if (source.nodeType !== Node.ELEMENT_NODE || target.nodeType !== Node.ELEMENT_NODE) return;
  const computed = getComputedStyle(source);
  let css = "";
  for (const property of computed) css += property + ":" + computed.getPropertyValue(property) + ";";
  target.setAttribute("style", css);
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length; i++) {
    if (targetChildren[i]) copyComputedStyles(sourceChildren[i], targetChildren[i]);
  }
}
async function saveResultPng() {
  const button = $("pngButton");
  const status = $("copyStatus");
  button.disabled = true;
  status.textContent = "PNG 이미지를 만드는 중입니다...";
  let svgUrl = null;
  try {
    await document.fonts.ready;
    const panel = $("resultPanel");
    const panelWidth = Math.ceil(panel.scrollWidth);
    const panelHeight = Math.ceil(panel.scrollHeight);
    const layoutWidth = Math.ceil($("rankingLayout").scrollWidth);
    const clone = panel.cloneNode(true);
    copyComputedStyles(panel, clone);
    // Remove external CSS image resources (e.g. decorative UI pattern) from the
    // export clone; otherwise they taint the canvas even when portraits are embedded.
    [clone, ...clone.querySelectorAll("*")].forEach(el => {
      const style = getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== "none") el.style.backgroundImage = "none";
      if (style.maskImage && style.maskImage !== "none") el.style.maskImage = "none";
      if (style.webkitMaskImage && style.webkitMaskImage !== "none") el.style.webkitMaskImage = "none";
      if (style.borderImageSource && style.borderImageSource !== "none") el.style.borderImageSource = "none";
      if (style.listStyleImage && style.listStyleImage !== "none") el.style.listStyleImage = "none";
    });
    clone.querySelectorAll(".actions, #copyStatus").forEach(el => el.style.display = "none");
    const layout = clone.querySelector("#rankingLayout");
    if (layout) {
      layout.style.width = layoutWidth + "px";
      layout.style.maxWidth = "none";
      layout.style.overflow = "visible";
    }
    clone.style.display = "block";
    clone.style.position = "static";
    clone.style.boxSizing = "border-box";
    clone.style.width = panelWidth + "px";
    clone.style.maxWidth = "none";
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";
    clone.style.margin = "0";
    const clonedImages = [...clone.querySelectorAll("img")];
    await Promise.all(clonedImages.map(async img => {
      const source = img.currentSrc || img.src;
      if (!source) return;
      const response = await fetch(source, {mode:"cors", credentials:"same-origin"});
      if (!response.ok) throw new Error("초상화 이미지를 불러오지 못했습니다: " + source);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("초상화 이미지를 내보내기용으로 변환하지 못했습니다."));
        reader.readAsDataURL(blob);
      });
      img.removeAttribute("srcset");
      img.setAttribute("src", dataUrl);
    }));
    const width = panelWidth;
    const height = panelHeight;
    if (!width || !height) throw new Error("결과 화면의 크기를 확인할 수 없습니다.");
    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.append(clone);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    const foreign = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    foreign.setAttribute("width", "100%");
    foreign.setAttribute("height", "100%");
    foreign.append(wrapper);
    svg.append(foreign);
    const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], {type:"image/svg+xml;charset=utf-8"});
    svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.src = svgUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("결과 화면을 이미지로 변환하지 못했습니다."));
    });
    const scale = width * 2 > 12000 || height * 2 > 12000 ? 1 : 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 캔버스를 만들 수 없습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG 파일 생성에 실패했습니다.")), "image/png"));
    const downloadUrl = URL.createObjectURL(png);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "blue-archive-ranking.png";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    status.textContent = "결과를 PNG 파일로 저장했습니다.";
  } catch (error) {
    console.error("PNG 저장 실패:", error);
    status.textContent = error.message || "PNG 저장에 실패했습니다.";
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    button.disabled = false;
  }
}
$("pngButton").addEventListener("click", saveResultPng);

$("textButton").addEventListener("click",async()=>{
  let rank=1;const lines=[];
  rankedGroups.forEach(group=>{
    group.forEach(c=>lines.push(`${rank}위. ${c.name}${group.length>1?` (공동 ${group.length}명)`:""}`));
    rank+=group.length;
  });
  try{await navigator.clipboard.writeText(lines.join("\n"));$("copyStatus").textContent="순위 텍스트를 복사했습니다.";}catch{$("copyStatus").textContent="브라우저에서 클립보드 복사를 허용해 주세요.";}
});
loadData();