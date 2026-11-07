const { createFixture } = require('./calendarCouplesCreationFixture');
async function createGuestFixture(t) {
  const f = await createFixture({ nativeUrl: null, guestBooking: true });
  t.after(f.close);
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(201,'Synthetic Organiser','27810000201','test')");
  await f.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(201,'clinic','test')");
  const input = { ...f.groupInput, organiserClientId: 201,
    guests: f.groupInput.guests.map((g, i) => i < 2 ? { ...g, noMobile: true, mobile: '' } : g) };
  const review = await f.groupService.prepare(input);
  const created = await f.groupService.confirm({ adminId: 7, reviewKey: review.review.guestContact.reviewKey });
  return { ...f, created };
}
module.exports = { createGuestFixture };
