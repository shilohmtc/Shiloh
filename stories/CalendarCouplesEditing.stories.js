// Synthetic cards rendered by the production Calendar renderer. The fixture
// executes the production appointment-details and paired-editor scripts.
import fixture from './fixtures/calendarCouplesEditing.html?raw';
export default { title: 'Calendar/Couples editing', parameters: { layout: 'fullscreen' } };
export const LinkedPair = { render: () => {
  const frame = document.createElement('iframe');
  frame.title = 'Synthetic couples appointment editor';
  frame.style.cssText = 'border:0;display:block;width:100%;height:100vh';
  frame.srcdoc = fixture;
  return frame;
} };
