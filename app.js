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
      const cropResponse = await fetch("crop-settings-all.json?v=3");
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

async function saveResultPng() {
  const button = $("pngButton");
  const status = $("copyStatus");
  button.disabled = true;
  status.textContent = "PNG 이미지를 만드는 중입니다...";
  try {
    const panel = $("resultPanel");
    const layout = $("rankingLayout");
    const panelRect = panel.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel);
    const padRight = parseFloat(panelStyle.paddingRight) || 0;
    const layoutOffsetX = layoutRect.left - panelRect.left;
    const width = Math.ceil(Math.max(panel.clientWidth, layoutOffsetX + layout.scrollWidth + padRight));
    const height = Math.ceil(panel.scrollHeight);
    if (!width || !height) throw new Error("결과 화면의 크기를 확인할 수 없습니다.");

    const portraitImages = [...panel.querySelectorAll(".top-card img")];
    await Promise.all(portraitImages.map(img => {
      img.loading = "eager";
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener("load", resolve, {once:true});
        img.addEventListener("error", resolve, {once:true});
      });
    }));

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지 캔버스를 만들 수 없습니다.");
    ctx.scale(scale, scale);

    const point = (element, inLayout = false) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left - panelRect.left + (inLayout ? layout.scrollLeft : 0),
        y: rect.top - panelRect.top,
        width: rect.width,
        height: rect.height
      };
    };
    const drawBox = (rect, fill, stroke, lineWidth = 1) => {
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(rect.x + lineWidth / 2, rect.y + lineWidth / 2,
          Math.max(0, rect.width - lineWidth), Math.max(0, rect.height - lineWidth));
      }
    };
    const drawText = (element, rect) => {
      if (!element) return;
      const style = getComputedStyle(element);
      const text = element.textContent.trim();
      if (!text) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      ctx.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.fillStyle = style.color || "#31516d";
      ctx.textAlign = style.textAlign === "start" ? "left" : style.textAlign;
      if (ctx.textAlign === "inherit") ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const x = ctx.textAlign === "center" ? rect.x + rect.width / 2 :
        ctx.textAlign === "right" ? rect.x + rect.width - 3 : rect.x + 3;
      ctx.fillText(text, x, rect.y + rect.height / 2, Math.max(1, rect.width - 6));
      ctx.restore();
    };

    // Match the compact result panel's light background and heading.
    drawBox({x:0,y:0,width,height}, "#ffffff", null);
    const heading = panel.querySelector("h2");
    const summary = $("resultSummary");
    if (heading) drawText(heading, point(heading));
    if (summary) drawText(summary, point(summary));

    // TOP 10: use the live DOM geometry, including each student's individual crop.
    const topRoot = $("topRanking");
    for (const column of topRoot.children) {
      const columnRect = point(column, true);
      drawBox(columnRect, "#ffffff", "#83c6ef");
      for (const card of column.children) {
        const cardRect = point(card, true);
        drawBox(cardRect, "#ffffff", "#83c6ef");
        const rank = card.querySelector("strong");
        const name = card.querySelector("span");
        if (rank) {
          const r = point(rank, true);
          drawText(rank, r);
        }
        const frame = card.querySelector(".top-card-portrait");
        const image = card.querySelector("img");
        const placeholder = card.querySelector(".top-image-placeholder");
        if (frame && image && image.complete && image.naturalWidth) {
          const fr = point(frame, true);
          const ir = point(image, true);
          const source = new URL(image.currentSrc || image.src, location.href);
          if (source.origin !== location.origin) {
            throw new Error("외부 이미지가 포함되어 있습니다. 현재 저장 방식은 같은 사이트의 이미지가 필요합니다.");
          }
          ctx.save();
          ctx.beginPath();
          ctx.rect(fr.x, fr.y, fr.width, fr.height);
          ctx.clip();
          ctx.drawImage(image, ir.x, ir.y, ir.width, ir.height);
          ctx.restore();
        } else if (placeholder) {
          const pr = point(placeholder, true);
          drawBox(pr, "#edf7fc", null);
          drawText(placeholder, pr);
        } else if (image && !image.complete) {
          throw new Error("초상화 이미지가 아직 모두 불러와지지 않았습니다. 잠시 후 다시 저장해 주세요.");
        }
        if (name) drawText(name, point(name, true));
      }
    }

    // Remaining ranks: reproduce each fixed-width ranking column and its cells.
    const listRoot = $("rankingList");
    for (const column of listRoot.children) {
      const columnRect = point(column, true);
      drawBox(columnRect, "#ffffff", "#83c6ef");
      const items = [...column.children];
      items.forEach((item, index) => {
        const itemRect = point(item, true);
        const rank = item.querySelector(".ranking-rank");
        const name = item.querySelector(".ranking-name");
        if (rank) {
          const r = point(rank, true);
          ctx.beginPath();
          ctx.strokeStyle = "#b5d9f2";
          ctx.lineWidth = 1;
          ctx.moveTo(r.x + r.width - 0.5, itemRect.y);
          ctx.lineTo(r.x + r.width - 0.5, itemRect.y + itemRect.height);
          ctx.stroke();
          drawText(rank, r);
        }
        if (name) drawText(name, point(name, true));
        if (index < items.length - 1) {
          ctx.beginPath();
          ctx.strokeStyle = "#a8d4f2";
          ctx.lineWidth = 1;
          ctx.moveTo(itemRect.x, itemRect.y + itemRect.height - 0.5);
          ctx.lineTo(itemRect.x + itemRect.width, itemRect.y + itemRect.height - 0.5);
          ctx.stroke();
        }
      });
    }

    canvas.toBlob(blob => {
      if (!blob) {
        status.textContent = "PNG 파일 생성에 실패했습니다.";
        button.disabled = false;
        return;
      }
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "blue-archive-ranking.png";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      status.textContent = "결과를 PNG 파일로 저장했습니다.";
      button.disabled = false;
    }, "image/png");
  } catch (error) {
    console.error("PNG 저장 실패:", error);
    status.textContent = error.message || "PNG 저장에 실패했습니다.";
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