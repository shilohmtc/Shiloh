import groupBookingPresentation from '../src/presentation/calendarGroupBookingUx.js';

export default { title: 'Workspace/Group treatment label', parameters: { layout: 'fullscreen' } };

// Minimal synthetic label review; interactive booking behavior is covered by
// the existing group browser tests. No client, device or payment fixture data.
export const YoungGuest = {
  render: () => {
    const html = groupBookingPresentation.renderCalendarGroupBookingPage({
      options: {
        services: [{ id: 81, name: 'Young Guest Back &!Neck Massage (age 8-15)', durationMinutes: 30, price: 250, staffIds: [11, 12] }],
        staff: [{ id: 11, displayName: 'Synthetic practitioner A' }, { id: 12, displayName: 'Synthetic practitioner B' }],
        authority: {},
      },
      prefill: { date: '2099-10-24', time: '08:30' },
    });
    const page = new DOMParser().parseFromString(html, 'text/html');
    const root = document.createElement('div');
    for (const style of page.querySelectorAll('style')) root.append(style.cloneNode(true));
    for (const script of page.querySelectorAll('script')) script.remove();
    root.insertAdjacentHTML('beforeend', page.body.innerHTML);
    return root;
  },
};
