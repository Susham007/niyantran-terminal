// Agent registry. Add a new feed by dropping a module in this folder and listing
// it here — run-all.mjs and the admin dashboard pick it up automatically.
//
// Each source module exports: id (string), label (string), run() -> Promise
// resolving to { rows:[...], ...extra } (or throwing on failure).
//
// Batch feeds only. Genuinely-live feeds (ships/AIS, aircraft/OpenSky) are NOT
// agents — a 6h-old vessel position is meaningless — they stay on-demand via
// their own functions. See README "Live vs batch".
import * as conflict from './conflict.mjs';
import * as news from './news.mjs';
import * as markets from './markets.mjs';
import * as bills from './bills.mjs';   // overrides national_bill_tracker.csv (csvKey)

export const SOURCES = [conflict, news, markets, bills];
