const fileInput = document.getElementById("fileInput");
const takePhotoBtn = document.getElementById("takePhoto");
const output = document.getElementById("output");
const c1 = document.getElementById("cvCanvas1");
const c2 = document.getElementById("cvCanvas2");
const startBtn = document.getElementById("startOCR");
const cropSelect = document.getElementById("cropSelect");
const rotateLeftBtn = document.getElementById("rotateLeft");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");

let srcMat = null;
let cropPercent = 0.9; // เริ่มต้น 90%

function validateThaiID(id){
  if(!/^\d{13}$/.test(id)) return false;
  const d=id.split('').map(Number);
  let s=0; for(let i=0;i<12;i++) s+=d[i]*(13-i);
  return (11-(s%11))%10===d[12];
}
function autoFixThaiIDByChecksum(id){
  if(!/^\d{13}$/.test(id)) return null;
  if(validateThaiID(id)) return id;
  const arr=id.split('').map(n=>+n);
  for(let i=0;i<13;i++){
    const orig=arr[i];
    for(let d=0;d<=9;d++){
      if(d===orig) continue;
      arr[i]=d;
      const cand=arr.join('');
      if(validateThaiID(cand)) return cand;
    }
    arr[i]=orig;
  }
  return null;
}

function autoContrastLevel(grayMat){
  const meanScalar=cv.mean(grayMat);
  const brightness=meanScalar[0];
  let claheClip=1.5,sharpWeight=1.2,blurWeight=-0.2,normMin=30,normMax=230;
  if(brightness<80){claheClip=3.0;sharpWeight=1.4;blurWeight=-0.4;normMin=20;normMax=250;}
  else if(brightness>150){claheClip=1.0;sharpWeight=1.1;blurWeight=-0.1;normMin=40;normMax=210;}
  return{claheClip,sharpWeight,blurWeight,normMin,normMax,brightness};
}

function drawCropGuides(){
  if(!srcMat) return;
  const ctx=c1.getContext("2d");
  ctx.clearRect(0,0,c1.width,c1.height);
  cv.imshow(c1,srcMat);
  const remain=cropPercent;
  const cut=(1-remain)/2;
  const y1=Math.floor(c1.height*cut);
  const y2=Math.floor(c1.height*(1-cut));
  ctx.beginPath();
  ctx.strokeStyle="red";
  ctx.lineWidth=3;
  ctx.moveTo(0,y1);
  ctx.lineTo(c1.width,y1);
  ctx.moveTo(0,y2);
  ctx.lineTo(c1.width,y2);
  ctx.stroke();
  ctx.fillStyle="rgba(255,0,0,0.8)";
  ctx.font="16px sans-serif";
  ctx.fillText(`พื้นที่ OCR กลาง ${Math.round(remain*100)}%`,10,Math.max(20,y1-10));
  console.log(`📷 แสดงภาพจากกล้องเรียบร้อย — เหลือภาพกลาง ${(remain*100).toFixed(0)}%`);
}

async function runOCR(mat,label="full"){
  const temp=document.createElement("canvas");
  temp.width=mat.cols;temp.height=mat.rows;
  cv.imshow(temp,mat);
  await new Promise(r=>setTimeout(r,10));
  const {data}=await Tesseract.recognize(temp,'eng',{tessedit_char_whitelist:'0123456789'});
  const txt=data.text.replace(/\s+/g,'');
  const m=txt.match(/\d{13}/);
  if(!m)return{cid:null,raw:txt,zone:label};
  let cid=m[0];
  if(!validateThaiID(cid)){const fix=autoFixThaiIDByChecksum(cid);if(fix)cid=fix;}
  return{cid:validateThaiID(cid)?cid:null,raw:txt,zone:label};
}

async function processImage(mat,maxW,angle){
  let gray=new cv.Mat();
  cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);
  const {claheClip,sharpWeight,blurWeight,normMin,normMax}=autoContrastLevel(gray);
  const clahe=new cv.CLAHE(claheClip,new cv.Size(8,8));
  const cl=new cv.Mat();clahe.apply(gray,cl);
  const blur=new cv.Mat();cv.GaussianBlur(cl,blur,new cv.Size(0,0),1.0);
  const sharp=new cv.Mat();cv.addWeighted(cl,sharpWeight,blur,blurWeight,0,sharp);
  const denoise=new cv.Mat();cv.bilateralFilter(sharp,denoise,5,30,30);
  cv.normalize(denoise,denoise,normMin,normMax,cv.NORM_MINMAX);
  const bin=new cv.Mat();cv.adaptiveThreshold(denoise,bin,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,35,10);
  const up=new cv.Mat();cv.resize(bin,up,new cv.Size(0,0),1.5,1.5,cv.INTER_CUBIC);
  cv.imshow(c2,up);
  const res=await runOCR(up,"center-zone");
  gray.delete();clahe.delete();cl.delete();blur.delete();sharp.delete();denoise.delete();bin.delete();up.delete();
  return{...res,maxW,angle};
}

takePhotoBtn.addEventListener("click", ()=>{
  const ctx1=c1.getContext("2d");
  const ctx2=c2.getContext("2d");
  ctx1.clearRect(0,0,c1.width,c1.height);
  ctx2.clearRect(0,0,c2.width,c2.height);
  if(srcMat){srcMat.delete();srcMat=null;}
  fileInput.value="";
  fileInput.click();
});

fileInput.addEventListener("change", e=>{
  const f=e.target.files[0];if(!f)return;
  const img=new Image();
  img.src=URL.createObjectURL(f);
  img.onload=()=>{
    const fileSizeMB=f.size/1024/1024;
    let maxW=img.width;if(fileSizeMB>2)maxW=1280;
    const scale=img.width>maxW?maxW/img.width:1;
    c1.width=img.width*scale;c1.height=img.height*scale;
    const ctx=c1.getContext("2d");
    ctx.drawImage(img,0,0,c1.width,c1.height);
    if(srcMat)srcMat.delete();
    srcMat=cv.imread(c1);
    drawCropGuides();
  };
});

rotateLeftBtn.onclick=()=>{
  if(!srcMat)return;
  const rot=new cv.Mat();
  cv.rotate(srcMat,rot,cv.ROTATE_90_COUNTERCLOCKWISE);
  srcMat.delete();
  srcMat=rot;
  cv.imshow(c1,srcMat);
  drawCropGuides();
};

cropSelect.addEventListener("change", ()=>{
  cropPercent=parseInt(cropSelect.value)/100;
  drawCropGuides();
});

startBtn.onclick=async()=>{
  if(!srcMat){output.textContent="❌ ยังไม่มีภาพ";return;}
  progressContainer.style.display = "block";
  progressBar.style.width = "0%";
  progressBar.style.backgroundColor = "red";
  output.textContent="";
  
  const remain=cropPercent;
  const cut=(1-remain)/2;
  const y1=Math.floor(srcMat.rows*cut);
  const y2=Math.floor(srcMat.rows*(1-cut));
  const cropHeight=y2-y1;
  const cropRect=new cv.Rect(0,y1,srcMat.cols,cropHeight);
  const cropped=srcMat.roi(cropRect).clone();
  output.textContent=`⏳ start OCR...`;
  console.log(`🟦 เริ่ม OCR ที่ crop ${(remain*100).toFixed(0)}% (${y1}-${y2})`);
  
  const resolutions=[800,960,1280];
  const aspect=cropped.cols/cropped.rows;
  const angles=(aspect>1.2)?[0]:[0,270,180,90];
  
  let results=[];
  let total=resolutions.length*angles.length;
  let done=0;

  for(const maxW of resolutions){
    console.log(`\n=== 🔍 ทดลองขนาด maxW=${maxW} ===`);
    const scale=cropped.cols>maxW?maxW/cropped.cols:1;
    const resized=new cv.Mat();cv.resize(cropped,resized,new cv.Size(0,0),scale,scale,cv.INTER_AREA);
    let found=false;
    for(const a of angles){
      if(found)break;
      console.log(`  ▶️ หมุนภาพ ${a}°`);
      let rot=new cv.Mat();
      if(a===0)rot=resized.clone();
      else if(a===90)cv.rotate(resized,rot,cv.ROTATE_90_CLOCKWISE);
      else if(a===180)cv.rotate(resized,rot,cv.ROTATE_180);
      else if(a===270)cv.rotate(resized,rot,cv.ROTATE_90_COUNTERCLOCKWISE);
      const res=await processImage(rot,maxW,a);
      results.push(res);
      done++;
      const percent=Math.round((done/total)*100);
      progressBar.style.width = percent+"%";

      // 🎨 เปลี่ยนสีตามเปอร์เซ็นต์
      if(percent < 50){
        // จากแดง (#ff0000) → เหลือง (#ffff00)
        const g = Math.floor((percent / 50) * 255);
        progressBar.style.backgroundColor = `rgb(255,${g},0)`;
      } else {
        // จากเหลือง (#ffff00) → เขียว (#00ff00)
        const r = Math.floor(255 - ((percent - 50) / 50) * 255);
        progressBar.style.backgroundColor = `rgb(${r},255,0)`;
      }

      console.log(`  ⏳ Progress ${percent}%`);
      if(res.cid){
        found=true;
        console.log(`✅ พบเลข ${res.cid} ที่ maxW=${maxW}, angle=${a}°`);
        break;
      }
      rot.delete();
    }
    resized.delete();
  }
  cropped.delete();
  progressBar.style.width = "100%";
  progressBar.style.backgroundColor = "rgb(0,255,0)";
  setTimeout(()=>progressContainer.style.display="none",1200);
  
  const ffil = results.filter(r=>r.cid).map(r=>r.cid);  
  console.log("filter: ",ffil)
  
  const found=results.find(r=>r.cid);
  if(ffil.length > 0){
    // นับจำนวนแต่ละค่าใน array
    const countMap = {};
    ffil.forEach(cid => {
      countMap[cid] = (countMap[cid] || 0) + 1;
    });

    const uniqcid = [...new Set(ffil)];
    console.log("unique: ", uniqcid);

    let result_html = "";
    uniqcid.forEach((cid, i) => {
      const isRecommend = countMap[cid] > 1;
      const label = isRecommend ? `ใช้ค่า <span class="star">⭐</span>` : "ใช้ค่า";
      const blinkClass = isRecommend ? "blink" : "";

      result_html += `
        <p class="clickable ${blinkClass}" onclick="chooseCid(${i})">
          <input type="hidden" id="ocrcid${i}" value="${cid}">
          ${cid} <span class="label">${label}</span>
        </p>
      `;
    });
    document.getElementById("ocr-select").innerHTML = result_html;
    output.textContent = "";
    //output.textContent=`✅ พบเลข ${found.cid} จาก zone ${found.zone}, มุม ${found.angle}°`;
    //console.log(`🎯 OCR Result: ${found.cid}`);
  }else{
    output.textContent=`❌ ไม่พบเลขบัตรในทุกขนาด`;
    console.warn("❌ ไม่พบเลขบัตรในทุกขนาด");
  }
};

function chooseCid(i){
  const cid = document.getElementById('ocrcid'+i).value
  console.log("chooseCid: ",cid)
}