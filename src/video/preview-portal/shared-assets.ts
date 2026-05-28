export const PORTAL_CSS = `
:root{color-scheme:dark;--bg:#0a0a0d;--panel:#14141a;--panel2:#1a1a22;--line:#232330;--ink:#e8e6e1;--ink2:#b6b6c0;--ink3:#7a7a86;--accent:#ffb454;--good:#5fc792;--danger:#d8556a}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:radial-gradient(ellipse 1200px 600px at 50% -50px,rgba(255,180,84,.06),transparent 60%),var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:56px 32px 96px;max-width:1480px;margin:0 auto}
a{color:var(--accent);text-decoration:none}
nav.toc{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:rgba(10,10,13,.78);border-bottom:1px solid var(--line);padding:11px 16px;margin:-56px -32px 30px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;justify-content:center}
nav.toc:empty{display:none}
nav.toc a{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);padding:6px 12px;border-radius:6px}
nav.toc a:hover{color:var(--ink);background:var(--panel)}
header.hero{margin-bottom:28px}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3)}
h1{font-size:50px;font-weight:800;letter-spacing:-.02em;line-height:1.05;margin:10px 0 12px}
.sub{color:var(--ink2);font-size:16px;max-width:820px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
.stat .v{font-size:26px;font-weight:700}.stat .l{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin-top:4px}
section{margin-bottom:60px;scroll-margin-top:68px}.section-head{padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:26px}
h2{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin-bottom:7px}.section-title{font-size:26px;font-weight:700}.section-sub{color:var(--ink2);font-size:14px;margin-top:7px;max-width:820px}
.hero-video,.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.hero-video{padding:22px;margin:26px 0}.hero-video video{width:100%;aspect-ratio:16/9;display:block;background:#000;border-radius:12px}
.final-meta{display:flex;gap:10px 22px;flex-wrap:wrap;align-items:center;margin-top:16px;padding:0 6px;color:var(--ink3);font-size:12px;font-family:ui-monospace,"SF Mono",monospace}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card video,.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#000}.card img{cursor:zoom-in}.card audio{width:100%;margin-top:8px}
.meta{padding:12px 15px}.num{color:var(--accent);font-family:ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.12em}.title{font-size:14px;font-weight:600;margin-top:4px}.who{color:var(--ink3);font-size:11px;margin-top:5px;overflow-wrap:anywhere}
.review-controls,.client-controls{padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.review-btn,.client-btn{background:#0c0c11;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer}
.review-btn.approve[aria-pressed=true],.client-btn.approve[aria-pressed=true]{background:rgba(95,199,146,.16);color:var(--good)}
.review-btn.regenerate[aria-pressed=true],.client-btn.decline[aria-pressed=true]{background:rgba(216,85,106,.16);color:var(--danger)}
.review-note,.client-note{flex:1;background:#0c0c11;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:7px;font-size:11px;min-width:180px}
.hud{position:sticky;bottom:16px;margin-top:30px;background:var(--panel2);border:1px solid var(--line);border-radius:13px;padding:12px 18px;display:flex;gap:16px;align-items:center;box-shadow:0 12px 32px rgba(0,0,0,.55);font-size:13px}
.hud button{background:var(--accent);border:1px solid var(--accent);color:#0a0a0d;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;margin-left:auto}
.dl-btn{display:inline-block;margin-top:10px;padding:6px 12px;border:1px solid rgba(255,180,84,.3);border-radius:6px;color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out}.lb-stage{max-width:92vw;max-height:92vh;text-align:center}.lb-stage img{max-width:92vw;max-height:84vh;display:block;margin:auto;border-radius:8px}.lb-cap{color:var(--ink2);font-size:13px;margin-top:12px}
footer{margin-top:72px;padding-top:26px;border-top:1px solid var(--line);color:var(--ink3);font-size:12px;text-align:center}
@media(max-width:1100px){.grid{grid-template-columns:repeat(2,1fr)}.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){body{padding:42px 18px 80px}.grid{grid-template-columns:1fr}h1{font-size:36px}}
`;

export const PORTAL_JS = `
(function(){
function buildToc(){const toc=document.getElementById('toc');if(!toc)return;document.querySelectorAll('section[data-toc]').forEach(sec=>{if(!sec.id)return;const a=document.createElement('a');a.href='#'+sec.id;a.textContent=sec.dataset.toc||sec.id;toc.appendChild(a);});}
function initLightbox(){document.querySelectorAll('img[data-lightbox-group]').forEach(img=>{img.addEventListener('click',()=>{const overlay=document.createElement('div');overlay.className='lb-overlay';overlay.innerHTML='<div class="lb-stage"><img src="'+img.src+'" alt=""><div class="lb-cap">'+(img.dataset.lbCaption||'')+'</div></div>';overlay.addEventListener('click',()=>overlay.remove());document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){overlay.remove();document.removeEventListener('keydown',esc);}});document.body.appendChild(overlay);});});}
function initDownloads(){document.querySelectorAll('[data-downloadable][src]').forEach(el=>{const src=el.getAttribute('src');if(!src)return;const cap=el.closest('.card,.hero-video')?.querySelector('.meta,.final-meta')||el.parentElement;const a=document.createElement('a');a.href=src;a.download='';a.className='dl-btn';a.textContent='Download';cap?.appendChild(a);});}
function init(){buildToc();initLightbox();initDownloads();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
`;

export const PORTAL_EDITOR_JS = `
(function(){
function setExclusive(btn,selector){const pressed=btn.getAttribute('aria-pressed')==='true';const card=btn.closest('[data-card-kind]');if(card)card.querySelectorAll(selector).forEach(b=>b.setAttribute('aria-pressed','false'));btn.setAttribute('aria-pressed',pressed?'false':'true');}
function refreshEditorHud(){const a=document.getElementById('rs-approved');const r=document.getElementById('rs-regen');if(a)a.textContent=document.querySelectorAll('.review-btn.approve[aria-pressed=true]').length+' approved';if(r)r.textContent=document.querySelectorAll('.review-btn.regenerate[aria-pressed=true]').length+' to regenerate';}
function initEditor(){document.querySelectorAll('.review-btn').forEach(btn=>btn.addEventListener('click',()=>{setExclusive(btn,'.review-btn');refreshEditorHud();}));const copy=document.getElementById('copy-decisions-btn');if(copy)copy.addEventListener('click',async()=>{const lines=[];document.querySelectorAll('[data-card-kind]').forEach(card=>{const action=card.querySelector('.review-btn[aria-pressed=true]');if(!action)return;const note=card.querySelector('.review-note');lines.push('- '+card.dataset.cardKind+'#'+card.dataset.cardId+': '+action.dataset.reviewAction+(note&&note.value?' — '+note.value:''));});const block='VIDEOCLAW_REVIEW_DECISIONS\\n'+(lines.join('\\n')||'(no decisions selected)')+'\\n';try{await navigator.clipboard.writeText(block);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy Review Decisions',1800);}catch{console.log(block);copy.textContent='See console';}});refreshEditorHud();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initEditor);else initEditor();
})();
`;

export const PORTAL_CLIENT_JS = `
(function(){
function setExclusive(btn,selector){const pressed=btn.getAttribute('aria-pressed')==='true';const card=btn.closest('[data-card-kind]');if(card)card.querySelectorAll(selector).forEach(b=>b.setAttribute('aria-pressed','false'));btn.setAttribute('aria-pressed',pressed?'false':'true');}
function initClient(){document.querySelectorAll('.client-btn').forEach(btn=>btn.addEventListener('click',()=>{setExclusive(btn,'.client-btn');}));const copy=document.getElementById('copy-client-feedback-btn');if(copy)copy.addEventListener('click',async()=>{const lines=[];document.querySelectorAll('[data-card-kind]').forEach(card=>{const action=card.querySelector('.client-btn[aria-pressed=true]');const note=card.querySelector('.client-note');if(action||note?.value)lines.push('- '+card.dataset.cardKind+'#'+card.dataset.cardId+': '+(action?.dataset.clientAction||'comment')+(note&&note.value?' — '+note.value:''));});const block='VIDEOCLAW_CLIENT_FEEDBACK\\n'+(lines.join('\\n')||'(no feedback entered)')+'\\n';try{await navigator.clipboard.writeText(block);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy Feedback',1800);}catch{console.log(block);copy.textContent='See console';}});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initClient);else initClient();
})();
`;
