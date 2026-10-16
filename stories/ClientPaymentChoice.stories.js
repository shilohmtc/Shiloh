import presentation from '../src/presentation/myShilohPaymentChoice.js';
import fixtures from './fixtures/clientPaymentChoice.js';
function surface(kind){const html=presentation.renderClientPaymentChoice({model:fixtures.choiceFixture(kind),csrfToken:'synthetic-csrf',appointmentId:201});return html.match(/<link[^>]+>/g).join('')+html.match(/<body>([\s\S]*)<\/body>/)[1];}
export default {title:'Client/Payment choice',parameters:{layout:'fullscreen'}};
export const Ordinary={render:()=>surface('ordinary')};
export const Partial={render:()=>surface('partial')};
export const Waived={render:()=>surface('waived')};
export const SharedReview={render:()=>surface('shared')};
export const EarlierAttempt={render:()=>surface('pending')};
export const Settled={render:()=>surface('settled')};
export const AllOwnedGroup={render:()=>surface('group')};
