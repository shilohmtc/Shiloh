require('./clientMultiStaffAppointmentChangePatch');
const discovery = require('../services/clientDiscoveryPackages');
const couplesBooking = require('../services/clientCouplesMassageBooking');
const { CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY } = require('../services/whatsappBookingIdentity');

const COUPLES_AND_PACKAGES_ACTION_ID = 'client_massage_couples_packages';
const COUPLES_MASSAGE_ACTION_ID = 'client_couples_massage';
const SPORTS_PACKAGE_ACTION_ID = 'client_couples_packages_sports';
const MASSAGE_FIRST_PAGE_ACTION_ID = 'client_massage_treatments_page_1';
const SPORTS_PACKAGE_SLUG = discovery.SPORTS_PACKAGE_SLUG || 'sports-massage-monthly';

function clean(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `R${amount.toFixed(2).replace(/\.00$/, '')}` : 'Price on request';
}

function sportsPackage(packages = []) {
  return packages.find((pkg) => pkg?.slug === SPORTS_PACKAGE_SLUG) || null;
}

function buildCouplesAndPackagesInteractive(packages = []) {
  const pkg = sportsPackage(packages);
  const rows = [
    {
      id: COUPLES_MASSAGE_ACTION_ID,
      title: 'Couples Massage',
      description: `${couplesBooking.DURATION_MINUTES} min • ${couplesBooking.formatMoney(couplesBooking.PRICE)} • Abigail & Christel`,
    },
  ];

  if (pkg) {
    rows.push({
      id: SPORTS_PACKAGE_ACTION_ID,
      title: 'Sports Massage Package',
      description: `${Number(pkg.sessions_included)} sessions • ${money(pkg.package_price)} • valid ${pkg.validity_months ? Number(pkg.validity_months) + ' month(s)' : Number(pkg.validity_days) + ' days'}`,
    });
  }

  rows.push({
    id: MASSAGE_FIRST_PAGE_ACTION_ID,
    title: 'Back',
    description: 'Back to Massage Treatments',
  });

  return {
    type: 'list',
    body: '*Couples & Packages*\nChoose a special massage booking:',
    buttonText: 'Choose option',
    rows,
    sectionTitle: 'Couples & Packages',
  };
}

function decorateMassageTreatmentsInteractive(interactive) {
  if (!interactive || interactive.type !== 'list' || !Array.isArray(interactive.rows)) return interactive;
  if (!/^\*Massage Treatments\*/i.test(clean(interactive.body))) return interactive;

  // Couples Massage is a coordinated two-practitioner booking. Never expose the
  // canonical service as an ordinary one-practitioner massage row.
  const rows = interactive.rows.filter((row) => {
    if (row?.id === 'client_massage_packages' || row?.id === COUPLES_AND_PACKAGES_ACTION_ID) return false;
    return clean(row?.title).toLowerCase() !== 'couples massage';
  });

  const firstPage = /Showing page 1 of \d+/i.test(String(interactive.body || ''));
  if (firstPage) {
    rows.unshift({
      id: COUPLES_AND_PACKAGES_ACTION_ID,
      title: 'Couples & Packages',
      description: 'Couples massage & massage packages',
    });
  }

  return {
    ...interactive,
    body: firstPage
      ? String(interactive.body || '').replace('Choose a treatment, or open Massage Packages.', 'Choose a treatment, or open Couples & Packages.')
      : interactive.body,
    rows,
  };
}

function decorateSportsPackageDetail(interactive) {
  if (!interactive || interactive.type !== 'button' || !Array.isArray(interactive.buttons)) return interactive;
  const buttons = interactive.buttons.filter((button) => button?.id !== COUPLES_AND_PACKAGES_ACTION_ID);
  if (buttons.length < 3) buttons.push({ id: COUPLES_AND_PACKAGES_ACTION_ID, title: 'Back' });
  return { ...interactive, buttons };
}

const originalProcessClientDiscoveryMessage = discovery.processClientDiscoveryMessage;

discovery.processClientDiscoveryMessage = async function processClientDiscoveryMessageWithCouplesPackages(sender, text) {
  const raw = clean(text);

  if (await couplesBooking.hasActiveIntent(sender)) {
    const result = await couplesBooking.processCouplesMassageMessage(sender, text);
    if (result?.returnToCouplesPackages) {
      const packages = await discovery.activePackages();
      return { handled: true, interactive: buildCouplesAndPackagesInteractive(packages) };
    }
    if (result?.handled) return result;
  }

  if (raw === COUPLES_AND_PACKAGES_ACTION_ID || /^couples\s*(?:&|and)\s*packages$/i.test(raw)) {
    const packages = await discovery.activePackages();
    return { handled: true, interactive: buildCouplesAndPackagesInteractive(packages) };
  }

  if (raw === COUPLES_MASSAGE_ACTION_ID || /^couples massage$/i.test(raw)) {
    return couplesBooking.startCouplesMassage(sender);
  }

  if (raw === SPORTS_PACKAGE_ACTION_ID) {
    const pkg = sportsPackage(await discovery.activePackages());
    if (!pkg) return { handled: true, reply: 'The Sports Massage Package is not currently active. Nothing has been booked.' };
    const { entitlement, unsupportedIdentityModel } = await discovery.activeEntitlementForPhone(sender, pkg.id);
    if (unsupportedIdentityModel) return { handled: true, status: 'crm_v2_package_legacy_boundary', reply: CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY };
    return { handled: true, interactive: decorateSportsPackageDetail(discovery.packageDetailInteractive(pkg, entitlement)) };
  }

  const result = await originalProcessClientDiscoveryMessage(sender, text);
  if (!result?.handled || !result.interactive) return result;
  return { ...result, interactive: decorateMassageTreatmentsInteractive(result.interactive) };
};

module.exports = {
  COUPLES_AND_PACKAGES_ACTION_ID,
  COUPLES_MASSAGE_ACTION_ID,
  SPORTS_PACKAGE_ACTION_ID,
  buildCouplesAndPackagesInteractive,
  decorateMassageTreatmentsInteractive,
  decorateSportsPackageDetail,
};
