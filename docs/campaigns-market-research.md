# Campaigns and market research

The admin portal combines first-party website analytics, imported Search Console data, and recorded project outcomes. The monthly planning budget defaults to $100. Campaign drafts include a county/borough target, a platform, a stable UTM link, ad copy, and a downloadable brief.

`Estimate Scheduled` counts as qualified; completed jobs and collected invoices also remain qualified. Revenue includes only `Invoice Collected`. Research compares equal lead-submission cohorts in Eastern time and shows their current outcomes. Campaign attribution describes the recorded submission session or an explicit staff assignment, not incremental lift.

Project locations come from a customer ZIP, an unambiguous city/state in their submitted address, or an explicit admin correction. Page views do not establish job location. Test traffic and known test leads are excluded; unknown sources and areas remain visible. Public inquiry forms now collect optional project ZIP and discovery source. Phone and referral inquiries can be recorded from the research page.

`marketingResearchSchedule` creates an aggregate snapshot every day at 08:00 America/New_York. The page refreshes every 15 minutes while visible; manual refresh and saved marketing changes refresh immediately. Saving a project outcome invalidates the browser's report so returning to research fetches current outcomes. API report caches expire after 15 minutes. Existing Search Console imports supply search data; import failures/staleness are shown.

All `/api/admin/marketing/*` routes require the existing Firebase admin authorization. Collections are `marketing_settings`, `marketing_campaigns`, `marketing_spend`, `marketing_report_cache`, and `marketing_snapshots`. No raw lead contact details or addresses are stored in report caches or snapshots. Lead marketing corrections are stored on the existing lead document.

Campaign records do not launch or modify ads. Advertising accounts are not connected. Actual daily spend is entered by an admin; saving a date replaces that date's total. Costs and ROAS use recorded costs only. Transactional allocation checks prevent campaigns marked tracking in the same month from exceeding the monthly planning budget. These are planning controls, not spending limits enforced at an ad platform.

Validation: `npm test`, `npm run check`, `tests/marketing-emulator.mjs` with a fresh demo Firestore emulator, and `tests/marketing-browser.mjs` with demo Auth/Firestore/Functions/Hosting. Browser checks cover desktop/mobile layout, persisted campaign drafts, spend, phone inquiries, immediate outcome refresh, and reload. `tests/browser-smoke.mjs` also verifies the three project outcomes and public form attribution.

Production release note: the previously deployed backend predates unrelated growth automation on main. This feature was applied as a scoped overlay to the deployed `siteApi` source, adding the three market research files and changes to routing and contact fields, plus the new daily schedule. Only `siteApi` and `marketingResearchSchedule` were deployed. Hosting replaced the admin HTML/CSS/JS and the two public inquiry pages while retaining every other live file and the live hosting configuration.
