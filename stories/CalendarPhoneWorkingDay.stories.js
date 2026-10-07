import phoneGrid from './fixtures/calendarPhoneWorkingDay.html?raw';
export default { title: 'Calendar/Phone working day', parameters: { layout: 'fullscreen' } };
export const FourStaff = {
  render: () => {
    const frame = document.createElement('iframe');
    frame.title = 'Synthetic phone Calendar — 08:00 to 17:00';
    frame.style.cssText = 'border:0;display:block;width:390px;max-width:100%;height:844px';
    // srcdoc has no routable Calendar URL; the static story keeps navigation inert.
    // Browser proof uses real local routes and the unchanged production scripts.
    frame.srcdoc = phoneGrid.replace('<script>', '<script>((location,history)=>{').replace('</script>', `})({href:parent.location.origin+'/calendar/read-only?view=week&phoneStaff=default',origin:parent.location.origin,assign:()=>{}},{replaceState:()=>{}});</script>`);
    return frame;
  },
};
