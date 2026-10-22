(() => {
  'use strict';
  const root = document.querySelector('[data-website-editor]');
  if (!root) return;
  const get = selector => root.querySelector(selector);
  const model = JSON.parse(get('[data-website-model]').textContent);
  const form = get('[data-editor-form]'), choice = get('[data-post-choice]'), status = get('[data-editor-status]');
  let current = null, busy = false;
  const names = ['title','summary','body','episode','imageId','imageAlt','startsAt','endsAt'];
  function clinicInput(value) {
    if (!value) return '';
    return new Date(new Date(value).getTime() + 7200000).toISOString().slice(0,16);
  }
  function documentValue() {
    const value = Object.fromEntries(names.map(name=>[name,form.elements.namedItem(name).value]));
    for (const key of ['startsAt','endsAt']) value[key] = value[key] ? new Date(value[key] + ':00+02:00').toISOString() : null;
    return value;
  }
  function message(text, error = false) { status.textContent = text; status.dataset.state = error ? 'error' : ''; }
  async function request(url, body, { image = false } = {}) {
    const response = await fetch(url, {method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json','x-shiloh-csrf-token':root.dataset.csrf,...(image ? {} : {'Content-Type':'application/json'})},
      body:image ? body : JSON.stringify(body)});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'That change could not be saved. Your previous published version is unchanged.');
    return data;
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    root.querySelectorAll('button,select,input[type=file]').forEach(node=>{node.disabled=true;});
    try { await action(); } catch (error) { message(error.message,true); }
    finally { busy=false;root.querySelectorAll('button,select,input[type=file]').forEach(node=>{node.disabled=false;}); }
  }
  async function history() {
    const select = get('[data-history-choice]'); select.replaceChildren();
    if (!current?.id) return;
    const response = await fetch(`/calendar/website/${current.id}/history`,{credentials:'same-origin',cache:'no-store'});
    if (!response.ok) return;
    const versions = await response.json();
    for (const version of versions) {
      const option = document.createElement('option');option.value=version.revision;
      option.textContent=`Version ${version.revision} · ${version.action} · ${new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(version.created_at))}`;
      select.append(option);
    }
  }
  function fill(post) {
    current=post;form.hidden=false;message('');get('[data-preview-panel]').hidden=true;
    const doc=post.draft;
    for(const name of names) form.elements.namedItem(name).value = ['startsAt','endsAt'].includes(name) ? clinicInput(doc[name]) : doc[name] ?? '';
    get('[data-episode-field]').hidden=post.kind==='offer';get('[data-offer-terms]').hidden=post.kind!=='offer';
    get('[data-editor-heading]').textContent=post.kind==='offer'?'Morning Welcome Offer':'Discover Shiloh episode';
    get('[data-unpublish]').hidden=!post.published;
    form.elements.namedItem('episode').required=post.kind==='episode';
    get('[data-history]').hidden=!post.id;
    history().catch(()=>{});
  }
  function remember(post) {
    const i=model.posts.findIndex(p=>p.id===post.id);
    if(i<0) model.posts.unshift(post);else model.posts[i]=post;
    let option=[...choice.options].find(o=>o.value===post.id);
    if(!option){option=document.createElement('option');option.value=post.id;choice.append(option);}
    option.textContent=`${post.kind==='offer'?'Offer':`Episode ${post.draft.episode}`} · ${post.draft.title} · ${post.published?'Published / scheduled':'Draft'}`;
    choice.value=post.id;current=post;get('[data-unpublish]').hidden=!post.published;get('[data-history]').hidden=false;
    history().catch(()=>{});
  }
  async function save(action) {
    if(action!=='unpublish'&&!form.reportValidity()) return null;
    const doc=action==='unpublish'?current.draft:documentValue();
    if(action!=='unpublish'&&doc.imageId&&!doc.imageAlt.trim())throw new Error('Add an image description before saving.');
    if(!current.id){const post=await request('/calendar/website/create',{document:doc});remember(post);}
    const post=await request(`/calendar/website/${current.id}/${action}`,{revision:current.revision,document:doc});
    remember(post);
    message(action==='publish'?'Published. The website now follows your publication dates.':action==='unpublish'?'Taken off the website. Your draft is kept.':'Draft saved. The published version is unchanged.');
    return post;
  }
  choice.addEventListener('change',()=>{const post=model.posts.find(p=>p.id===choice.value);if(post)fill(post);else form.hidden=true;});
  get('[data-new-episode]').addEventListener('click',()=>{choice.value='';fill({id:null,kind:'episode',draft:{episode:Math.max(0,...model.posts.filter(p=>p.kind==='episode').map(p=>Number(p.draft.episode)||0))+1}});form.elements.namedItem('title').focus();});
  form.addEventListener('submit',event=>{event.preventDefault();run(()=>save('save'));});
  get('[data-publish]').addEventListener('click',()=>run(()=>save('publish')));
  get('[data-unpublish]').addEventListener('click',()=>run(()=>save('unpublish')));
  get('[data-preview]').addEventListener('click',()=>run(async()=>{
    const post=await save('save');if(!post)return;
    get('[data-preview-frame]').src=`/calendar/website/${post.id}/preview?revision=${post.revision}`;
    get('[data-preview-panel]').hidden=false;get('[data-preview-panel]').scrollIntoView({behavior:'auto',block:'start'});
  }));
  root.querySelectorAll('[data-preview-width]').forEach(button=>button.addEventListener('click',()=>get('[data-preview-frame]').classList.toggle('phone',button.dataset.previewWidth==='phone')));
  get('[data-restore]').addEventListener('click',()=>run(async()=>{
    const restoreRevision=Number(get('[data-history-choice]').value);
    if(!restoreRevision)return;
    const post=await request(`/calendar/website/${current.id}/restore`,{revision:current.revision,restoreRevision});
    remember(post);fill(post);message('Restored as a draft. Preview before publishing.');
  }));
  get('[data-image-upload]').addEventListener('change',event=>run(async()=>{
    const file=event.target.files[0];if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('Choose a JPEG, PNG or WebP image under 12 MB.');
    const bitmap=await createImageBitmap(file);
    try{
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));
      if(!blob)throw new Error('This image could not be prepared. Choose another image.');
      const body=new FormData();body.append('image',blob,'website-image.webp');
      const media=await request('/calendar/website/image',body,{image:true});
      form.elements.namedItem('imageId').value=media.id;
      form.elements.namedItem('imageAlt').required=true;message('Image uploaded. Add its description, then save your draft.');
    }finally{bitmap.close();}
  }));
})();
