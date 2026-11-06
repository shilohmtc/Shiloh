# Payment visit context

Payment pages showed a client and treatment but did not identify the selected appointment date/time or practitioner. Repeat bookings were hard to distinguish, and entering payments without a Calendar return URL sent Back to appointment to the current period.

The existing authorized booking subject now also reads its selected appointment start/end and practitioner name snapshots. The page shows these in clinic time, identifying a selected visit explicitly for a shared booking. It does not infer other participants or change the whole-booking financial amounts. Missing or invalid context is omitted, not invented.

The default return uses the existing appointment link helper and the actual appointment date. Valid Calendar filters and layout are preserved. If a caller supplies no date, the selected visit supplies it. Arbitrary return destinations are still rejected.

No financial calculations, permissions, payment actions, data mutations or schema changes are introduced. Synthetic PostgreSQL-compatible tests verify the read model and unchanged amount/receipt/balance values; browser and Storybook tests cover phone/desktop, escaped names, midnight clinic-time conversion and safe returns. Live verification must not perform payment or client-record writes.
