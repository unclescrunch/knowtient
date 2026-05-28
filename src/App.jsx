import { useState, useEffect, useRef, useCallback } from "react";
import questionsData from "./pew-questions-v4.json";

// ─── SEEN QUESTIONS ───────────────────────────────────────────────────────────
const seenIds = new Set();

// ── Supabase score DB ──────────────────────────────────────────────────────────
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function saveScore(avg) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/scores`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPA_KEY,
        "Authorization": `Bearer ${SUPA_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ avg_off: parseFloat(avg.toFixed(1)) }),
    });
    if (!res.ok) console.warn("Score insert failed", res.status);
  } catch (e) { console.warn("Score insert error", e); }
}

async function fetchPercentile(avg) {
  // What % of all scores are WORSE (higher) than this score?
  // Uses HEAD requests — returns Content-Range header with exact count, no row data sent.
  // HEAD avoids the Range: 0-0 ambiguity which can return 416 on empty result sets.
  try {
    const avgRounded = parseFloat(avg.toFixed(1));
    const headers = {
      "apikey": SUPA_KEY,
      "Authorization": `Bearer ${SUPA_KEY}`,
      "Prefer": "count=exact",
    };
    const [worseRes, totalRes] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/scores?avg_off=gt.${avgRounded}&select=id`, { method:"HEAD", headers }),
      fetch(`${SUPA_URL}/rest/v1/scores?select=id`, { method:"HEAD", headers }),
    ]);
    const parseCR = (res) => {
      // Content-Range formats: "0-N/total" or "*/total" or "*/0"
      const cr = res.headers.get("Content-Range");
      if (!cr) return 0;
      const after = cr.split("/")[1];
      if (!after) return 0;
      const n = parseInt(after, 10);
      return isNaN(n) ? 0 : n;
    };
    const worseCount = parseCR(worseRes);
    const totalCount = parseCR(totalRes);
    if (totalCount < 5) return -1; // threshold: need 5+ scores for meaningful rank
    return Math.round((worseCount / totalCount) * 100);
  } catch (e) { console.warn("Percentile fetch error", e); return -2; }
}

// ─── MOBILE DETECTION ────────────────────────────────────────────────────────
const isMobile = () => /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ─── AUDIO ────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // Resume if suspended (happens on mobile after page loses focus or after first gesture)
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function playTick(value) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const t = value / 100;
    const freq = 110 + t * 754; // 110→864Hz
    // Fundamental: sine, 40ms decay
    const o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.connect(g1); g1.connect(ctx.destination);
    o1.type = "sine"; o1.frequency.setValueAtTime(freq, now);
    g1.gain.setValueAtTime(0.07, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    o1.start(now); o1.stop(now + 0.04);
    // 2x octave harmonic at 15% volume, decays in 20ms
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.connect(g2); g2.connect(ctx.destination);
    o2.type = "sine"; o2.frequency.setValueAtTime(freq * 2, now);
    g2.gain.setValueAtTime(0.07 * 0.15, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    o2.start(now); o2.stop(now + 0.02);
  } catch {}
}
function playSelect(value) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const t = value / 100;
    // Sound B — warm double tap, pitch informed by slider position
    // First pop: maps slider to 160→400Hz
    const freq1 = 160 + t * 240;
    const o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.connect(g1); g1.connect(ctx.destination);
    o1.type = "sine"; o1.frequency.setValueAtTime(freq1, now);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(0.20, now + 0.006);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
    o1.start(now); o1.stop(now + 0.10);
    // Second pop: 70ms later, slightly higher pitch
    const freq2 = freq1 * 1.3;
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.connect(g2); g2.connect(ctx.destination);
    o2.type = "sine"; o2.frequency.setValueAtTime(freq2, now + 0.07);
    g2.gain.setValueAtTime(0.0001, now + 0.07);
    g2.gain.linearRampToValueAtTime(0.16, now + 0.076);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    o2.start(now + 0.07); o2.stop(now + 0.17);
  } catch {}
}
function playFanfare() {
  try {
    const ctx = getAudioCtx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "triangle"; osc.frequency.setValueAtTime(freq, ctx.currentTime);
      const s = ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.126, s + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.55);
      osc.start(s); osc.stop(s + 0.6);
    });
  } catch {}
}
function playFailure() {
  try {
    const ctx = getAudioCtx();
    [311.13, 233.08].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); osc.type = "sawtooth";
      const s = ctx.currentTime + i * 0.28;
      osc.frequency.setValueAtTime(freq, s);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, s + 0.35);
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.154, s + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
      osc.start(s); osc.stop(s + 0.45);
    });
    const osc3 = ctx.createOscillator(); const g3 = ctx.createGain();
    osc3.connect(g3); g3.connect(ctx.destination); osc3.type = "sine";
    osc3.frequency.setValueAtTime(80, ctx.currentTime + 0.1);
    osc3.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.7);
    g3.gain.setValueAtTime(0.105, ctx.currentTime + 0.1);
    g3.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
    osc3.start(ctx.currentTime + 0.1); osc3.stop(ctx.currentTime + 0.8);
  } catch {}
}
function playEndChime() {
  try {
    const ctx = getAudioCtx();
    [261.63, 329.63, 392.0, 523.25, 659.25, 523.25].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      const s = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.11, s + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 2.0);
      osc.start(s); osc.stop(s + 2.1);
    });
  } catch {}
}

// ─── SHARE IMAGE GENERATOR ────────────────────────────────────────────────────
// Always 1080x1080. Layout: logo → tagline → highlight card → avg+% → CTA
// Dynamic font sizing: question/answer shrink to fit, nothing ever overflows.
function drawShareCanvas(avg, guesses, round, percentile) {
  const W = 1080, H = 1080;
  const canvas = document.createElement("canvas");
  const dpr = 2;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const PAD = 52, IW = W - PAD * 2;

  // Background + stripes
  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,"#2D2A5E"); grad.addColorStop(1,"#1a1840");
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.globalAlpha=0.04; ctx.strokeStyle="#C6FF00"; ctx.lineWidth=1;
  for(let x=-H;x<W+H;x+=52){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+H,H);ctx.stroke();}
  ctx.restore();

  // Helpers
  const rr=(x,y,w,h,r,fill,sc,sw)=>{
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(sc){ctx.strokeStyle=sc;ctx.lineWidth=sw||2;ctx.stroke();}
  };
  const ctr=(text,font,cx,y,fill)=>{
    ctx.font=font;ctx.fillStyle=fill;ctx.textAlign="center";
    ctx.fillText(text,cx,y);ctx.textAlign="left";
  };
  const wrapL=(text,font,mw)=>{
    ctx.font=font;
    const words=text.split(" ");let line="",lines=[];
    for(const w of words){
      const t=line?line+" "+w:w;
      if(ctx.measureText(t).width>mw&&line){lines.push(line);line=w;}else line=t;
    }
    if(line)lines.push(line);return lines;
  };
  const drawLL=(lines,font,x,y,fill,lh)=>{
    ctx.font=font;ctx.fillStyle=fill;ctx.textAlign="left";
    lines.forEach(l=>{ctx.fillText(l,x,y);y+=lh;});return y;
  };

  // ── Logo ──
  const LSIZ=78,CSIZ=28;
  ctx.font=`bold ${LSIZ}px 'Space Grotesk',sans-serif`;
  const kw=ctx.measureText("KNOW").width,tw=ctx.measureText("TIENT").width;
  ctx.font=`bold ${CSIZ}px 'Space Grotesk',sans-serif`;
  const cw=ctx.measureText(".com").width;
  const lx=(W-(kw+6+tw+5+cw))/2,txP=lx+kw+6,cxP=txP+tw+5;
  ctx.font=`bold ${LSIZ}px 'Space Grotesk',sans-serif`;
  const mK=ctx.measureText("KNOW"),mT=ctx.measureText("TIENT");
  ctx.font=`bold ${CSIZ}px 'Space Grotesk',sans-serif`;
  const mC=ctx.measureText(".com");
  const LOGO_TOP=28;
  const TIENT_BL=LOGO_TOP+(mT.actualBoundingBoxAscent||LSIZ*0.78);
  const KNOW_BL=TIENT_BL+10;
  const KNOW_PIX_BOT=KNOW_BL+(mK.actualBoundingBoxDescent||LSIZ*0.22);
  const COM_BL=KNOW_PIX_BOT-(mC.actualBoundingBoxDescent||CSIZ*0.22);
  const LOGO_END=Math.ceil(KNOW_PIX_BOT)+6;
  const logoW=(text,sz,bx,bl,sdx,sdy)=>{
    const f=`bold ${sz}px 'Space Grotesk',sans-serif`;
    ctx.font=f;ctx.textAlign="left";
    ctx.fillStyle="#00C8DC";ctx.fillText(text,bx+sdx,bl+sdy);
    ctx.fillStyle="#0F4619";ctx.fillText(text,bx+2,bl+2);
    ctx.fillStyle="#C6FF00";ctx.fillText(text,bx,bl);
  };
  logoW("KNOW",LSIZ,lx,KNOW_BL,5,5);
  logoW("TIENT",LSIZ,txP,TIENT_BL,5,5);
  logoW(".com",CSIZ,cxP,COM_BL,3,3);

  // ── Body font ──
  const L1="Thousands of Americans answered seven real questions.";
  const L2="Guess what % answered correctly.";
  const INTRO=(percentile !== null && percentile !== undefined && percentile >= 0)
    ? `I guessed better than ${percentile}% of other Knowtient players.`
    : "Play along at Knowtient.com";
  let bfSz=30;
  while(bfSz>16){
    ctx.font=`bold ${bfSz}px 'Space Grotesk',sans-serif`;
    if(ctx.measureText(L1).width<=IW)break;
    bfSz--;
  }
  const BF=`bold ${bfSz}px 'Space Grotesk',sans-serif`;
  const LH=bfSz+8;

  // ── Card data ──
  const withD=(round&&round.length)
    ?round.map((q,i)=>({q,g:guesses[i],delta:guesses[i]?Math.abs(guesses[i].guess-q.pct_correct):999}))
    :[];
  const best=withD.length?[...withD].sort((a,b)=>a.delta-b.delta)[0]:null;
  const cardQ=best?best.q.question:"—";
  const cardA=best?`Correct answer: ${best.q.correct_answer}`:"—";
  const cardReal=best?best.q.pct_correct:0;
  const cardMy=best&&best.g?best.g.guess:0;
  const PIN=22,ICW=IW-PIN*2;

  // Dynamic font sizing — shrink until fits within max lines
  const fitFont=(text,startSz,fontFn,mw,maxLines)=>{
    let sz=startSz;
    while(sz>=14){
      ctx.font=fontFn(sz);
      if(wrapL(text,fontFn(sz),mw).length<=maxLines)break;
      sz--;
    }
    return sz;
  };
  const qSz=fitFont(cardQ,30,sz=>`bold ${sz}px 'Space Grotesk',sans-serif`,ICW,5);
  const aSz=fitFont(cardA,26,sz=>`${sz}px 'Space Grotesk',sans-serif`,ICW,3);
  const F_TAG=`bold 24px 'Space Grotesk',sans-serif`;
  const F_Q=`bold ${qSz}px 'Space Grotesk',sans-serif`;
  const F_A=`${aSz}px 'Space Grotesk',sans-serif`;
  const F_N=`bold 108px 'Space Grotesk',sans-serif`;
  const F_L=`bold 26px 'Space Grotesk',sans-serif`;
  const qLines=wrapL(cardQ,F_Q,ICW);
  const aLines=wrapL(cardA,F_A,ICW);
  const TAG_H=54,Q_H=qLines.length*(qSz+7)+8,A_H=aLines.length*(aSz+6)+10,NUM_H=156;
  const card_h=PIN+TAG_H+Q_H+A_H+NUM_H+PIN;

  // ── Fixed minimum gaps — no overlap ever ──
  // Reserve space from bottom: CTA(108) + avg_block(LH+16+138) + card + tagline + logo
  // Place CTA at bottom, work upward to find card position
  const CTA_H_VAL=108, AVG_BLOCK=LH+16+138, MIN_GAP=20;
  // Total content height
  const content_h = LOGO_END + MIN_GAP + LH*2 + MIN_GAP + card_h + MIN_GAP + AVG_BLOCK + MIN_GAP + CTA_H_VAL;
  // If content fits, distribute extra space as padding; if not, use min gaps
  const spare = H - 28 - content_h;
  const gap = spare > 0 ? Math.floor(spare/5) + MIN_GAP : MIN_GAP;

  // ── Draw ──
  let y = LOGO_END + gap;

  // Tagline
  ctr(L1,BF,W/2,y,"#F5F0E8");y+=LH;
  ctr(L2,BF,W/2,y,"#F5F0E8");y+=LH+gap;

  // Card
  rr(PAD,y,IW,card_h,14,"#363375","#3DB87A",3);
  let cy=y+PIN+10;  // extra top padding inside card
  ctx.font=F_TAG;ctx.fillStyle="#3DB87A";ctx.textAlign="left";
  ctx.fillText("★ MY CLOSEST GUESS",PAD+PIN,cy);cy+=TAG_H;
  cy=drawLL(qLines,F_Q,PAD+PIN,cy,"#F5F0E8",qSz+7);cy+=8;
  cy=drawLL(aLines,F_A,PAD+PIN,cy,"#C8C3B8",aSz+6);cy+=12;
  const cw2=IW/2;
  [{lbl:"Real % who knew",val:`${cardReal}%`,col:"#F5F0E8"},
   {lbl:"My guess",val:`${cardMy}%`,col:"#F5A623"}
  ].forEach(({lbl,val,col},i)=>{
    const ccx=PAD+cw2*i+cw2/2;
    ctx.font=F_N;ctx.fillStyle=col;ctx.textAlign="center";ctx.fillText(val,ccx,cy+108);
    ctx.font=F_L;ctx.fillStyle="#C8C3B8";ctx.fillText(lbl,ccx,cy+108+30);
  });
  ctx.textAlign="left";
  y+=card_h+gap;

  // Rank block: "I guessed better than / [BIG %] / of other Knowtient players."
  // Falls back to avg if no percentile
  const hasRank = percentile !== null && percentile !== undefined && percentile >= 0;
  if (hasRank) {
    const rankStr = `${percentile}%`;
    const rankNumH = 130;
    // Measure actual ascent/descent so we can truly center the number visually
    ctx.font = `bold ${rankNumH}px 'Space Grotesk',sans-serif`;
    const rankM = ctx.measureText(rankStr);
    const rankAsc = rankM.actualBoundingBoxAscent  || rankNumH * 0.78;
    const rankDes = rankM.actualBoundingBoxDescent || rankNumH * 0.14;
    const rankVisH = rankAsc + rankDes;  // actual pixel height of the glyph
    const rankGap = 20;  // gap between label and top of glyph

    ctr("I guessed better than", BF, W/2, y, "#C8C3B8"); y += LH + rankGap;
    // Baseline = y + rankAsc (so glyph top is exactly at y)
    const rw = ctx.measureText(rankStr).width, rnx = Math.round((W-rw)/2);
    ctx.fillStyle = "#E8634A"; ctx.fillText(rankStr, rnx+8, y+rankAsc+8);
    ctx.fillStyle = "#C6FF00"; ctx.fillText(rankStr, rnx,   y+rankAsc);
    y += rankVisH + rankGap;
    ctr("of other Knowtient players.", BF, W/2, y, "#C8C3B8"); y += LH + gap;
  } else {
    // No rank yet — show avg as before
    ctr(INTRO, BF, W/2, y, "#C8C3B8"); y += LH + 16;
    ctx.font = `bold 130px 'Space Grotesk',sans-serif`;
    const avgStr = `${avg.toFixed(1)}%`;
    const aw = ctx.measureText(avgStr).width, nx = Math.round((W-aw)/2);
    ctx.fillStyle = "#E8634A"; ctx.fillText(avgStr, nx+8, y+130+8);
    ctx.fillStyle = "#F5A623"; ctx.fillText(avgStr, nx, y+130);
    y += 138 + gap;
  }

  // CTA — alternating stripes, with bottom padding
  const BOTTOM_PAD=32;
  const BX=PAD,BY=y,BW=IW,BH=Math.min(108, H-y-BOTTOM_PAD),R=14;
  const sc=document.createElement("canvas");
  sc.width=W*dpr;sc.height=H*dpr;
  const sx=sc.getContext("2d");sx.scale(dpr,dpr);
  let si=0;
  for(let x2=BX-BH;x2<BX+BW+BH;x2+=20){
    sx.fillStyle=si%2===0?"rgba(200,115,8,0.78)":"rgba(210,70,40,0.70)";
    sx.save();sx.translate(x2,BY);
    sx.beginPath();sx.moveTo(0,0);sx.lineTo(20,0);sx.lineTo(20+BH,BH);sx.lineTo(BH,BH);
    sx.closePath();sx.fill();sx.restore();si++;
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(BX+R,BY);ctx.lineTo(BX+BW-R,BY);ctx.quadraticCurveTo(BX+BW,BY,BX+BW,BY+R);
  ctx.lineTo(BX+BW,BY+BH-R);ctx.quadraticCurveTo(BX+BW,BY+BH,BX+BW-R,BY+BH);
  ctx.lineTo(BX+R,BY+BH);ctx.quadraticCurveTo(BX,BY+BH,BX,BY+BH-R);
  ctx.lineTo(BX,BY+R);ctx.quadraticCurveTo(BX,BY,BX+R,BY);
  ctx.closePath();ctx.clip();
  ctx.drawImage(sc,0,0,W,H);
  ctx.restore();
  rr(BX+3,BY+3,BW-6,BH-6,R-2,null,"rgba(180,100,5,0.8)",2);
  const CTA_TEXT="Beat my score at KNOWTIENT.com";
  let ctaSz=Math.max(22,Math.floor((BH-40)*0.72));
  while(ctaSz>16){ctx.font=`bold ${ctaSz}px 'Space Grotesk',sans-serif`;if(ctx.measureText(CTA_TEXT).width<=BW-64)break;ctaSz-=2;}
  ctx.font=`bold ${ctaSz}px 'Space Grotesk',sans-serif`;
  const ctaM=ctx.measureText(CTA_TEXT);
  const ctaA=ctaM.actualBoundingBoxAscent||ctaSz*0.72;
  const ctaD=ctaM.actualBoundingBoxDescent||ctaSz*0.18;
  ctx.fillStyle="#F5F0E8";ctx.textAlign="center";
  ctx.fillText(CTA_TEXT,W/2,BY+Math.round((BH+ctaA-ctaD)/2));
  ctx.textAlign="left";

  return canvas.toDataURL("image/png");
}

// Download a data URL as a file
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename; a.click();
}

// Convert data URL to File for Web Share API
function dataUrlToFile(dataUrl, filename) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

// Platform SVG icons — official brand marks, white fill on dark buttons
const PLATFORM_ICONS = {
  fb: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  ig: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
};

// Platform configs
const ENCODED_URL = encodeURIComponent("https://knowtient.com");
const ENCODED_TITLE = encodeURIComponent("Knowtient — Guess What % of Americans Knew");
const ENCODED_DESC  = encodeURIComponent("Guess what % of Americans knew the answers to seven common questions. Real Pew Research data.");

const PLATFORMS = [
  { id:"linkedin", label:"LinkedIn",  filename:"Knowtient Game Score.png",
    url:`https://www.linkedin.com/sharing/share-offsite/?url=${ENCODED_URL}`, svgKey:"linkedin" },
  { id:"ig",       label:"Instagram", filename:"Knowtient Game Score.png",
    url:"https://www.instagram.com/",              svgKey:"ig" },
  { id:"tiktok",   label:"TikTok",    filename:"Knowtient Game Score.png",
    url:"https://www.tiktok.com/upload",           svgKey:"tiktok" },
  { id:"fb",       label:"Facebook",  filename:"Knowtient Game Score.png",
    url:`https://www.facebook.com/sharer/sharer.php?u=${ENCODED_URL}&quote=${ENCODED_DESC}`, svgKey:"fb" },
];

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Righteous&family=Space+Grotesk:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap');

    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    :root {
      --color-base:      #2D2A5E;
      --color-surface:   #363375;
      --color-border:    #4E4A8A;
      --color-text:      #F5F0E8;
      --color-secondary: #C8C3B8;
      --color-amber:     #F5A623;
      --color-coral:     #E8634A;
      --color-green:     #3DB87A;
      --color-red:       #FF2D2D;
      --color-neon-lime: #C6FF00;
      --color-neon-cyan: #00F0FF;
      --color-big-miss-bg:     #2a1a16;
      --color-big-miss-border: #6B2A1A;
    }
    html,body,#root { height:100%; width:100%; background:var(--color-base); color:var(--color-text); font-family:'Space Grotesk',sans-serif; -webkit-font-smoothing:antialiased; overflow:hidden; }
    .app-shell { height:100dvh; width:100%; max-width:430px; margin:0 auto; display:flex; flex-direction:column; position:relative; overflow:hidden; }

    /* PROGRESS */
    .progress-bar-track { height:6px; background:var(--color-border); flex-shrink:0; }
    .progress-bar-fill  { height:100%; background:var(--color-amber); border-radius:3px; transition:width 0.4s ease; }
    .progress-meta-row  { display:flex; justify-content:space-between; align-items:center; padding:8px 20px 0; }
    .progress-q-label   { font-family:'DM Mono',monospace; font-size:13px; font-weight:500; color:var(--color-secondary); }
    .progress-avg-label { font-family:'DM Mono',monospace; font-size:13px; font-weight:500; color:var(--color-amber); }

    /* SCREENS */
    .screen-wrap { flex:1; overflow:hidden; position:relative; }
    .screen { position:absolute; inset:0; overflow-y:auto; overflow-x:hidden; padding:14px 18px 32px; scrollbar-width:none; }
    .screen::-webkit-scrollbar { display:none; }
    .screen-enter           { animation:slideInRight 0.25s ease-out forwards; }
    .screen-exit            { animation:slideOutLeft 0.25s ease-out forwards; }
    .screen-enter-from-left { animation:slideInLeft  0.25s ease-out forwards; }
    @keyframes slideInRight { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
    @keyframes slideOutLeft { from{transform:translateX(0);opacity:1} to{transform:translateX(-100%);opacity:0} }
    @keyframes slideInLeft  { from{transform:translateX(-40%);opacity:0} to{transform:translateX(0);opacity:1} }

    /* BUTTONS */
    .btn-primary { display:flex; align-items:center; justify-content:center; width:100%; min-height:50px; padding:0 24px; background:var(--color-amber); color:var(--color-base); font-family:'Space Grotesk',sans-serif; font-size:17px; font-weight:700; letter-spacing:0.04em; border:none; border-radius:12px; cursor:pointer; transition:transform 80ms ease; -webkit-tap-highlight-color:transparent; }
    .btn-primary:active:not(:disabled) { transform:scale(0.96); }
    .btn-primary:disabled { opacity:0.25; cursor:default; }
    .btn-primary.large { font-size:22px; min-height:60px; }
    .btn-secondary { display:flex; align-items:center; justify-content:center; width:100%; min-height:50px; padding:0 24px; background:transparent; color:var(--color-text); font-family:'Space Grotesk',sans-serif; font-size:16px; font-weight:700; border:2px solid var(--color-border); border-radius:12px; cursor:pointer; transition:transform 80ms ease; -webkit-tap-highlight-color:transparent; }
    .btn-secondary:active { transform:scale(0.96); }
    .card          { background:var(--color-surface); border:2px solid var(--color-border); border-radius:14px; padding:14px 16px; }
    .card-big-miss { background:var(--color-big-miss-bg); border:2px solid var(--color-big-miss-border); border-radius:14px; padding:14px 16px; }

    /* QUESTION SCREEN */
    .question-screen { display:flex; flex-direction:column; min-height:100%; overflow-y:visible; }
    .q-meta-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; margin-top:2px; flex-shrink:0; }
    .q-category-pill { font-family:'DM Mono',monospace; font-size:17px; font-weight:500; color:var(--color-secondary); text-transform:uppercase; letter-spacing:0.06em; }
    .q-source-dot { width:4px; height:4px; border-radius:50%; background:var(--color-border); flex-shrink:0; }
    .q-source-label { font-family:'DM Mono',monospace; font-size:17px; font-weight:500; color:var(--color-secondary); }
    .q-text { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:700; line-height:1.3; color:var(--color-text); margin-bottom:8px; flex-shrink:0; }
    .slider-section { flex-shrink:0; background:rgba(255,255,255,0.06); border:2px solid rgba(245,166,35,0.35); border-radius:14px; padding:8px 12px 8px; margin-bottom:8px; }
    .slider-prompt-label { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:700; color:var(--color-text); margin-bottom:4px; text-align:center; }
    .slider-live-number { font-family:'DM Mono',monospace; font-size:40px; font-weight:500; text-align:center; transition:color 0.15s; min-height:46px; display:flex; align-items:center; justify-content:center; line-height:1; }
    .slider-live-number.active   { color:var(--color-amber); }
    .slider-live-number.inactive { color:var(--color-border); }
    .slider-live-pct { font-size:20px; }
    .slider-drag-hint { font-family:'DM Mono',monospace; font-size:14px; font-weight:500; text-align:center; color:var(--color-secondary); height:16px; margin-bottom:4px; transition:opacity 0.25s; }
    .slider-drag-hint.hidden { opacity:0; }
    .slider-wrap { position:relative; padding:14px 0; margin-bottom:2px; cursor:pointer; }
    .slider-track-bg   { position:absolute; top:50%; left:0; right:0; height:8px; transform:translateY(-50%); background:var(--color-border); border-radius:4px; pointer-events:none; z-index:0; }
    .slider-track-fill { position:absolute; top:50%; left:0; height:8px; transform:translateY(-50%); background:var(--color-amber); border-radius:4px; pointer-events:none; z-index:1; transition:width 0.03s; }
    .slider-input { -webkit-appearance:none; appearance:none; position:relative; z-index:2; width:100%; height:8px; background:transparent; outline:none; cursor:pointer; }
    .slider-input::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:26px; height:26px; border-radius:50%; background:var(--color-amber); border:3px solid var(--color-base); box-shadow:0 0 0 3px rgba(245,166,35,0.3),0 0 12px rgba(245,166,35,0.4); cursor:grab; transition:box-shadow 0.12s,transform 0.08s; }
    .slider-input:active::-webkit-slider-thumb { cursor:grabbing; transform:scale(0.82); box-shadow:0 0 0 12px rgba(245,166,35,0.15),0 0 22px rgba(245,166,35,0.5); }
    .slider-input::-moz-range-thumb { width:26px; height:26px; border-radius:50%; background:var(--color-amber); border:3px solid var(--color-base); cursor:grab; }

    /* ANSWER CHOICES */
    .answer-choices-wrap { overflow-y:visible; overflow-x:hidden; }
    .answer-choices-wrap::-webkit-scrollbar { display:none; }
    /* Question screen scrolls as a whole on mobile — no inner scroll container */
    .answer-choices-label { font-family:'DM Mono',monospace; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.08em; color:var(--color-secondary); opacity:0.7; margin-bottom:6px; }
    .answer-choices { display:flex; flex-direction:column; gap:5px; padding-bottom:12px; }
    .answer-choice { display:flex; align-items:flex-start; gap:10px; background:rgba(54,51,117,0.5); border:1.5px solid rgba(78,74,138,0.5); border-radius:8px; padding:8px 10px; opacity:0; transform:translateY(10px) scale(0.97); pointer-events:none; cursor:default; user-select:none; }
    .answer-choice.animate-in { animation:choiceBounceIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards; }
    @keyframes choiceBounceIn { from{opacity:0;transform:translateY(14px) scale(0.97)} to{opacity:0.7;transform:translateY(0) scale(1)} }
    .answer-choice-letter { font-family:'DM Mono',monospace; font-size:16px; font-weight:500; color:var(--color-secondary); flex-shrink:0; padding-top:1px; min-width:20px; }
    .answer-choice-text   { font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:400; color:var(--color-secondary); line-height:1.35; }

    /* REVEAL */
    .reveal-screen { display:flex; flex-direction:column; min-height:100%; }
    .reveal-top-label { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--color-secondary); text-align:center; margin-bottom:8px; margin-top:4px; }
    .reveal-big-number-wrap { display:flex; justify-content:center; margin-bottom:4px; }
    .reveal-bar-section { margin-bottom:0; min-height:72px; }
    .reveal-bar-track { position:relative; height:12px; background:var(--color-border); border-radius:6px; }
    .reveal-bar-fill { height:100%; border-radius:6px; transition:width 1.4s cubic-bezier(0.34,1.4,0.64,1); }
    .reveal-bar-fill::after { content:''; position:absolute; top:0; left:-60%; width:60%; height:100%; background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.5) 50%,transparent 100%); border-radius:6px; opacity:0; }
    .reveal-bar-fill.wave-go::after { animation:shimmerWave 1s 1.3s ease-out forwards; }
    @keyframes shimmerWave { 0%{left:-60%;opacity:1} 100%{left:110%;opacity:0.4} }
    .reveal-guess-marker { position:absolute; top:-10px; width:5px; height:32px; background:var(--color-neon-cyan); border-radius:3px; box-shadow:0 0 10px var(--color-neon-cyan),0 0 20px rgba(0,240,255,0.4); }
    .reveal-guess-marker-label { position:absolute; top:30px; transform:translateX(-50%); font-family:'DM Mono',monospace; font-size:22px; font-weight:500; color:var(--color-neon-cyan); white-space:nowrap; text-shadow:0 0 10px rgba(0,240,255,0.5); }
    /* delta row pushed down to clear the marker label (which needs ~60px below bar) */
    .reveal-delta-row { text-align:center; margin-top:18px; margin-bottom:4px; }
    .reveal-delta-number { font-family:'DM Mono',monospace; font-size:24px; font-weight:500; }
    .reveal-delta-number.green { color:var(--color-neon-lime); text-shadow:0 0 12px rgba(198,255,0,0.5); }
    .reveal-delta-number.amber { color:var(--color-amber); text-shadow:0 0 12px rgba(245,166,35,0.4); }
    .reveal-delta-number.red   { color:var(--color-red); text-shadow:0 0 14px rgba(255,45,45,0.6); }
    .reveal-voice-label { font-family:'Righteous',cursive; font-size:26px; text-align:center; margin-bottom:20px; min-height:38px; }
    .reveal-voice-label.green { color:var(--color-neon-lime); text-shadow:0 0 16px rgba(198,255,0,0.6); }
    .reveal-voice-label.amber { color:var(--color-amber); text-shadow:0 0 16px rgba(245,166,35,0.5); }
    .reveal-voice-label.red   { color:var(--color-red); text-shadow:0 0 18px rgba(255,45,45,0.7); }
    .reveal-question-recap { margin-bottom:16px; }
    .reveal-recap-q { font-family:'Space Grotesk',sans-serif; font-size:17px; font-weight:600; color:var(--color-secondary); line-height:1.35; margin-bottom:8px; padding:0 2px; }
    .reveal-answer-card { margin-bottom:16px; }
    .reveal-answer-card-label { font-family:'DM Mono',monospace; font-size:16px; font-weight:500; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-secondary); margin-bottom:7px; }
    .reveal-answer-card-text  { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:500; color:var(--color-text); }
    .reveal-bar-reality-label { display:none; }
    .reveal-bottom { margin-top:16px; display:flex; flex-direction:column; gap:10px; }
    .reveal-tap-hint { font-family:'DM Mono',monospace; font-size:13px; color:var(--color-secondary); text-align:center; opacity:0.55; }
    .flash-overlay { position:fixed; inset:0; opacity:0; pointer-events:none; z-index:100; }
    .flash-overlay.active      { background:var(--color-red);       animation:flashPulse 0.45s ease-out forwards; }
    .flash-overlay.flash-green { background:var(--color-neon-lime); animation:flashPulse 0.35s ease-out forwards; }
    @keyframes flashPulse { 0%{opacity:0.3} 100%{opacity:0} }

    /* END SCREEN */
    .end-screen { display:flex; flex-direction:column; min-height:100%; position:relative; overflow:hidden; background:var(--color-base); }
    /* Subtle pulsing glow instead of SVG waves — no bleed risk */
    .end-screen::before { content:''; position:absolute; inset:0; background:radial-gradient(ellipse 80% 60% at 50% 100%,rgba(198,255,0,0.08) 0%,transparent 70%),radial-gradient(ellipse 60% 40% at 20% 80%,rgba(245,166,35,0.06) 0%,transparent 60%); animation:endGlow 6s ease-in-out infinite; pointer-events:none; z-index:0; }
    @keyframes endGlow { 0%,100%{opacity:1} 50%{opacity:0.6} }
    .end-wave-bg { display:none; }
    .end-wave-1,.end-wave-2,.end-wave-3 { display:none; }
    .end-content { position:relative; z-index:1; display:flex; flex-direction:column; flex:1; padding:20px 18px 8px; align-items:center; text-align:center; }

    .end-headline { font-family:'Righteous',cursive; font-size:clamp(32px,9vw,52px); color:#C6FF00; letter-spacing:0.04em; line-height:1.1; margin-bottom:8px; text-shadow:2px 3px 0 #1a7a50,0 0 20px rgba(198,255,0,0.5); width:100%; text-align:center; }
    .end-subhead  { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:700; color:var(--color-text); margin-bottom:4px; max-width:320px; }
    .end-avg-intro { font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:600; color:var(--color-secondary); margin-bottom:0; }
    .percentile-wrap { text-align:center; margin:8px 0 4px; min-height:80px; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .percentile-label-top { font-family:'Space Grotesk',sans-serif; font-size:13px; font-weight:500; color:var(--color-secondary); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px; }
    .percentile-label-bot { font-family:'Space Grotesk',sans-serif; font-size:13px; font-weight:500; color:var(--color-secondary); text-transform:uppercase; letter-spacing:0.08em; margin-top:2px; }
    .percentile-number-svg { overflow:visible; display:block; width:180px; }
    @keyframes percentileBounce { 0%{transform:scale(0.4);opacity:0} 60%{transform:scale(1.12)} 80%{transform:scale(0.96)} 100%{transform:scale(1);opacity:1} }
    .percentile-bounce { animation: percentileBounce 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards; }
    .percentile-calculating { font-family:'DM Mono',monospace; font-size:13px; color:var(--color-secondary); }
    .end-avg-number-wrap { display:flex; justify-content:center; width:100%; margin-bottom:10px; animation:avgDance 3.2s ease-in-out infinite; }
    @keyframes avgDance { 0%,100%{transform:translateY(0) rotate(0deg) scale(1)} 15%{transform:translateY(-7px) rotate(-2deg) scale(1.04)} 35%{transform:translateY(4px) rotate(1.5deg) scale(0.97)} 55%{transform:translateY(-4px) rotate(-1deg) scale(1.02)} 75%{transform:translateY(3px) rotate(1deg) scale(0.99)} 88%{transform:translateY(-2px) rotate(-0.5deg) scale(1.01)} }

    /* Highlight cards */
    .end-highlights { display:flex; flex-direction:column; gap:10px; margin-bottom:14px; width:100%; }
    .highlight-card { background:var(--color-surface); border:2px solid var(--color-border); border-radius:14px; padding:14px 16px; text-align:left; }
    .highlight-card.best  { border-color:#3DB87A; }
    .highlight-card.worst { border-color:var(--color-red); }
    .highlight-tag { font-family:'DM Mono',monospace; font-size:13px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:6px; }
    .highlight-tag.best  { color:#3DB87A; }
    .highlight-tag.worst { color:var(--color-red); }
    .highlight-question { font-family:'Space Grotesk',sans-serif; font-size:14px; font-weight:600; color:var(--color-text); line-height:1.4; margin-bottom:6px; }
    .highlight-answer   { font-family:'Space Grotesk',sans-serif; font-size:13px; color:var(--color-secondary); margin-bottom:8px; }
    .highlight-answer span { color:var(--color-text); font-weight:600; }
    .highlight-nums { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
    .highlight-num-block { display:flex; flex-direction:column; align-items:center; }
    .highlight-big-num { font-family:'Righteous',cursive; font-size:46px; line-height:1; }
    .highlight-big-num.real  { color:var(--color-amber); text-shadow:0 0 14px rgba(245,166,35,0.4); }
    .highlight-big-num.you   { color:var(--color-neon-cyan); text-shadow:0 0 10px rgba(0,240,255,0.35); }
    .highlight-big-num.delta.green { color:var(--color-neon-lime); }
    .highlight-big-num.delta.amber { color:var(--color-amber); }
    .highlight-big-num.delta.red   { color:var(--color-red); }
    .highlight-num-label { font-family:'DM Mono',monospace; font-size:10px; font-weight:500; color:var(--color-secondary); text-transform:uppercase; letter-spacing:0.07em; margin-top:2px; }
    .highlight-sep { font-family:'DM Mono',monospace; font-size:20px; color:var(--color-border); align-self:center; }
    .end-ctas { display:flex; flex-direction:column; gap:8px; padding-bottom:8px; margin-top:auto; width:100%; }

    /* FULL DEBRIEF MODAL */
    .debrief-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.78); z-index:300; display:flex; align-items:flex-end; animation:fadeIn 0.2s ease; }
    .debrief-sheet { background:var(--color-base); border-top:2px solid var(--color-border); border-radius:20px 20px 0 0; width:100%; max-height:88dvh; overflow-y:auto; padding:20px 20px 48px; }
    .debrief-sheet-handle { width:40px; height:4px; background:var(--color-border); border-radius:2px; margin:0 auto 16px; }
    .debrief-sheet-title { font-family:'Righteous',cursive; font-size:22px; color:#C6FF00; letter-spacing:0.04em; margin-bottom:20px; text-shadow:0 0 12px rgba(198,255,0,0.35); }
    .debrief-row { background:var(--color-surface); border:2px solid var(--color-border); border-radius:14px; padding:18px; margin-bottom:14px; }
    .debrief-row-idx { font-family:'DM Mono',monospace; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.1em; color:var(--color-secondary); margin-bottom:8px; }
    .debrief-row-question { font-family:'Space Grotesk',sans-serif; font-size:clamp(16px,4vw,20px); font-weight:700; color:var(--color-text); line-height:1.4; margin-bottom:8px; }
    .debrief-row-answer   { font-family:'Space Grotesk',sans-serif; font-size:clamp(15px,3.8vw,18px); color:var(--color-secondary); margin-bottom:14px; line-height:1.4; }
    .debrief-row-answer span { color:var(--color-text); font-weight:600; }
    .debrief-row-nums { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }
    .debrief-num-block { display:flex; flex-direction:column; align-items:center; }
    .debrief-big-num { font-family:'Righteous',cursive; font-size:clamp(34px,9vw,44px); line-height:1; }
    .debrief-big-num.real  { color:var(--color-amber); }
    .debrief-big-num.you   { color:var(--color-neon-cyan); }
    .debrief-big-num.delta.green { color:var(--color-neon-lime); }
    .debrief-big-num.delta.amber { color:var(--color-amber); }
    .debrief-big-num.delta.red   { color:var(--color-red); }
    .debrief-num-label { font-family:'DM Mono',monospace; font-size:clamp(11px,2.8vw,14px); font-weight:500; color:var(--color-secondary); text-transform:uppercase; letter-spacing:0.07em; margin-top:4px; }
    .debrief-sep { font-family:'DM Mono',monospace; font-size:22px; color:var(--color-border); align-self:center; }

    /* SHARE CARD */
    .share-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:200; display:flex; align-items:center; justify-content:center; padding:20px; animation:fadeIn 0.18s ease; }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    .share-card { background:var(--color-surface); border:2px solid var(--color-border); border-radius:16px; padding:24px 20px; width:100%; max-width:390px; max-height:90dvh; overflow-y:auto; scrollbar-width:none; }
    .share-card::-webkit-scrollbar { display:none; }
    .share-card-headline { font-family:'Righteous',cursive; font-size:28px; color:#C6FF00; letter-spacing:0.04em; margin-bottom:12px; text-shadow:0 0 12px rgba(198,255,0,0.35); line-height:1.2; display:inline-flex; align-items:baseline; gap:3px; }
    .share-card-subhead  { font-family:'Space Grotesk',sans-serif; font-size:16px; font-weight:700; color:var(--color-text); margin-bottom:4px; }
    .share-card-avg-line { font-family:'Space Grotesk',sans-serif; font-size:15px; color:var(--color-secondary); margin-bottom:2px; }
    .share-score-row  { display:flex; align-items:baseline; gap:6px; margin-bottom:10px; }
    .share-score-num  { font-family:'Righteous',cursive; font-size:52px; color:var(--color-amber); line-height:1; text-shadow:0 0 18px rgba(245,166,35,0.4); }
    .share-score-unit { font-family:'DM Mono',monospace; font-size:15px; font-weight:500; color:var(--color-secondary); }
    .share-dots { display:flex; gap:5px; flex-wrap:wrap; margin-bottom:16px; }
    .share-dot  { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'DM Mono',monospace; font-size:9px; font-weight:700; color:var(--color-base); }
    .share-dot.green { background:var(--color-neon-lime); }
    .share-dot.amber { background:var(--color-amber); }
    .share-dot.red   { background:var(--color-red); }
    .share-divider { height:1.5px; background:var(--color-border); margin:14px 0; }

    /* Mobile share section */
    .share-mobile-section { display:flex; flex-direction:column; gap:8px; }
    .share-label { font-family:'DM Mono',monospace; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:0.1em; color:var(--color-secondary); margin-bottom:4px; }

    /* Desktop platform grid */
    .share-desktop-section {}
    .share-platform-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:4px; }
    .share-platform-btn { display:flex; align-items:center; gap:10px; padding:12px 14px; background:var(--color-base); border:2px solid var(--color-border); border-radius:10px; cursor:pointer; font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:600; color:var(--color-text); transition:transform 80ms ease,border-color 0.15s; -webkit-tap-highlight-color:transparent; text-decoration:none; }
    .share-platform-btn:active { transform:scale(0.96); }
    .share-platform-btn:hover  { border-color:var(--color-amber); }
    .share-platform-icon { font-size:22px; }
    .share-platform-info { display:flex; flex-direction:column; }
    .share-platform-name { font-size:15px; font-weight:700; }
    .share-platform-size { font-family:'DM Mono',monospace; font-size:11px; color:var(--color-secondary); }
    .share-status { font-family:'DM Mono',monospace; font-size:12px; color:var(--color-neon-lime); text-align:center; min-height:18px; margin-top:6px; }

    /* SPLASH */
    .splash { display:flex; flex-direction:column; justify-content:space-between; min-height:100%; padding-top:32px; }
    .splash-top { flex:1; display:flex; flex-direction:column; justify-content:center; }
    .splash-rules { display:flex; flex-direction:column; gap:0; }
    .splash-rule { display:flex; align-items:flex-start; gap:16px; padding:20px 0; }
    .splash-rule-divider { height:1.5px; background:var(--color-border); border-radius:1px; }
    .splash-rule-icon { font-size:28px; flex-shrink:0; line-height:1; padding-top:2px; }
    .splash-rule-text { font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:400; color:var(--color-text); line-height:1.45; }
    .splash-rule-text strong { color:var(--color-amber); font-weight:700; }
    .splash-bottom { padding-bottom:40px; display:flex; flex-direction:column; gap:10px; }
    .splash-bottom .btn-primary { font-size:22px; min-height:62px; }
    .splash-source-note { display:none; }
    .btn-about { background:transparent; border:none; color:var(--color-secondary); font-family:'DM Mono',monospace; font-size:22px; font-weight:700; text-align:center; cursor:pointer; text-decoration:underline; text-underline-offset:3px; padding:10px; -webkit-tap-highlight-color:transparent; letter-spacing:0.04em; }
    .btn-about:hover { color:var(--color-text); }
    /* About lightbox */
    .about-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.78); z-index:400; display:flex; align-items:center; justify-content:center; padding:24px; animation:fadeIn 0.2s ease; }
    .about-box { background:var(--color-surface); border:2px solid var(--color-border); border-radius:18px; padding:32px 28px; width:100%; max-width:420px; position:relative; }
    .about-close { position:absolute; top:16px; right:18px; background:transparent; border:none; color:var(--color-secondary); font-size:22px; cursor:pointer; line-height:1; padding:4px 8px; }
    .about-close:hover { color:var(--color-text); }
    .about-title { font-family:'Righteous',cursive; font-size:22px; color:#C6FF00; letter-spacing:0.04em; margin-bottom:16px; text-shadow:0 0 12px rgba(198,255,0,0.3); }
    .about-body { font-family:'Space Grotesk',sans-serif; font-size:17px; font-weight:400; color:var(--color-text); line-height:1.65; }

    /* TITLE BAR — hidden on end screen */
    .app-title-bar { display:flex; align-items:center; justify-content:center; padding:10px 18px 4px; flex-shrink:0; }
    .app-title-bar-text { font-family:'Righteous',cursive; font-size:26px; color:#C6FF00; letter-spacing:0.06em; text-shadow:1px 2px 0 #1a7a50,0 0 14px rgba(198,255,0,0.55); display:inline-flex; align-items:baseline; gap:1px; }
    .kt-know  { position:relative; top:2px; }
    .kt-tient { position:relative; top:0; }

    /* ══ TITLE SCREEN ══ */
    .title-screen { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px 28px 56px; overflow:hidden; cursor:pointer; background:var(--color-base); }
    .title-bg-stripes { position:absolute; inset:-50%; width:200%; height:200%; background:repeating-linear-gradient(-45deg,#2D2A5E 0px,#2D2A5E 28px,#1a1850 28px,#1a1850 56px); animation:stripeWave 4s ease-in-out infinite; z-index:0; }
    @keyframes stripeWave { 0%,100%{transform:translateX(0) translateY(0);opacity:1} 25%{transform:translateX(8px) translateY(-4px);opacity:0.85} 50%{transform:translateX(0) translateY(-8px);opacity:0.95} 75%{transform:translateX(-8px) translateY(-4px);opacity:0.88} }
    .title-content { position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; gap:20px; width:100%; max-width:380px; }
    /* Dictionary title */
    .dict-title-wrap { width:100%; }
    /* KNOWTIENT title — KNOW slides from left, TIENT slides from right */
    .dict-title-wrap { display:flex; align-items:baseline; gap:0; justify-content:center; width:100%; }
    .dict-chunk { display:inline-block; font-family:'Righteous',cursive; font-size:58px; color:#C6FF00; text-shadow:2px 3px 0 #1a7a50,0 0 22px rgba(198,255,0,0.75); opacity:0; }
    .dict-chunk.know { transform:translateX(-120px) scale(0.85); }
    .dict-chunk.rate { transform:translateX(120px) scale(0.85); }
    /* Logo: KNOW sits lower than TIENT, small gap between halves */
    .dict-chunk.know.landed, .dict-chunk.know.dance { position:relative; top:3px; margin-right:2px; }
    .dict-chunk.rate.landed, .dict-chunk.rate.dance { position:relative; top:0px; }
    .dict-chunk.fly-in { animation:chunkFlyIn 0.55s cubic-bezier(0.22,1.4,0.36,1) forwards; }
    @keyframes chunkFlyIn { 0%{opacity:0} 100%{opacity:1;transform:translateX(0) scale(1)} }
    /* landed: explicit resting state so browser never reverts to opacity:0 */
    .dict-chunk.landed { opacity:1; transform:translateX(0) scale(1); }
    .dict-chunk.dance { animation:chunkDance 2.6s ease-in-out infinite; }
    .dict-chunk.know.dance { animation-delay:0s; }
    .dict-chunk.rate.dance { animation-delay:0.2s; }
    @keyframes chunkDance { 0%,100%{transform:translateY(0) rotate(0deg) scale(1)} 20%{transform:translateY(-5px) rotate(-1.5deg) scale(1.03)} 50%{transform:translateY(3px) rotate(1deg) scale(0.97)} 75%{transform:translateY(-2px) rotate(-0.5deg) scale(1.01)} }
    /* Phonetic / definition lines — serif academic feel */
    .dict-phonetic { font-family:'Georgia',serif; font-size:23px; color:var(--color-secondary); opacity:0; letter-spacing:0.04em; line-height:1.5; transition:opacity 0.5s; margin-top:4px; }
    .dict-phonetic.show { opacity:1; }
    .dict-pos { font-family:'Georgia',serif; font-style:italic; color:var(--color-secondary); }
    .dict-definition { font-family:'Georgia',serif; font-size:26px; font-style:italic; color:var(--color-text); opacity:0; line-height:1.6; transition:opacity 0.6s; max-width:360px; }
    .dict-definition.show { opacity:1; }

    /* (title screen letter animations defined above in dict-kr-* classes) */
    .title-begin-btn { display:flex; align-items:center; justify-content:center; width:240px; min-height:56px; padding:0 32px; background:var(--color-amber); color:var(--color-base); font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:700; letter-spacing:0.06em; border:none; border-radius:14px; cursor:pointer; transition:transform 80ms ease; opacity:0; -webkit-tap-highlight-color:transparent; position:relative; z-index:1; }
    .title-begin-btn.visible { animation:fadeUp 0.25s ease-out forwards; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    .title-begin-btn:active { transform:scale(0.95); }

    /* NUMBER ANIMATIONS */
    @keyframes numberArrive { 0%{transform:scale(0.3);opacity:0} 55%{transform:scale(1.18);opacity:1} 70%{transform:scale(0.93)} 82%{transform:scale(1.08)} 92%{transform:scale(0.97)} 100%{transform:scale(1)} }
    @keyframes numberShake  { 0%{transform:rotate(0deg) scale(1)} 12%{transform:rotate(-5deg) scale(1.05)} 25%{transform:rotate(5deg) scale(1.07)} 38%{transform:rotate(-4deg) scale(1.04)} 52%{transform:rotate(4deg) scale(1.05)} 66%{transform:rotate(-2deg) scale(1.02)} 80%{transform:rotate(2deg) scale(1.01)} 100%{transform:rotate(0deg) scale(1)} }
    @keyframes numberCelebrate { 0%{transform:scale(0.3) rotate(0deg);opacity:0} 45%{transform:scale(1.25) rotate(-3deg);opacity:1} 60%{transform:scale(0.9) rotate(2deg)} 72%{transform:scale(1.12) rotate(-2deg)} 84%{transform:scale(0.96) rotate(1deg)} 92%{transform:scale(1.04) rotate(0deg)} 100%{transform:scale(1) rotate(0deg)} }
    .number-arrive    { animation:numberArrive    1.1s cubic-bezier(0.34,1.3,0.64,1) forwards; }
    .number-shake     { animation:numberShake     0.7s ease-in-out forwards; }
    .number-celebrate { animation:numberCelebrate 1.2s cubic-bezier(0.34,1.4,0.64,1) forwards; }
    @keyframes deltaBounce { 0%{transform:scale(0.5);opacity:0} 55%{transform:scale(1.12)} 75%{transform:scale(0.94)} 90%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
    .delta-bounce { animation:deltaBounce 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards; }
  `}</style>
);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// IDs of questions to limit to 1 per round
const BIBLE_IDS    = new Set(['pew_religion_2019_001','pew_religion_2019_002','pew_religion_2019_012','pew_religion_2019_025']);
const REGIONAL_RELIGION_IDS = new Set(['pew_intl_2022_003']);

const OMIT_IDS     = new Set(['pew_sci_2019_002']); // ear infection — omitted permanently
const JUDAISM_IDS  = new Set(['pew_religion_2019_007','pew_religion_2019_017','pew_religion_2019_020','pew_religion_2019_023','pew_religion_2019_030']);

function buildRound(allQuestions) {
  const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
  const unflagged = allQuestions.filter(q => !q.flagged && !q.image_dependent && !OMIT_IDS.has(q.id));

  const getAvailable = () => unflagged.filter(q => !seenIds.has(q.id));
  let available = getAvailable();

  // Reset seen if any required category is too depleted to fill a round
  const catCount = cat => available.filter(q => q.category === cat).length;
  if (catCount('religion') < 2 || catCount('science') < 1 ||
      catCount('technology') < 1 || catCount('world') < 1 || catCount('civics') < 1) {
    seenIds.clear();
    available = getAvailable();
  }

  const byCat = cat => shuffle(available.filter(q => q.category === cat));
  const religion   = byCat('religion');
  const science    = byCat('science');
  const technology = byCat('technology');
  const world      = byCat('world');
  const civics     = byCat('civics');

  const rel1   = religion[0]    || null;
  const rel2   = religion[1]    || null;
  const sci1   = science[0]     || null;
  const tech1  = technology[0]  || null;
  const world1 = world[0]       || null;
  const civ1   = civics[0]      || null;

  // Wildcard: prefer science/technology/world over religion; never civics
  const usedIds = new Set([rel1,rel2,sci1,tech1,world1,civ1].filter(Boolean).map(q => q.id));
  const wildPref = shuffle(available.filter(q =>
    !usedIds.has(q.id) && ['science','technology','world'].includes(q.category)
  ));
  const wildFall = shuffle(available.filter(q =>
    !usedIds.has(q.id) && q.category === 'religion'
  ));
  const wild1 = (wildPref[0] || wildFall[0]) || null;

  const round = [rel1,rel2,sci1,tech1,world1,civ1,wild1].filter(Boolean).slice(0,7);

  // Pad if short (edge case)
  if (round.length < 7) {
    const roundIds = new Set(round.map(q => q.id));
    shuffle(available.filter(q => !roundIds.has(q.id)))
      .slice(0, 7 - round.length).forEach(q => round.push(q));
  }

  // Enforce: max 1 Bible question, max 1 regional-religion question per round
  const ensureMax1 = (ids, arr) => {
    const matches = arr.filter(q => ids.has(q.id));
    if (matches.length <= 1) return arr;
    let kept = false;
    return arr.map(q => {
      if (!ids.has(q.id)) return q;
      if (!kept) { kept = true; return q; }
      const roundIds = new Set(arr.map(r => r.id));
      const replacement = shuffle(available.filter(r =>
        !roundIds.has(r.id) && !ids.has(r.id) && r.category !== 'civics'
      ))[0];
      return replacement || q;
    });
  };

  let filtered = shuffle(round);
  filtered = ensureMax1(BIBLE_IDS, filtered);
  filtered = ensureMax1(REGIONAL_RELIGION_IDS, filtered);

  // Enforce max 1 Judaism question per round
  const ensureMax1Judaism = (arr) => {
    const judMatches = arr.filter(q => JUDAISM_IDS.has(q.id));
    if (judMatches.length <= 1) return arr;
    let kept = false;
    return arr.map(q => {
      if (!JUDAISM_IDS.has(q.id)) return q;
      if (!kept) { kept = true; return q; }
      const roundIds = new Set(arr.map(r => r.id));
      const replacement = shuffle(available.filter(r =>
        !roundIds.has(r.id) && !JUDAISM_IDS.has(r.id) && r.category === 'religion'
      ))[0];
      return replacement || q;
    });
  };
  filtered = ensureMax1Judaism(filtered);

  // Separate by category for final ordering
  const religionQs  = filtered.filter(q => q.category === 'religion');
  const worldQs     = filtered.filter(q => q.category === 'world');
  const otherQs     = filtered.filter(q => q.category !== 'religion' && q.category !== 'world');

  // Build ordered result — world first, religion at slots 3 and 6, others fill remaining slots.
  // Use a consumed-set to guarantee no duplicates regardless of fallbacks.
  const consumed = new Set();
  const take = (arr) => {
    const q = arr.find(x => x && !consumed.has(x.id));
    if (q) consumed.add(q.id);
    return q || null;
  };
  const result = [
    take(worldQs)   || take(otherQs),   // slot 0: world preferred
    take(otherQs),                        // slot 1
    take(otherQs),                        // slot 2
    take(religionQs),                     // slot 3: religion
    take(otherQs),                        // slot 4
    take(otherQs),                        // slot 5
    take(religionQs),                     // slot 6: religion
  ].filter(Boolean);

  const deduped = result; // take() guarantees no duplicates already

  deduped.forEach(q => seenIds.add(q.id));
  return deduped;
}
function avgDeviation(guesses) {
  if (!guesses.length) return null;
  return guesses.reduce((sum,g) => sum + Math.abs(g.guess - g.real), 0) / guesses.length;
}
function deltaColorClass(delta) {
  if (delta <= 10) return "green";
  if (delta <= 19) return "amber";
  return "red";
}
function voiceLabel(delta) {
  if (delta === 0)  return "Dead on.";
  if (delta <= 10)  return "Wow! Close!";
  if (delta <= 19)  return "Not bad.";
  if (delta <= 35)  return "Way off.";
  return "Not even close.";
}
const LETTERS  = ["A","B","C","D","E"];
// KR_WORD removed — using chunks directly


// ─── COUNT-UP HOOK ────────────────────────────────────────────────────────────
function useCountUp(target, duration = 1400, run = false) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (!run) { setValue(0); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      // Round to 1 decimal to match toFixed(1) display
      setValue(Math.round((1 - Math.pow(1 - t, 3)) * target * 10) / 10);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, run]);
  return value;
}

// ─── BIG NUMBER ───────────────────────────────────────────────────────────────
function BigNumber({ value, size = "full", colorMode = "normal", animClass = "" }) {
  const fontSize    = size === "full" ? 118 : size === "end" ? 110 : 90;
  const svgH        = size === "full" ? 130 : size === "end" ? 125 : 105;
  const cy          = size === "full" ? 108 : size === "end" ? 103 : 87;
  const fillColor   = colorMode==="fail"?"#FF2D2D":colorMode==="close"?"#C6FF00":"#F5A623";
  const shadowColor = colorMode==="fail"?"#FF8C00":colorMode==="close"?"#3DB87A":"#E8634A";
  const glowColor   = colorMode==="fail"?"rgba(255,45,45,0.45)":colorMode==="close"?"rgba(198,255,0,0.4)":"rgba(245,166,35,0.3)";
  return (
    <svg viewBox={`0 0 320 ${svgH}`} width="100%" style={{overflow:"visible",display:"block",filter:`drop-shadow(0 0 18px ${glowColor})`}} className={animClass} aria-label={`${value} percent`}>
      <text x="163" y={cy+1} textAnchor="middle" fontFamily="'Righteous',cursive" fontSize={fontSize} fill={shadowColor} opacity="0.55">{value}%</text>
      <text x="160" y={cy-3} textAnchor="middle" fontFamily="'Righteous',cursive" fontSize={fontSize} fill={fillColor} stroke="#2D2A5E" strokeWidth="1">{value}%</text>
    </svg>
  );
}
function WaveSvg({ color }) {
  return (
    <svg viewBox="0 0 800 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <path d="M0,60 C100,10 200,110 400,60 C600,10 700,110 800,60 L800,120 L0,120 Z" fill={color} />
      <path d="M0,60 C100,10 200,110 400,60 C600,10 700,110 800,60 L800,120 L0,120 Z" fill={color} transform="translate(800,0)" />
    </svg>
  );
}
function ProgressBar({ current, total, show }) {
  if (!show) return null;
  return (
    <div>
      <div className="progress-bar-track"><div className="progress-bar-fill" style={{width:`${(current/total)*100}%`}} /></div>
      <div className="progress-meta-row">
        <span className="progress-q-label">Q{current+1} / {total}</span>
      </div>
    </div>
  );
}

// ─── TITLE SCREEN ─────────────────────────────────────────────────────────────
// KNOW slides in from left, RATE slides in from right — compound word
function TitleScreen({ onBegin }) {
  const [knowPhase, setKnowPhase] = useState(0); // 0=hidden 1=flying 2=landed 3=dancing
  const [ratePhase, setRatePhase] = useState(0);
  const [showPhon,  setShowPhon]  = useState(false);
  const [showDef,   setShowDef]   = useState(false);
  const [showBtn,   setShowBtn]   = useState(false);
  const [skipped,   setSkipped]   = useState(false);
  const timersRef = useRef([]);

  const skipAll = useCallback(() => {
    if (skipped) return;
    setSkipped(true);
    timersRef.current.forEach(clearTimeout);
    setKnowPhase(3); setRatePhase(3);
    setShowPhon(true); setShowDef(true); setShowBtn(true);
  }, [skipped]);

  useEffect(() => {
    const ts = [];
    // KNOW: fly in immediately
    // KNOW flies in at 80ms; animation takes 550ms → lands at 630ms
    ts.push(setTimeout(() => setKnowPhase(1), 80));
    ts.push(setTimeout(() => setKnowPhase(2), 640));  // landed
    ts.push(setTimeout(() => setKnowPhase(3), 700));  // dance
    // 200ms pause after KNOW lands → TIENT starts at 630+200 = 830ms
    ts.push(setTimeout(() => setRatePhase(1), 830));
    ts.push(setTimeout(() => setRatePhase(2), 1390)); // landed
    ts.push(setTimeout(() => setRatePhase(3), 1450)); // dance
    // Subtitle sequence
    ts.push(setTimeout(() => setShowPhon(true), 1600));
    ts.push(setTimeout(() => setShowDef(true),  2000));
    ts.push(setTimeout(() => setShowBtn(true),  2550));
    timersRef.current = ts;
    return () => ts.forEach(clearTimeout);
  }, []);

  const chunkClass = (phase, side) => {
    let c = `dict-chunk ${side}`;
    if (phase === 1) c += " fly-in";
    if (phase === 2) c += " landed";  // explicit resting state
    if (phase >= 3) c += " landed dance";
    return c;
  };

  return (
    <div className="title-screen" onClick={skipAll}>
      <div className="title-bg-stripes" />
      <div className="title-content">
        {/* KNOW from left + RATE from right */}
        <div className="dict-title-wrap">
          <span className={chunkClass(knowPhase, "know")}>KNOW</span>
          <span className={chunkClass(ratePhase, "rate")}>TIENT</span>
        </div>

        {/* Phonetic line — Georgia serif, fades in */}
        <div className={`dict-phonetic${showPhon ? " show" : ""}`}>
          know·tient&nbsp;&nbsp;|&nbsp;&nbsp;ˈnō·SHənt&nbsp;&nbsp;|&nbsp;&nbsp;<span className="dict-pos">noun</span>
        </div>

        {/* Definition — Georgia italic, no quotes */}
        <div className={`dict-definition${showDef ? " show" : ""}`}>
          The percentage of a given population that can correctly answer a specific question.
        </div>

        <button
          className={`title-begin-btn${showBtn ? " visible" : ""}`}
          onClick={e => { e.stopPropagation(); onBegin(); }}
          disabled={!showBtn}
        >BEGIN →</button>
      </div>
    </div>
  );
}

// ─── ABOUT LIGHTBOX ───────────────────────────────────────────────────────────
function AboutLightbox({ onClose }) {
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-box" onClick={e => e.stopPropagation()}>
        <button className="about-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="about-title">About the Data</div>
        <div className="about-body">
          All questions (and corresponding percentages of correct responses) are drawn from nationally representative surveys of U.S. adults, conducted by Pew Research Center using probability-based sampling. Sample sizes range from 3,278 to 10,971. All surveys were weighted to U.S. Census benchmarks.
        </div>
      </div>
    </div>
  );
}

// ─── SPLASH ───────────────────────────────────────────────────────────────────
function SplashScreen({ onStart }) {
  const [showAbout, setShowAbout] = useState(false);
  return (
    <>
      <div className="screen screen-enter-from-left">
        <div className="splash">
          <div className="splash-top">
            <div className="splash-rules">
              <div className="splash-rule"><div className="splash-rule-icon">📊</div><span className="splash-rule-text">Each round contains <strong>seven real questions</strong> that Pew Research already asked thousands of Americans.</span></div>
              <div className="splash-rule-divider" />
              <div className="splash-rule"><div className="splash-rule-icon">🎯</div><span className="splash-rule-text"><strong>Your challenge:</strong> guess what % of Americans answered each question correctly.</span></div>

            </div>
          </div>
          <div className="splash-bottom">
            <button className="btn-primary" onClick={onStart}>START ROUND</button>
            <button className="btn-about" onClick={() => setShowAbout(true)}>ABOUT THE DATA</button>
          </div>
        </div>
      </div>
      {showAbout && <AboutLightbox onClose={() => setShowAbout(false)} />}
    </>
  );
}

// ─── QUESTION SCREEN ──────────────────────────────────────────────────────────
function QuestionScreen({ question, onSubmit, animClass }) {
  const [value, setValue]           = useState(50);
  const [moved, setMoved]           = useState(false); // tracks whether user has touched slider
  const [visibleChoices, setVisibleChoices] = useState(0);
  const lastTickRef = useRef(50);
  const shuffledChoices = useRef([]);

  useEffect(() => {
    setValue(50); setMoved(false); setVisibleChoices(0); lastTickRef.current = 50;
    const choices = [...(question.answer_choices || [question.correct_answer])];
    // Shuffle so correct answer (index 0) lands at a random position
const shuffled = [...choices];
const correctAnswer = shuffled[0];
shuffled.splice(0, 1); // remove from front
const insertAt = Math.floor(Math.random() * (shuffled.length + 1));
shuffled.splice(insertAt, 0, correctAnswer);
// Move 'All of the above' / 'None of the above' variants to end
const moveToEnd = (arr) => {
  const pattern = /all of the above|none of the above/i;
  const bottom = arr.filter(c => pattern.test(c));
  const rest   = arr.filter(c => !pattern.test(c));
  return [...rest, ...bottom];
};
shuffledChoices.current = moveToEnd(shuffled);
    const n = choices.length;
    const timers = choices.map((_,i) => setTimeout(() => setVisibleChoices(v => Math.max(v,i+1)), i*(500/n)));
    return () => timers.forEach(clearTimeout);
  }, [question.id]);

  const handleChange = (e) => {
    const v = parseInt(e.target.value, 10);
    setValue(v);
    if (!moved) setMoved(true);
    if (Math.abs(v - lastTickRef.current) >= 1) { playTick(v); lastTickRef.current = v; }
  };
  const handleRelease = () => {};  // submit sound only fires on button click

  const bgR = Math.round(45 + (value/100)*60);
  const bgG = Math.round(42 + (value/100)*20);
  const bgB = Math.round(94 + (value/100)*80);
  const screenBg = moved
    ? `linear-gradient(160deg,rgb(${bgR},${bgG},${bgB}) 0%,rgb(${Math.round(bgR*0.7)},${Math.round(bgG*0.7)},${Math.round(bgB*0.85)}) 100%)`
    : undefined;

  return (
    <div className={`screen ${animClass}`} style={screenBg?{background:screenBg,transition:"background 0.15s ease"}:{}}>
      <div className="question-screen">
        <div className="q-meta-row">
          <span className="q-category-pill">{question.category}</span>
          <div className="q-source-dot" />
          <span className="q-source-label">{question.survey_year}</span>
        </div>
        <div className="q-text">{question.question}</div>
        <div className="answer-choices-wrap">
          <div className="answer-choices">
            {shuffledChoices.current.map((choice, i) => (
              <div key={i} className={`answer-choice ${i < visibleChoices ? "animate-in" : ""}`}>
                <span className="answer-choice-letter">{LETTERS[i]}</span>
                <span className="answer-choice-text">{choice}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="slider-section">
          <div className="slider-prompt-label">What % got this right?</div>
          <div className={`slider-live-number ${moved?"active":"inactive"}`}>
            {value}<span className="slider-live-pct">%</span>
          </div>
          <div className={`slider-drag-hint ${moved?"hidden":""}`}>drag to set your guess</div>
          <div className="slider-wrap">
            <div className="slider-track-bg" />
            <div className="slider-track-fill" style={{width:`${value}%`}} />
            <input type="range" className="slider-input" min={0} max={100} step={1} value={value}
              onChange={handleChange} onMouseUp={handleRelease} onTouchEnd={handleRelease} />
          </div>
          <button className="btn-primary" onClick={() => { playSelect(value); onSubmit(value); }}>
            SUBMIT →
          </button>
        </div>
        <div className="q-source-footer" style={{display:"none"}}>{question.source_label}</div>
      </div>
    </div>
  );
}

// ─── REVEAL SCREEN ────────────────────────────────────────────────────────────
function RevealScreen({ question, guess, onNext, isLast, animClass }) {
  const [runCount,  setRunCount]  = useState(false);
  const [showDelta, setShowDelta] = useState(false);
  const [flashType, setFlashType] = useState(null);
  const [numClass,  setNumClass]  = useState("number-arrive");
  const [barWave,   setBarWave]   = useState(false);

  const realPct = question.pct_correct;
  const safeGuess = guess ?? 50;  // null guard — defaults to 50 if somehow null
  const delta   = Math.abs(safeGuess - realPct);
  const isClose = delta <= 10;
  const isFail  = delta >= 20;
  const colorMode = isClose ? "close" : isFail ? "fail" : "normal";
  const cls       = deltaColorClass(delta);
  const countedValue = useCountUp(Math.round(realPct), 1400, runCount);

  useEffect(() => {
    const t1 = setTimeout(() => setRunCount(true), 120);
    const t2 = setTimeout(() => setBarWave(true), 1500);
    const t3 = setTimeout(() => setShowDelta(true), 1650);
    const t4 = setTimeout(() => {
      if (isClose) { playFanfare(); setNumClass("number-celebrate"); }
      else if (isFail) { playFailure(); setNumClass("number-shake"); }
    }, 1600);
    const t5 = setTimeout(() => {
      if (isClose) setFlashType("green");
      else if (isFail) setFlashType("red");
    }, 1700);
    // NO auto-advance
    return () => [t1,t2,t3,t4,t5].forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markerLeft = Math.min(Math.max(safeGuess, 2), 98);
  const barColor   = isClose ? "#C6FF00" : isFail ? "#FF2D2D" : "#F5A623";
  const screenBg   = isClose
    ? "linear-gradient(180deg,#0d3320 0%,#1a4a2e 100%)"
    : isFail
    ? "linear-gradient(180deg,#3a0a0a 0%,#2a1010 100%)"
    : undefined;

  return (
    <>
      {flashType && <div className={`flash-overlay active${flashType==="green"?" flash-green":""}`} />}
      <div className={`screen ${animClass}`} style={screenBg?{background:screenBg}:{}}>
        <div className="reveal-screen">
          <div className="reveal-question-recap">
            <div className="reveal-recap-q">{question.question}</div>
            <div className={isFail?"card-big-miss reveal-answer-card":"card reveal-answer-card"}>
              <div className="reveal-answer-card-label">Correct answer</div>
              <div className="reveal-answer-card-text">{question.correct_answer}</div>
            </div>
          </div>
          <div className="reveal-top-label">REAL % WHO KNEW</div>
          <div className="reveal-big-number-wrap">
            <BigNumber value={Math.round(countedValue)} size="full" colorMode={colorMode} animClass={numClass} />
          </div>
          <div className="reveal-bar-section">
            <div className="reveal-bar-track">
              <div className={`reveal-bar-fill${barWave?" wave-go":""}`} style={{width:runCount?`${realPct}%`:"0%",background:barColor}} />
              <div className="reveal-guess-marker" style={{left:`calc(${markerLeft}% - 2.5px)`}}>
                <div className="reveal-guess-marker-label" style={{left:"50%"}}>you: {safeGuess}%</div>
              </div>
            </div>
            <div className="reveal-bar-reality-label">reality: {realPct}%</div>
          </div>
          {/* Always in DOM — opacity transition so layout never shifts */}
          <div className="reveal-delta-row" style={{display:"none"}}>
            <div className={`reveal-delta-number ${cls}`}></div>
          </div>
          <div
            className={`reveal-voice-label ${cls}`}
            style={{
              opacity: showDelta ? 1 : 0,
              transition: "opacity 0.3s ease",
              minHeight: "38px",
            }}
          >{voiceLabel(delta)}</div>
          <div className="reveal-bottom">
            <button className="btn-primary large" onClick={onNext}>
              {isLast ? "SEE RESULTS →" : "NEXT →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── FULL DEBRIEF MODAL ───────────────────────────────────────────────────────
function DebriefModal({ round, guesses, onClose }) {
  return (
    <div className="debrief-overlay" onClick={onClose}>
      <div className="debrief-sheet" onClick={e => e.stopPropagation()}>
        <div className="debrief-sheet-handle" />
        <div className="debrief-sheet-title">Full Debrief — All {round.length} Questions</div>
        {round.map((q, i) => {
          const g = guesses[i]; if (!g) return null;
          const delta = Math.abs(g.guess - q.pct_correct);
          const cls   = deltaColorClass(delta);
          return (
            <div className="debrief-row" key={q.id}>
              <div className="debrief-row-idx">Question {i+1}</div>
              <div className="debrief-row-question">{q.question}</div>
              <div className="debrief-row-answer">Correct answer: <span>{q.correct_answer}</span></div>
              <div className="debrief-row-nums">
                <div className="debrief-num-block">
                  <div className="debrief-big-num real">{q.pct_correct}%</div>
                  <div className="debrief-num-label">Real %</div>
                </div>
                <div className="debrief-sep">vs</div>
                <div className="debrief-num-block">
                  <div className="debrief-big-num you">{g.guess}%</div>
                  <div className="debrief-num-label">Your guess</div>
                </div>
                <div className="debrief-sep">·</div>
                <div className="debrief-num-block">
                  <div className={`debrief-big-num delta ${cls}`}>±{delta}</div>
                  <div className="debrief-num-label">Off by</div>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{marginTop:16}}>
          <button className="btn-secondary" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}

// ─── PERCENTILE REVEAL ───────────────────────────────────────────────────────
function PercentileReveal({ percentile }) {
  const run = percentile !== null && percentile >= 0;
  const counted = useCountUp(run ? percentile : 0, 900, run);
  const displayed = Math.round(counted);

  if (percentile === null) return (
    <div className="percentile-wrap"><span className="percentile-calculating">calculating rank…</span></div>
  );
  if (percentile === -1) return (
    <div className="percentile-wrap"><span className="percentile-calculating">you're one of the first players</span></div>
  );
  if (percentile === -2) return (
    <div className="percentile-wrap"><span className="percentile-calculating">rank unavailable</span></div>
  );
  const fillColor   = percentile >= 50 ? "#C6FF00" : percentile >= 25 ? "#F5A623" : "#E8634A";
  const shadowColor = percentile >= 50 ? "#3DB87A"  : percentile >= 25 ? "#E8634A" : "#FF2D2D";
  const glowColor   = percentile >= 50 ? "rgba(198,255,0,0.4)" : percentile >= 25 ? "rgba(245,166,35,0.35)" : "rgba(255,45,45,0.35)";
  return (
    <div className="percentile-wrap">
      <div className="percentile-label-top">YOU GUESSED CLOSER THAN</div>
      <svg className="percentile-number-svg percentile-bounce" viewBox="0 0 220 90"
        style={{filter:`drop-shadow(0 0 16px ${glowColor})`}}
        aria-label={`${percentile} percent of players`}>
        <text x="112" y="76" textAnchor="middle" fontFamily="'Righteous',cursive" fontSize="82" fill={shadowColor} opacity="0.55">{displayed}%</text>
        <text x="110" y="73" textAnchor="middle" fontFamily="'Righteous',cursive" fontSize="82" fill={fillColor} stroke="#2D2A5E" strokeWidth="1">{displayed}%</text>
      </svg>
      <div className="percentile-label-bot">of other Knowtient players.</div>
    </div>
  );
}

// ─── END SCREEN ───────────────────────────────────────────────────────────────
function EndScreen({ round, guesses, onPlayAgain, onShare, avg: avgProp, percentile }) {
  const avg = (avgProp !== null && avgProp !== undefined) ? avgProp : (avgDeviation(guesses) ?? 0);
  const [run, setRun]               = useState(false);
  const [showDebrief, setShowDebrief] = useState(false);
  const displayed = useCountUp(parseFloat(avg.toFixed(1)), 1200, run);

  useEffect(() => {
    playEndChime();
    const t = setTimeout(() => setRun(true), 300);
    return () => clearTimeout(t);
  }, []);

  const withDeltas = round.map((q, i) => ({
    q, g: guesses[i],
    delta: guesses[i] ? Math.abs(guesses[i].guess - q.pct_correct) : 999,
  }));
  const best  = [...withDeltas].sort((a,b) => a.delta - b.delta)[0];
  const worst = [...withDeltas].sort((a,b) => b.delta - a.delta)[0];

  const HighlightCard = ({ data, type }) => {
    if (!data || !data.g) return null;
    const cls = deltaColorClass(data.delta);
    return (
      <div className={`highlight-card ${type}`}>
        <div className={`highlight-tag ${type}`}>{type==="best"?"★ YOUR CLOSEST GUESS":"✗ YOUR WORST GUESS"}</div>
        <div className="highlight-question">{data.q.question}</div>
        <div className="highlight-answer">Correct answer: <span>{data.q.correct_answer}</span></div>
        <div className="highlight-nums" style={{justifyContent:"center",gap:32}}>
          <div className="highlight-num-block" style={{alignItems:"center",textAlign:"center"}}>
            <div className="highlight-big-num real">{data.q.pct_correct}%</div>
            <div className="highlight-num-label">Real %</div>
          </div>
          <div className="highlight-sep">vs</div>
          <div className="highlight-num-block" style={{alignItems:"center",textAlign:"center"}}>
            <div className="highlight-big-num you">{data.g.guess}%</div>
            <div className="highlight-num-label">Your guess</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="screen screen-enter">
        <div className="end-screen">
          <div className="end-content">
            <div className="end-headline"><span className="kt-know">KNOW</span><span className="kt-tient">TIENT:</span></div>
            <div className="end-avg-intro">Your average guess was off by:</div>
            <div className="end-avg-number-wrap">
              <BigNumber
                value={typeof displayed==="number" ? displayed.toFixed(1) : displayed}
                size="end" colorMode="normal" animClass="number-arrive"
              />
            </div>
            <PercentileReveal percentile={percentile} />
            <div className="end-highlights">
              <HighlightCard data={best} type="best" />
            </div>
            <div className="end-ctas">
              <button className="btn-primary"   onClick={onPlayAgain}>PLAY MORE QUESTIONS</button>
              {isMobile() ? (
                <button className="btn-secondary" onClick={async () => {
                  const avgVal = avg || 0;
                  const pctLine = (percentile !== null && percentile >= 0) ? `I guessed better than ${percentile}% of other Knowtient players. ` : "";
                  const txt = `Thousands of Americans answered seven real questions. Guess what % answered correctly. ${pctLine}www.Knowtient.com`;
                  try {
                    const dataUrl = drawShareCanvas(avgVal, guesses, round, percentile);
                    const file = dataUrlToFile(dataUrl, "Knowtient Game Score.png");
                    if (navigator.share && navigator.canShare({ files: [file] })) {
                      await navigator.share({ files: [file], text: txt });
                    } else if (navigator.share) {
                      await navigator.share({ text: txt });
                    }
                  } catch(e) { if (e.name !== "AbortError") console.warn(e); }
                }}>SHARE</button>
              ) : (
                <button className="btn-secondary" onClick={onShare}>SAVE RESULTS</button>
              )}
              <button className="btn-secondary" onClick={() => setShowDebrief(true)}>VIEW FULL DEBRIEF</button>
            </div>
          </div>
        </div>
      </div>
      {showDebrief && <DebriefModal round={round} guesses={guesses} onClose={() => setShowDebrief(false)} />}
    </>
  );
}

// ─── SHARE CARD (desktop: preview + SAVE RESULTS) ───────────────────────────
function ShareCard({ guesses, round, onClose, percentile }) {
  const avg = avgDeviation(guesses);
  const [status,  setStatus]  = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    setPreview(drawShareCanvas(avg, guesses, round, percentile));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    downloadDataUrl(drawShareCanvas(avg, guesses, round, percentile), "Knowtient Game Score.png");
    setStatus("Saved!");
  };

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-card" onClick={e => e.stopPropagation()}>
        <div style={{width:"100%",borderRadius:12,overflow:"hidden",marginBottom:16,background:"#1a1840",border:"2px solid var(--color-border)",minHeight:160,maxHeight:340,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {preview
            ? <img src={preview} alt="Share preview" style={{width:"100%",height:"100%",objectFit:"contain",display:"block",maxHeight:336}} />
            : <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:"var(--color-secondary)",padding:24,textAlign:"center"}}>Generating…</span>
          }
        </div>
        {status && <div className="share-status" style={{marginBottom:8}}>{status}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <button className="btn-primary" onClick={handleSave}>SAVE RESULTS</button>
          <button className="btn-secondary" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}


// ─── ROOT APP ─────────────────────────────────────────────────────────────────
const TOTAL = 7;

export default function App() {
  useEffect(() => {
    document.title = "Knowtient — Guess What % of Americans Knew";
    const sm = (prop, content, isName=false) => {
      const sel = isName ? `meta[name="${prop}"]` : `meta[property="${prop}"]`;
      let el = document.querySelector(sel);
      if (!el) { el = document.createElement("meta"); isName ? el.setAttribute("name",prop) : el.setAttribute("property",prop); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    const desc = "Guess what % of Americans knew the answers to seven common questions. Real Pew Research data. How close can you get?";
    const title = "Knowtient — Guess What % of Americans Knew";
    sm("description", desc, true);
    sm("og:title", title); sm("og:description", desc);
    sm("og:image", "https://knowtient.com/og-image.png");
    sm("og:url", "https://knowtient.com"); sm("og:type", "website");
    sm("og:site_name", "Knowtient");
    sm("twitter:card", "summary_large_image", true);
    sm("twitter:title", title, true); sm("twitter:description", desc, true);
    sm("twitter:image", "https://knowtient.com/og-image.png", true);
  }, []);
  const [screen,    setScreen]    = useState("title");
  const [round,     setRound]     = useState([]);
  const [qIndex,    setQIndex]    = useState(0);
  const qIndexRef = useRef(0);
  const [guesses,   setGuesses]   = useState([]);
  const [lastGuess, setLastGuess] = useState(null);
  const lastGuessRef    = useRef(null);
  const finalGuessesRef = useRef([]);
  const [showShare,   setShowShare]   = useState(false);
  const [qAnim,       setQAnim]       = useState("screen-enter");
  const [percentile,  setPercentile]  = useState(null);
  const questions = questionsData.questions;

  // Enter key fires primary action — debounced to prevent double-fire during transitions
  useEffect(() => {
    let lastFired = 0;
    const handleKey = (e) => {
      if (e.key !== "Enter") return;
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;
      const now = Date.now();
      if (now - lastFired < 350) return;  // debounce: ignore within 350ms of last fire
      lastFired = now;
      if (screen === "splash")   document.querySelector(".btn-primary")?.click();
      if (screen === "question") document.querySelector(".btn-primary:not(:disabled)")?.click();
      if (screen === "reveal")   document.querySelector(".btn-primary.large")?.click();
      if (screen === "end")      document.querySelector(".btn-primary")?.click();
      if (screen === "title")    document.querySelector(".title-begin-btn.visible")?.click();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [screen]);

  const startRound = useCallback(() => {
    // Resume audio context on each new round (mobile browsers suspend it)
    try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch {}
    const r = buildRound(questions);
    finalGuessesRef.current = [];
    qIndexRef.current = 0;
    setRound(r); setQIndex(0); setGuesses([]); setLastGuess(null);
    setShowShare(false); setScreen("question"); setQAnim("screen-enter");
  }, [questions]);

  const handlePlayAgain = useCallback(() => {
    setPercentile(null);
    // Reset audio context so it works fresh on next round (mobile suspension fix)
    try { if (audioCtx) { audioCtx.close(); } } catch {}
    audioCtx = null;
    // Skip title — go straight to first question of new round
    finalGuessesRef.current = [];
    lastGuessRef.current = null;
    qIndexRef.current = 0;
    const r = buildRound(questions);
    setRound(r); setQIndex(0); setGuesses([]); setLastGuess(null);
    setShowShare(false); setScreen("question"); setQAnim("screen-enter");
  }, [questions]);

  const handleSubmit = (guess) => {
    lastGuessRef.current = guess;  // sync, available immediately
    setLastGuess(guess); setQAnim("screen-exit");
    setTimeout(() => { setScreen("reveal"); setQAnim("screen-enter"); }, 160);
  };

  const handleNext = useCallback(() => {
    const qi = qIndexRef.current;             // always current — never stale
    const currentGuess = lastGuessRef.current;
    const newGuesses = [...guesses, {guess:currentGuess, real:round[qi].pct_correct}];
    if (qi + 1 >= TOTAL) {
      finalGuessesRef.current = newGuesses;
      setGuesses(newGuesses);
      const finalAvg = avgDeviation(newGuesses);
      setPercentile(null);
      setScreen("end");
      // Skip saving if all 7 guesses are 50 — test round
      const isTestRound = newGuesses.every(g => g.guess === 50);
      if (!isTestRound) {
        saveScore(finalAvg).then(() => new Promise(r => setTimeout(r, 800))).then(() => fetchPercentile(finalAvg)).then(p => setPercentile(p));
      } else {
        fetchPercentile(finalAvg).then(p => setPercentile(p));
      }
      return;
    }
    setGuesses(newGuesses);
    setQAnim("screen-exit");
    setTimeout(() => {
      qIndexRef.current = qi + 1;             // advance ref synchronously before render
      setQIndex(qi + 1);
      setScreen("question");
      setQAnim("screen-enter");
    }, 160);
  }, [guesses, round]);  // qIndexRef and lastGuessRef are refs — not deps

  const showProgress = screen === "question" || screen === "reveal";
  // Hide persistent title bar on title screen AND end screen
  const showTitleBar = screen !== "title" && screen !== "end";

  return (
    <>
      <GlobalStyles />
      <div className="app-shell">
        {showTitleBar && (
          <div className="app-title-bar">
            <span className="app-title-bar-text"><span className="kt-know">KNOW</span><span className="kt-tient">TIENT</span></span>
          </div>
        )}
        <ProgressBar current={qIndex} total={TOTAL} show={showProgress} />
        <div className="screen-wrap">
          {screen === "title"    && <TitleScreen onBegin={() => setScreen("splash")} />}
          {screen === "splash"   && <SplashScreen onStart={startRound} />}
          {screen === "question" && round[qIndex] && (
            <QuestionScreen key={round[qIndex].id} question={round[qIndex]} onSubmit={handleSubmit} animClass={qAnim} />
          )}
          {screen === "reveal" && round[qIndex] && (
            <RevealScreen key={`reveal-${round[qIndex].id}`} question={round[qIndex]} guess={lastGuess} onNext={handleNext} isLast={qIndex+1>=TOTAL} animClass={qAnim} />
          )}
          {screen === "end" && (
            <EndScreen round={round} guesses={finalGuessesRef.current.length===round.length?finalGuessesRef.current:guesses} onPlayAgain={handlePlayAgain} onShare={() => setShowShare(true)} avg={avgDeviation(finalGuessesRef.current.length===round.length?finalGuessesRef.current:guesses)} percentile={percentile} />
          )}
        </div>
        {showShare && !isMobile() && <ShareCard guesses={guesses} round={round} onClose={() => setShowShare(false)} percentile={percentile} />}
      </div>
    </>
  );
}
