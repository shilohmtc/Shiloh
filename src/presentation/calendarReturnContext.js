// Calendar-only return context. Never accept an arbitrary redirect destination.
function calendarReturnHref(raw, appointmentId) {
  const params = new URLSearchParams();
  if (typeof raw === 'string' && raw.length <= 2000 && raw.startsWith('/calendar/read-only?')) {
    const source = new URL(raw, 'https://calendar.invalid').searchParams;
    for (const [key, value] of source) {
      const valid = key === 'view' ? ['week', 'month', 'day', 'agenda'].includes(value) : key === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(value) : key === 'staff' ? /^(all|[1-9][0-9]*)$/.test(value) : key === 'activeStaff' ? /^[1-9][0-9]*$/.test(value) : key === 'phoneStaff' ? /^(all|none|default|[1-9][0-9]*(,[1-9][0-9]*)*)$/.test(value) : key === 'phoneLayout' && ['compact', 'roomier'].includes(value);
      if (valid) params.append(key, value);
    }
  }
  if (/^[1-9][0-9]*$/.test(String(appointmentId))) params.set('appointment', String(appointmentId));
  return '/calendar/read-only' + (params.size ? '?' + params.toString() : '');
}

function calendarReturnClientScript() {
  return `const calendarReturnHref=${calendarReturnHref.toString()};`;
}
module.exports = { calendarReturnHref, calendarReturnClientScript };
