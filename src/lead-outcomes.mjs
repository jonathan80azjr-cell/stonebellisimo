export const PROJECT_OUTCOMES = Object.freeze([
  'Estimate Scheduled',
  'Job Completed',
  'Invoice Collected'
]);

export function projectOutcome(lead = {}) {
  if (PROJECT_OUTCOMES.includes(lead.salesStatus)) return lead.salesStatus;
  // Preserve completed historical projects without inventing a booked estimate
  // for leads that were only marked New Lead or Qualified.
  if (lead.salesStatus === 'Repeat / Review' || (!lead.salesStatus && lead.businessStatus === 'completed')) {
    return lead.stageTimestamps?.invoiceCollectedAt ? 'Invoice Collected' : 'Job Completed';
  }
  return '';
}

export function summarizeLeadOutcomes(leads, totals = { total: 0, qualified: 0, completed: 0, biteSitesShareCents: 0 }) {
  for (const lead of leads) {
    const outcome = projectOutcome(lead);
    const completed = ['Job Completed', 'Invoice Collected'].includes(outcome);
    totals.total += 1;
    if (outcome) totals.qualified += 1;
    if (completed) {
      totals.completed += 1;
      totals.biteSitesShareCents += Number(lead.biteSitesShareCents || 0);
    }
  }
  return totals;
}
