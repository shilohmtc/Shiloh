'use strict';

// Enhance the existing scoped HTML read; never retain client results in browser storage.
function clientSearchScript() {
  return `(()=>{'use strict';
const form=document.querySelector('[data-client-search-form]'),results=document.querySelector('[data-client-search-results]');
if(!form||!results||!window.fetch||!window.AbortController)return;
const input=form.elements.q,filter=form.elements.status,button=form.querySelector('[type="submit"]'),status=document.querySelector('[data-client-search-status]');
let timer,controller,sequence=0,composing=false;
form.classList.add('live-search');button.hidden=true;
function invalidate(){clearTimeout(timer);sequence++;if(controller)controller.abort();}
function url(){const next=new URL(form.action,location.href);if(input.value.trim())next.searchParams.set('q',input.value.trim());next.searchParams.set('status',filter.value);return next;}
async function search(next,historyMode='replace'){
 invalidate();const current=sequence;controller=new AbortController();results.setAttribute('aria-busy','true');status.dataset.complete='false';status.textContent='Searching clients…';button.hidden=true;
 try{const response=await fetch(next.pathname+next.search,{credentials:'same-origin',cache:'no-store',headers:{Accept:'text/html'},signal:controller.signal});
 if(!response.ok||response.redirected)throw Error('Search is unavailable. Please try again, or refresh your sign-in.');
 const doc=new DOMParser().parseFromString(await response.text(),'text/html'),updated=doc.querySelector('[data-client-search-results]');
 if(!updated)throw Error('Search is unavailable. Please try again, or refresh your sign-in.');
 if(current!==sequence)return;
 results.replaceChildren(...updated.childNodes);
 const insightsLink=document.querySelector('.client-insights-link'),updatedInsights=doc.querySelector('.client-insights-link');
 if(insightsLink&&updatedInsights)insightsLink.setAttribute('href',updatedInsights.getAttribute('href'));
 status.dataset.complete='true';status.textContent=results.querySelector('.result-summary')?.textContent.trim()||'No clients found.';
 if(historyMode==='push')history.pushState(null,'',next.pathname+next.search);else if(historyMode==='replace')history.replaceState(null,'',next.pathname+next.search);
 }catch(error){if(current!==sequence||error.name==='AbortError')return;status.textContent=error.message;button.hidden=false;}
 finally{if(current===sequence)results.removeAttribute('aria-busy');}
}
function schedule(){invalidate();if(composing)return;status.dataset.complete='false';status.textContent='Searching clients…';timer=setTimeout(()=>search(url()),300);}
input.addEventListener('input',schedule);input.addEventListener('compositionstart',()=>{composing=true;invalidate();});input.addEventListener('compositionend',()=>{composing=false;schedule();});
filter.addEventListener('change',()=>search(url()));form.addEventListener('submit',event=>{event.preventDefault();search(url());});
results.addEventListener('click',event=>{const link=event.target.closest('.pager a');if(!link||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();search(new URL(link.href),'push');input.focus();});
window.addEventListener('popstate',()=>{const next=new URL(location.href);input.value=next.searchParams.get('q')||'';filter.value=next.searchParams.get('status')||'active';search(next,'none');});
})();`;
}
module.exports = { clientSearchScript };
