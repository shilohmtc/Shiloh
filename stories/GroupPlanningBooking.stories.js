// Actual production presenter and client script; synthetic data and blocked writes.
import fixture from './fixtures/workspaceBrowserReview.generated/group-enquiry-handover.html?raw';
export default { title: 'Calendar/Group enquiry handover', parameters: { layout: 'fullscreen' } };
export const EnquiryContact = { render: () => {
  const frame = document.createElement('iframe');
  frame.title = 'Synthetic group enquiry booking';
  frame.style.cssText = 'border:0;display:block;width:100%;height:100vh';
  frame.srcdoc = fixture;
  return frame;
} };
