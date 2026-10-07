import type { Variant } from './model';
// Only checked-in code runs. No URL, HTML, script or event payload is accepted from users.
export const FIXTURE_URL =
  'https://campaign.example/workshop?utm_source=demo&utm_medium=email&utm_campaign=autumn-workshop';
export const COLLECT_URL = 'https://campaign.example/collect';
export function campaignFixture(variant: Variant, consent: boolean) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northstar / Autumn workshop</title>
<style>body{margin:0;background:#eef3f6;color:#172b43;font-family:Arial,sans-serif}main{max-width:560px;margin:70px auto;padding:40px;border-top:8px solid #25668d;background:white}small{letter-spacing:3px}h1{font-size:48px;line-height:1.1}label{display:block;margin:24px 0 8px}input,button{padding:14px;font:inherit}button{display:block;margin-top:18px;background:#172b43;color:white;border:0}p{line-height:1.6}</style></head>
<body><main><small>NORTHSTAR / FIELD NOTES 01</small><h1>Make room<br>for a new idea.</h1><p>A fictional workshop for curious makers. This page is a controlled test fixture.</p>
<p>Analytics consent: <strong>${consent ? 'enabled' : 'disabled'}</strong></p>
<form><label for="email">Demo email</label><input id="email" type="email" required><button type="submit">Reserve a demo seat</button></form><p role="status">Loading fixture…</p></main>
<script>
const broken = ${variant === 'BROKEN'};
const consent = ${consent};
const campaign = Object.fromEntries(new URL(location.href).searchParams);
if (broken) delete campaign.utm_campaign;
async function emit(name, extra = {}) {
  if (!consent && !broken) return;
  await fetch('/collect', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,schema_version:1,page:'/workshop',...campaign,consent,...extra})});
}
const status = document.querySelector('[role="status"]');
emit('page_view').then(()=>status.textContent='Fixture ready');
document.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();
  await emit('form_submit',{form_id:'workshop-signup'});
  const conversion={form_id:'workshop-signup',conversion_id:'demo-seat-001',value:broken?'0':0,currency:'USD'};
  await emit('conversion',conversion);
  if(broken) await emit('conversion',conversion);
  status.textContent='Demo seat reserved';
});
</script></body></html>`;
}
