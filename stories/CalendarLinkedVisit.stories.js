import presentation from '../src/presentation/calendarMultiServiceBookingUx.js';

export default { title: 'Calendar/Linked visit', parameters: { layout: 'fullscreen' } };

export const ThreeTreatments = {
  render: () => {
    const html = presentation.renderCalendarMultiServiceBookingPage({
      options: {
        services: [
          { id: 10, name: 'Synthetic first treatment', durationMinutes: 90, price: 650, staffIds: [3] },
          { id: 11, name: 'Synthetic second treatment', durationMinutes: 90, price: 550, staffIds: [3] },
          { id: 12, name: 'Synthetic third treatment', durationMinutes: 60, price: 400, staffIds: [3] },
        ],
        staff: [{ id: 3, displayName: 'Synthetic practitioner' }],
      },
      prefill: { date: '2099-11-20' },
    });
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script[src]').forEach((script) => script.remove());
    const root = document.createElement('div');
    for (const style of parsed.querySelectorAll('style')) root.append(style.cloneNode(true));
    root.insertAdjacentHTML('beforeend', parsed.body.innerHTML);
    setTimeout(() => new Function(presentation.calendarMultiServiceBookingClientScript())(), 0);
    return root;
  },
};
