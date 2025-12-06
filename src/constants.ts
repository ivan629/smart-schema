/**
 * SmartSchema v2 - Constants & Patterns
 *
 * Centralized pattern definitions for semantic role inference.
 * Patterns are ordered by specificity (most specific first).
 *
 * DESIGN PRINCIPLES:
 * - Universal patterns only (no industry-specific)
 * - Suffix patterns before word patterns (more precise)
 * - Avoid conflicts between categories
 * - Extensible via options
 */

import type { FieldFormat } from './types.js';

// ============================================================================
// Date Formats (for type promotion)
// ============================================================================

export const DATE_FORMATS = new Set<FieldFormat>(['datetime', 'date', 'time']);

// ============================================================================
// Role Patterns
// ============================================================================

export const IDENTIFIER_PATTERNS: RegExp[] = [
    // Suffix patterns (most reliable)
    /_id$/i,
    /_key$/i,
    /_ref$/i,
    /_code$/i,          // promo_code, country_code
    /_token$/i,
    /_hash$/i,
    /_uuid$/i,
    /_guid$/i,
    /Id$/,              // visitorId, visitorID
    /Key$/,
    /Ref$/,

    // Prefix patterns
    /^id_/i,            // id_user, id_order

    // Exact/word patterns
    /\bid\b/i,
    /\bkey\b/i,
    /\buuid\b/i,
    /\bguid\b/i,
    /\bsku\b/i,
    /\bslug\b/i,
    /\bhandle\b/i,      // Shopify-style handles
    /\btoken\b/i,
    /\bhash\b/i,
    /\bchecksum\b/i,
    /\bfingerprint\b/i,
    /\bsignature\b/i,
    /\bref\b/i,
    /\bpk\b/i,          // primary key
    /\bfk\b/i,          // foreign key
    /\boid\b/i,         // object id (MongoDB)
    /\buid\b/i,         // unique id
    /\bsid\b/i,         // session id
    /\bpid\b/i,         // process/product id
    /\bcid\b/i,         // customer/correlation id
    /\baid\b/i,         // account/action id
    /\bnumber\b/i,      // invoice_number, order_number (when string)
];

export const TIME_PATTERNS: RegExp[] = [
    // Suffix patterns (most reliable)
    /_at$/i,            // created_at, updated_at
    /_on$/i,            // created_on
    /_date$/i,
    /_time$/i,
    /_datetime$/i,
    /_ts$/i,            // created_ts
    /_timestamp$/i,
    /_period_start$/i,  // billing period boundaries
    /_period_end$/i,
    /period_start$/i,   // current_period_start (no leading underscore)
    /period_end$/i,     // current_period_end
    /At$/,              // createdAt
    /On$/,              // createdOn
    /Date$/,
    /Time$/,

    // Core time words
    /\bdate\b/i,
    /\btime\b/i,
    /\btimestamp\b/i,
    /\bdatetime\b/i,

    // Lifecycle events - past tense
    /\bcreated\b/i,
    /\bupdated\b/i,
    /\bmodified\b/i,
    /\bchanged\b/i,
    /\bdeleted\b/i,
    /\bremoved\b/i,
    /\barchived\b/i,

    /\bstarted\b/i,
    /\bended\b/i,
    /\bfinished\b/i,
    /\bcompleted\b/i,
    /\bfailed\b/i,

    /\bissued\b/i,
    /\bpaid\b/i,
    /\bbilled\b/i,
    /\bcharged\b/i,
    /\brefunded\b/i,

    /\bsubmitted\b/i,
    /\bapproved\b/i,
    /\brejected\b/i,
    /\bconfirmed\b/i,
    /\bverified\b/i,

    /\bresolved\b/i,
    /\bclosed\b/i,
    /\bescalated\b/i,
    /\bassigned\b/i,
    /\bclaimed\b/i,

    /\bregistered\b/i,
    /\benrolled\b/i,
    /\bjoined\b/i,
    /\bactivated\b/i,
    /\bdeactivated\b/i,
    /\bsuspended\b/i,
    /\bcancelled\b/i,
    /\bcanceled\b/i,

    /\bpublished\b/i,
    /\bdrafted\b/i,
    /\bscheduled\b/i,
    /\breleased\b/i,
    /\bdeployed\b/i,
    /\blaunched\b/i,

    /\bsent\b/i,
    /\bdelivered\b/i,
    /\breceived\b/i,
    /\bopened\b/i,
    /\bclicked\b/i,
    /\bviewed\b/i,
    /\baccessed\b/i,

    /\blogged\b/i,
    /\bsigned\b/i,
    /\blocked\b/i,
    /\bunlocked\b/i,

    /\bexpired\b/i,
    /\bexpires?\b/i,
    /\brenewed\b/i,

    /\bshipped\b/i,
    /\bfulfilled\b/i,
    /\breturned\b/i,

    /\bsynced\b/i,
    /\brefreshed\b/i,
    /\bcomputed\b/i,
    /\bmigrated\b/i,
    /\bimported\b/i,
    /\bexported\b/i,
    /\bbackup/i,

    /\bborn\b/i,
    /\bdied\b/i,

    // Date-specific nouns
    /\bbirthday\b/i,
    /\banniversary\b/i,
    /\bdeadline\b/i,
    /\bdue\b/i,
    /\betd\b/i,
    /\beta\b/i,
    /\beffective\b/i,

    // Period boundaries
    /\bperiod_start\b/i,
    /\bperiod_end\b/i,
    /\bvalid_from\b/i,
    /\bvalid_until\b/i,
    /\bvalid_to\b/i,
    /\bstart_date\b/i,
    /\bend_date\b/i,
    /\bfrom_date\b/i,
    /\bto_date\b/i,
    /\bbegin\b/i,
    /\buntil\b/i,
];

export const MEASURE_PATTERNS: RegExp[] = [
    /time_on_site/i,
    /days_since/i,
    // Suffix patterns (most reliable)
    /_count$/i,
    /_total$/i,
    /_sum$/i,
    /_avg$/i,
    /_min$/i,
    /_max$/i,
    /_amount$/i,
    /_value$/i,
    /_rate$/i,
    /_ratio$/i,
    /_percent$/i,
    /_pct$/i,
    /_score$/i,
    /_points$/i,
    /_level$/i,
    /_index$/i,
    /_rank$/i,
    /_factor$/i,
    /_coefficient$/i,

    // Unit suffixes
    /_ms$/i,
    /_seconds$/i,
    /_minutes$/i,
    /_hours$/i,
    /_days$/i,
    /_bytes$/i,
    /_kb$/i,
    /_mb$/i,
    /_gb$/i,
    /_usd$/i,
    /_eur$/i,
    /_gbp$/i,
    /_cad$/i,
    /_aud$/i,
    /_px$/i,

    // Core measure words
    /\bcount\b/i,
    /\btotal\b/i,
    /\bsum\b/i,
    /\bamount\b/i,
    /\bquantity\b/i,
    /\bqty\b/i,

    // Financial
    /\bprice\b/i,
    /\bcost\b/i,
    /\bfee\b/i,
    /\btax\b/i,
    /\brevenue\b/i,
    /\bprofit\b/i,
    /\bmargin\b/i,
    /\bbalance\b/i,
    /\bbudget\b/i,
    /\bspend\b/i,
    /\bspending\b/i,
    /\bsavings\b/i,
    /\bdebt\b/i,
    /\bcredit\b/i,
    /\bdebit\b/i,
    /\bdiscount\b/i,
    /\brebate\b/i,
    /\bcommission\b/i,
    /\btip\b/i,
    /\bsurcharge\b/i,
    /\bpenalty\b/i,
    /\binterest\b/i,
    /\bdividend\b/i,
    /\bdeposit\b/i,
    /\bwithdrawal\b/i,
    /\bpayout\b/i,
    /\bearnings\b/i,
    /\bsalary\b/i,
    /\bwage\b/i,
    /\bmrr\b/i,
    /\barr\b/i,
    /\bltv\b/i,
    /\bcac\b/i,
    /\barpu\b/i,
    /\baov\b/i,
    /\bgmv\b/i,
    /\broi\b/i,
    /\broas\b/i,

    // Scores & ratings
    /\bscore\b/i,
    /\brating\b/i,
    /\brank\b/i,
    /\bpoints\b/i,
    /\bgrade\b/i,
    /\blevel\b/i,

    // Percentages & ratios
    /\bpercent/i,
    /\bratio\b/i,
    /\brate\b/i,
    /\bfraction\b/i,
    /\bshare\b/i,

    // Statistics
    /\bavg\b/i,
    /\baverage\b/i,
    /\bmean\b/i,
    /\bmedian\b/i,
    /\bmode\b/i,
    /\bmin\b/i,
    /\bmax\b/i,
    /\brange\b/i,
    /\bstdev\b/i,
    /\bstd_dev\b/i,
    /\bvariance\b/i,
    /\bpercentile\b/i,
    /\bquartile\b/i,

    // Metrics & KPIs
    /\bmetric\b/i,
    /\bkpi\b/i,
    /\bindic/i,
    /\bbenchmark\b/i,
    /\bbaseline\b/i,
    /\btarget\b/i,
    /\bgoal\b/i,
    /\bthreshold\b/i,
    /\bquota\b/i,

    // ML/AI
    /\bconfidence\b/i,
    /\bprobability\b/i,
    /\blikelihood\b/i,
    /\bimportance\b/i,
    /\bstrength\b/i,
    /\bseverity\b/i,
    /\bweight\b/i,
    /\bloss\b/i,
    /\baccuracy\b/i,
    /\bprecision\b/i,
    /\brecall\b/i,
    /\bf1\b/i,
    /\bauc\b/i,
    /\bmae\b/i,
    /\bmse\b/i,
    /\brmse\b/i,
    /\br2\b/i,
    /\bentropy\b/i,
    /\bperplexity\b/i,

    // Physical dimensions
    /\bwidth\b/i,
    /\bheight\b/i,
    /\blength\b/i,
    /\bdepth\b/i,
    /\bsize\b/i,
    /\barea\b/i,
    /\bvolume\b/i,
    /\bdistance\b/i,
    /\bradius\b/i,
    /\bdiameter\b/i,

    // Geographic
    /\blatitude\b/i,
    /\blongitude\b/i,
    /\blat\b/i,
    /\blng\b/i,
    /\balt\b/i,         // altitude
    /\belevation\b/i,

    // Time durations
    /\bduration\b/i,
    /\blatency\b/i,
    /\binterval\b/i,
    /\belapsed\b/i,
    /\bttl\b/i,
    /\btimeout\b/i,
    /\buptime\b/i,
    /\bdowntime\b/i,

    // Rates & velocities
    /\bfrequency\b/i,
    /\bvelocity\b/i,
    /\bspeed\b/i,
    /\bthroughput\b/i,
    /\bbandwidth\b/i,
    /\bcapacity\b/i,
    /\bload\b/i,
    /\butilization\b/i,
    /\boccupancy\b/i,
    /\befficiency\b/i,
    /\bproductivity\b/i,
    /\byield\b/i,

    // Engagement metrics
    /\bconversion\b/i,
    /\bretention\b/i,
    /\bchurn\b/i,
    /\battrition\b/i,
    /\bacquisition\b/i,
    /\bactivation\b/i,
    /\bengagement\b/i,
    /\badoption\b/i,
    /\bpenetration\b/i,
    /\bcoverage\b/i,
    /\breach\b/i,
    /\bimpression/i,
    /\bclick\b/i,
    /\bbounce\b/i,
    /\bexit\b/i,
    /\bscroll\b/i,

    // Computing resources
    /\bmemory\b/i,
    /\bcpu\b/i,
    /\bgpu\b/i,
    /\bdisk\b/i,
    /\bstorage\b/i,
    /\bcache\b/i,
    /\bbuffer\b/i,
    /\bqueue\b/i,
    /\bpool\b/i,
    /\bthread\b/i,
    /\bconnection\b/i,

    // Data sizes
    /\bbytes?\b/i,
    /\btokens?\b/i,
    /\bwords?\b/i,
    /\bcharacters?\b/i,
    /\blines?\b/i,
    /\bpages?\b/i,
    /\brecords?\b/i,
    /\brows?\b/i,

    // Web vitals
    /\blcp\b/i,
    /\bfid\b/i,
    /\bcls\b/i,
    /\bttfb\b/i,
    /\bfcp\b/i,
    /\binp\b/i,

    // Ordering & ranking
    /\bposition\b/i,
    /\bsequence\b/i,
    /\bindex\b/i,
    /\boffset\b/i,
    /\bgeneration\b/i,
    /\bversion\b/i,
    /\brevision\b/i,
    /\bbuild\b/i,
    /\biteration\b/i,
    /\bepoch\b/i,
    /\bbatch\b/i,
    /\bstep\b/i,
    /\bstage\b/i,
    /\btier\b/i,

    // Counts (explicit)
    /\binstance_count\b/i,
    /\bexposure_count\b/i,
    /\bretry_count\b/i,
    /\berror_count\b/i,
    /\bfailure_count\b/i,
    /\bsuccess_count\b/i,
    /\bpage_views\b/i,
    /\bunique_pages\b/i,
    /\blogin_count\b/i,
    /\bsession_count\b/i,
    /\bvisit_count\b/i,
];

export const TEXT_PATTERNS: RegExp[] = [
    // Suffix patterns
    /_text$/i,
    /_body$/i,
    /_content$/i,
    /_message$/i,
    /_description$/i,
    /_note$/i,
    /_notes$/i,
    /_comment$/i,
    /_html$/i,
    /_markdown$/i,
    /_md$/i,
    /_raw$/i,
    /_full$/i,

    // Core text words
    /\bdescription\b/i,
    /\btext\b/i,
    /\bcontent\b/i,
    /\bbody\b/i,
    /\bmessage\b/i,
    /\bcomment\b/i,
    /\bnotes?\b/i,

    // Long-form content
    /\bsummary\b/i,
    /\babstract\b/i,
    /\bexcerpt\b/i,
    /\bsnippet\b/i,
    /\bpreview\b/i,
    /\bteaser\b/i,
    /\bintro\b/i,
    /\boutro\b/i,

    // Titles & headings (can be text when long)
    /\bsubject\b/i,
    /\btitle\b/i,
    /\bheadline\b/i,
    /\bsubheading\b/i,
    /\bcaption\b/i,
    /\balt_text\b/i,

    // Communication
    /\bfeedback\b/i,
    /\bresponse\b/i,
    /\breply\b/i,
    /\bgreeting\b/i,
    /\bsignature\b/i,

    // Reviews & opinions
    /\breview\b/i,
    /\btestimonial\b/i,
    /\brecommendation\b/i,
    /\bcomplaint\b/i,
    /\bsuggestion\b/i,
    /\bopinion\b/i,
    /\bthoughts\b/i,
    /\binsights\b/i,
    /\bobservation\b/i,
    /\bfindings\b/i,
    /\bconclusion\b/i,

    // Analysis & reasoning
    /\breason\b/i,
    /\bexplanation\b/i,
    /\bjustification\b/i,
    /\brationale\b/i,
    /\banalysis\b/i,
    /\bassessment\b/i,
    /\bevaluation\b/i,
    /\bimpact\b/i,

    // Technical
    /\blog\b/i,
    /\berror_message\b/i,
    /\bwarning\b/i,
    /\bexception\b/i,
    /\bstack_trace\b/i,
    /\btraceback\b/i,
    /\bdebug\b/i,
    /\bquery\b/i,
    /\bprompt\b/i,
    /\binstruction\b/i,
    /\bcommand\b/i,
    /\bchangelog\b/i,
    /\brelease_notes\b/i,

    // User agent & technical strings
    /\buser_agent\b/i,
    /\buseragent\b/i,
    /\breferer\b/i,
    /\breferrer\b/i,

    // Documents
    /\barticle\b/i,
    /\bpost\b/i,
    /\bblog\b/i,
    /\bstory\b/i,
    /\bnarrative\b/i,
    /\btranscript\b/i,
    /\btranslation\b/i,
    /\bsubtitle\b/i,

    // Bio & profiles
    /\bbio\b/i,
    /\babout\b/i,
    /\bprofile\b/i,

    // Addresses (multi-line)
    /\baddress\b/i,
    /\bstreet\b/i,
    /\bdirections\b/i,

    // Legal
    /\bdisclaimer\b/i,
    /\bterms\b/i,
    /\bpolicy\b/i,
    /\bagreement\b/i,
    /\bcontract\b/i,

    // Compound patterns
    /\blong_term\b/i,
    /\bcumulative\b/i,
    /\boverall_assessment\b/i,
    /\bpsychological_impact\b/i,
    /\bdistinguishing\b/i,
];

// ============================================================================
// Aggregation Patterns
// ============================================================================

export const AVG_AGGREGATION_PATTERNS: RegExp[] = [
    // Explicit average words
    /\bavg\b/i,
    /\baverage\b/i,
    /\bmean\b/i,

    // Rates & ratios (inherently averaged)
    /\brate\b/i,
    /\bratio\b/i,
    /\bpercent/i,
    /\bfraction\b/i,

    // Scores & ratings (aggregate by avg)
    /\bscore\b/i,
    /\brating\b/i,
    /\bconfidence\b/i,
    /\bprobability\b/i,
    /\blikelihood\b/i,

    // Quality metrics
    /\bquality\b/i,
    /\bsatisfaction\b/i,
    /\bhappiness\b/i,
    /\bsentiment\b/i,
    /\bpolarity\b/i,
    /\bnps\b/i,
    /\bcsat\b/i,
    /\bces\b/i,

    // Weights & importance
    /\bimportance\b/i,
    /\bstrength\b/i,
    /\bseverity\b/i,
    /\bweight\b/i,
    /\bpriority\b/i,

    // Durations (avg makes sense)
    /\bduration/i,
    /\blatency/i,
    /\belapsed/i,
    /\btime\b/i,
    /_ms$/i,
    /_seconds$/i,
    /_minutes$/i,
    /_hours$/i,

    // Web vitals
    /\blcp\b/i,
    /\bfid\b/i,
    /\bcls\b/i,
    /\bttfb\b/i,
    /\bfcp\b/i,
    /\binp\b/i,

    // Scales & indices
    /\bdepth\b/i,
    /\bindex\b/i,
    /\bfactor\b/i,
    /\bcoefficient\b/i,
    /\bmultiplier\b/i,

    // Percentages
    /_pct$/i,
    /_percent$/i,
    /\bpct\b/i,

    // Adoption & utilization
    /\bscroll_depth/i,
    /\badoption/i,
    /\butilization/i,
    /\boccupancy/i,
    /\befficiency/i,

    // Device specs when aggregating
    /\bpixel_ratio\b/i,

    // Normalized values
    /\bnormalized\b/i,
    /\bscaled\b/i,
    /\bweighted\b/i,
    /\badjusted\b/i,
    /\brelative\b/i,

    // Per-unit metrics
    /\bper_user\b/i,
    /\bper_customer\b/i,
    /\bper_session\b/i,
    /\bper_visit\b/i,
    /\bper_page\b/i,
    /\bper_order\b/i,
    /\bper_day\b/i,
    /\barpu\b/i,
    /\baov\b/i,

    // ML model outputs
    /\bprediction\b/i,
    /\bforecast\b/i,
    /\bestimate\b/i,
    /\bprojection\b/i,

    // Statistics
    /\bpercentile\b/i,
    /\bquartile\b/i,
    /\bmedian\b/i,

    // Context-aware patterns for nested score values
    /scores?\..*\.value$/i,      // custom_scores.health_score.value
    /score\.value$/i,            // health_score.value
    /metrics\..*\.value$/i,      // metrics.custom_scores.*.value
    /_score\.percentile$/i,      // health_score.percentile
];

export const NONE_AGGREGATION_PATTERNS: RegExp[] = [
    // Limits & configuration
    /\bmax_/i,
    /\bmin_/i,
    /\blimit\b/i,
    /\bquota\b/i,
    /\bcap\b/i,
    /\bceiling\b/i,
    /\bfloor\b/i,
    /\bthreshold\b/i,
    /\bboundary\b/i,

    // Versions & identifiers
    /\bversion\b/i,
    /\bschema_version\b/i,
    /\brevision\b/i,
    /\bbuild\b/i,

    // Device/screen specs
    /\bscreen_width\b/i,
    /\bscreen_height\b/i,
    /\bpixel_ratio\b/i,
    /\bresolution\b/i,
    /\baspect\b/i,

    // Technical specs
    /\bbitrate\b/i,
    /\bsample_rate\b/i,
    /\bframe_rate\b/i,
    /\bfps\b/i,
    /\bdpi\b/i,
    /\bchannels\b/i,

    // Coordinates (don't aggregate)
    /\blatitude\b/i,
    /\blongitude\b/i,
    /\blat\b/i,
    /\blng\b/i,
    /\bx\b/i,
    /\by\b/i,
    /\bz\b/i,

    // Configuration
    /\bconfig\b/i,
    /\bsetting\b/i,
    /\boption\b/i,
    /\bpreference\b/i,
    /\bdefault\b/i,
    /\binitial\b/i,
    /\bbase\b/i,

    // Port/network identifiers
    /\bport\b/i,
    /\bpin\b/i,

    // Status codes
    /\bstatus_code\b/i,
    /\berror_code\b/i,
    /\bexit_code\b/i,
    /\breturn_code\b/i,
    /\bhttp_code\b/i,

    // Feature counts (static)
    /\bfeatures_used\b/i,

    // Age/time units (don't sum ages)
    /\bage\b/i,
    /\byear\b/i,
    /\bmonth\b/i,
    /\bday\b/i,
    /\bhour\b/i,
    /\bweek\b/i,
    /\bquarter\b/i,

    // Conversion values (binary 0/1, don't sum)
    /\bconversion_value\b/i,

    // Account age (don't sum)
    /\baccount_age/i,
    /\bdays_since/i,
];

// ============================================================================
// Unit Patterns (ordered by specificity)
// ============================================================================

export interface UnitPattern {
    pattern: RegExp;
    unit: string;
}

export const UNIT_PATTERNS: UnitPattern[] = [
    // =========================================================================
    // Currency (suffix patterns first)
    // =========================================================================
    { pattern: /_usd$/i, unit: 'usd' },
    { pattern: /_eur$/i, unit: 'eur' },
    { pattern: /_gbp$/i, unit: 'gbp' },
    { pattern: /_cad$/i, unit: 'cad' },
    { pattern: /_aud$/i, unit: 'aud' },
    { pattern: /_jpy$/i, unit: 'jpy' },
    { pattern: /_cny$/i, unit: 'cny' },
    { pattern: /_inr$/i, unit: 'inr' },
    { pattern: /_brl$/i, unit: 'brl' },
    { pattern: /\bcents\b/i, unit: 'cents' },
    { pattern: /\bpence\b/i, unit: 'pence' },
    // Currency word patterns
    { pattern: /(cost|price|amount|revenue|profit|mrr|arr|ltv|fee|tax|discount|balance|budget|spend|earnings|salary|wage|commission|tip|surcharge|penalty|interest|dividend|deposit|payout)(?!.*_)/i, unit: 'usd' },

    // =========================================================================
    // Time (most specific first)
    // =========================================================================
    { pattern: /_ns$/i, unit: 'nanoseconds' },
    { pattern: /\bnanoseconds?\b/i, unit: 'nanoseconds' },
    { pattern: /_us$/i, unit: 'microseconds' },
    { pattern: /_μs$/i, unit: 'microseconds' },
    { pattern: /\bmicroseconds?\b/i, unit: 'microseconds' },
    { pattern: /_ms$/i, unit: 'milliseconds' },
    { pattern: /\bmilliseconds?\b/i, unit: 'milliseconds' },
    { pattern: /(latency|lcp|fid|ttfb|fcp|inp|duration_ms|response_time_ms|load_time_ms|elapsed_ms)/i, unit: 'milliseconds' },
    { pattern: /_seconds$/i, unit: 'seconds' },
    { pattern: /\bseconds?\b/i, unit: 'seconds' },
    { pattern: /(time_on_site_seconds|duration_seconds|elapsed_seconds)/i, unit: 'seconds' },
    { pattern: /_minutes$/i, unit: 'minutes' },
    { pattern: /\bminutes?\b/i, unit: 'minutes' },
    { pattern: /(first_response_minutes|resolution_minutes|duration_minutes)/i, unit: 'minutes' },
    { pattern: /_hours$/i, unit: 'hours' },
    { pattern: /\bhours?\b/i, unit: 'hours' },
    { pattern: /_days$/i, unit: 'days' },
    { pattern: /\bdays?\b/i, unit: 'days' },
    { pattern: /account_age_days/i, unit: 'days' },
    { pattern: /days_since/i, unit: 'days' },
    { pattern: /_weeks$/i, unit: 'weeks' },
    { pattern: /_months$/i, unit: 'months' },
    { pattern: /_years$/i, unit: 'years' },

    // =========================================================================
    // Data sizes
    // =========================================================================
    { pattern: /_bytes$/i, unit: 'bytes' },
    { pattern: /(bytes?|size_bytes|payload_size|file_size)/i, unit: 'bytes' },
    { pattern: /_kb$/i, unit: 'kilobytes' },
    { pattern: /\bkilobytes?\b/i, unit: 'kilobytes' },
    { pattern: /_mb$/i, unit: 'megabytes' },
    { pattern: /\bmegabytes?\b/i, unit: 'megabytes' },
    { pattern: /_gb$/i, unit: 'gigabytes' },
    { pattern: /\bgigabytes?\b/i, unit: 'gigabytes' },
    { pattern: /_tb$/i, unit: 'terabytes' },
    { pattern: /\bterabytes?\b/i, unit: 'terabytes' },
    { pattern: /(tokens?)/i, unit: 'tokens' },
    { pattern: /(words?|word_count)/i, unit: 'words' },
    { pattern: /(characters?|char_count)/i, unit: 'characters' },

    // =========================================================================
    // Percentages and scales (ORDER MATTERS - most specific first!)
    // =========================================================================
    { pattern: /_pct$/i, unit: 'percent' },
    { pattern: /_percent$/i, unit: 'percent' },
    { pattern: /\bpercentile\b/i, unit: 'percent' },
    { pattern: /(^percent$|^pct$)/i, unit: 'percent' },
    { pattern: /(feature_adoption_pct|seats_used_pct|api_quota_used_pct)/i, unit: 'percent' },

    // Scale 0-1 (probabilities, ratios)
    { pattern: /(probability|scroll_depth|cls_score|adoption_pct|used_pct|quota_used|ratio|fraction)/i, unit: 'scale_0_1' },
    { pattern: /scroll_depth_avg/i, unit: 'scale_0_1' },

    // Scale 1-5 (satisfaction, CSAT)
    { pattern: /(satisfaction_score|csat)/i, unit: 'scale_1_5' },

    // Scale 0-10 (NPS) - BEFORE generic score patterns!
    { pattern: /nps.*score/i, unit: 'scale_0_10' },
    { pattern: /nps_response/i, unit: 'scale_0_10' },
    { pattern: /\bnps\b/i, unit: 'scale_0_10' },

    // Scale 0-100 (general scores, health scores)
    { pattern: /(health_score|engagement_score|churn_risk|quality_score)/i, unit: 'scale_0_100' },
    { pattern: /^(score|value)$/i, unit: 'scale_0_100' },

    // Scale 1-10 (importance, strength ratings)
    { pattern: /\bimportance\b/i, unit: 'scale_0_1' },

    // =========================================================================
    // Counts
    // =========================================================================
    { pattern: /(features_used|features_enabled|features_available)/i, unit: 'count' },
    { pattern: /(count|quantity|qty|instances?|page_views|clicks|unique_pages|login_count|total_tickets|open_tickets|exposure_count|retry_count|session_count|visit_count|error_count|failure_count|success_count)/i, unit: 'count' },

    // =========================================================================
    // Geographic
    // =========================================================================
    { pattern: /\b(latitude|lat)\b/i, unit: 'degrees' },
    { pattern: /\b(longitude|lng|lon)\b/i, unit: 'degrees' },
    { pattern: /\b(elevation|altitude)\b/i, unit: 'meters' },

    // =========================================================================
    // Physical units - Length
    // =========================================================================
    { pattern: /_km$/i, unit: 'kilometers' },
    { pattern: /\bkilometers?\b/i, unit: 'kilometers' },
    { pattern: /_m$/i, unit: 'meters' },
    { pattern: /\bmeters?\b/i, unit: 'meters' },
    { pattern: /_cm$/i, unit: 'centimeters' },
    { pattern: /\bcentimeters?\b/i, unit: 'centimeters' },
    { pattern: /_mm$/i, unit: 'millimeters' },
    { pattern: /\bmillimeters?\b/i, unit: 'millimeters' },
    { pattern: /\bmiles?\b/i, unit: 'miles' },
    { pattern: /\bfeet\b/i, unit: 'feet' },
    { pattern: /\binches?\b/i, unit: 'inches' },

    // =========================================================================
    // Physical units - Weight
    // =========================================================================
    { pattern: /_kg$/i, unit: 'kilograms' },
    { pattern: /\bkilograms?\b/i, unit: 'kilograms' },
    { pattern: /_g$/i, unit: 'grams' },
    { pattern: /\bgrams?\b/i, unit: 'grams' },
    { pattern: /_lbs$/i, unit: 'pounds' },
    { pattern: /\bpounds?\b/i, unit: 'pounds' },
    { pattern: /_oz$/i, unit: 'ounces' },
    { pattern: /\bounces?\b/i, unit: 'ounces' },

    // =========================================================================
    // Temperature
    // =========================================================================
    { pattern: /\bcelsius\b/i, unit: 'celsius' },
    { pattern: /\bfahrenheit\b/i, unit: 'fahrenheit' },
    { pattern: /\bkelvin\b/i, unit: 'kelvin' },

    // =========================================================================
    // Speed & throughput
    // =========================================================================
    { pattern: /\bkph\b/i, unit: 'km_per_hour' },
    { pattern: /\bmph\b/i, unit: 'miles_per_hour' },
    { pattern: /\brpm\b/i, unit: 'revolutions_per_minute' },
    { pattern: /\bbps\b/i, unit: 'bits_per_second' },
    { pattern: /\bkbps\b/i, unit: 'kilobits_per_second' },
    { pattern: /\bmbps\b/i, unit: 'megabits_per_second' },
    { pattern: /\bgbps\b/i, unit: 'gigabits_per_second' },
    { pattern: /\brps\b/i, unit: 'requests_per_second' },
    { pattern: /\bqps\b/i, unit: 'queries_per_second' },
    { pattern: /\btps\b/i, unit: 'transactions_per_second' },

    // =========================================================================
    // Angles
    // =========================================================================
    { pattern: /\bdegrees?\b/i, unit: 'degrees' },
    { pattern: /\bradians?\b/i, unit: 'radians' },

    // =========================================================================
    // Frequency
    // =========================================================================
    { pattern: /_hz$/i, unit: 'hertz' },
    { pattern: /\bhertz\b/i, unit: 'hertz' },
    { pattern: /\bkhz\b/i, unit: 'kilohertz' },
    { pattern: /\bmhz\b/i, unit: 'megahertz' },
    { pattern: /\bghz\b/i, unit: 'gigahertz' },

    // =========================================================================
    // Electrical
    // =========================================================================
    { pattern: /\bvolts?\b/i, unit: 'volts' },
    { pattern: /\bamps?\b/i, unit: 'amperes' },
    { pattern: /\bwatts?\b/i, unit: 'watts' },
    { pattern: /\bkilowatts?\b/i, unit: 'kilowatts' },
    { pattern: /_kwh$/i, unit: 'kilowatt_hours' },
    { pattern: /\bmah\b/i, unit: 'milliamp_hours' },

    // =========================================================================
    // Display
    // =========================================================================
    { pattern: /_px$/i, unit: 'pixels' },
    { pattern: /\bpixels?\b/i, unit: 'pixels' },
    { pattern: /\bdpi\b/i, unit: 'dots_per_inch' },
    { pattern: /\bppi\b/i, unit: 'pixels_per_inch' },

    // =========================================================================
    // Domain-specific
    // =========================================================================
    { pattern: /\bcalories\b/i, unit: 'calories' },
    { pattern: /\bsteps\b/i, unit: 'steps' },
    { pattern: /\bbpm\b/i, unit: 'beats_per_minute' },
    { pattern: /\bheartrate\b/i, unit: 'beats_per_minute' },
];

// ============================================================================
// Value Pattern Detection (runtime analysis)
// ============================================================================

import type { FieldType, FieldRole } from './types.js';

export interface ValuePattern {
    name: string;
    test: (samples: unknown[]) => boolean;
    type?: FieldType;
    format?: FieldFormat;
    role?: FieldRole;
}

export const VALUE_PATTERNS: ValuePattern[] = [
    // Unix timestamp (seconds since 1970) - years ~2001 to ~2033
    {
        name: 'timestamp_unix',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            return nums.every(n => Number.isInteger(n) && n > 1_000_000_000 && n < 2_000_000_000);
        },
        type: 'date',
        role: 'time',
    },
    // Unix timestamp (milliseconds)
    {
        name: 'timestamp_ms',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            return nums.every(n => Number.isInteger(n) && n > 1_000_000_000_000 && n < 2_000_000_000_000);
        },
        type: 'date',
        role: 'time',
    },
    // Boolean integers (0/1 only)
    {
        name: 'boolean_int',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3 to work with 2 samples
            const unique = new Set(nums);
            return unique.size <= 2 && nums.every(n => n === 0 || n === 1);
        },
        role: 'dimension',
    },
    // Boolean strings
    {
        name: 'boolean_string',
        test: (samples) => {
            const strs = samples.filter((s): s is string => typeof s === 'string');
            if (strs.length < 2) return false;  // Lowered from 3
            const boolValues = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '1', '0', 'on', 'off']);
            return strs.every(s => boolValues.has(s.toLowerCase()));
        },
        role: 'dimension',
    },
    // HTTP status codes (100-599)
    {
        name: 'http_status',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            return nums.every(n => Number.isInteger(n) && n >= 100 && n < 600);
        },
        role: 'dimension',
    },
    // Year values (1900-2100) - only if field name doesn't suggest measure
    {
        name: 'year',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            return nums.every(n => Number.isInteger(n) && n >= 1900 && n <= 2100);
        },
        role: 'time',
    },
    // Port numbers (1-65535)
    {
        name: 'port',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            return nums.every(n => Number.isInteger(n) && n >= 1 && n <= 65535);
        },
        role: 'dimension',
    },
    // Percentage values (0-100 or 0-1 with decimals)
    {
        name: 'percentage_0_100',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            return nums.every(n => n >= 0 && n <= 100);
        },
        role: 'measure',
    },
    // Probability values (0-1)
    {
        name: 'probability_0_1',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 2) return false;  // Lowered from 3
            // Must have decimals to distinguish from boolean
            const hasDecimals = nums.some(n => !Number.isInteger(n));
            return hasDecimals && nums.every(n => n >= 0 && n <= 1);
        },
        role: 'measure',
    },
];

// ============================================================================
// Dimension Patterns (for string fields that look like categories)
// ============================================================================

export const DIMENSION_PATTERNS: RegExp[] = [
    // Boolean flag patterns (FIRST - highest priority)
    /^is_[a-z_]+$/i,       // is_active, is_verified, is_deleted
    /^has_[a-z_]+$/i,      // has_permission, has_access
    /^can_[a-z_]+$/i,      // can_edit, can_delete
    /^should_[a-z_]+$/i,   // should_notify, should_sync
    /^allow_[a-z_]+$/i,    // allow_marketing, allow_notifications
    /^enabled?_/i,         // enabled, enable_feature
    /^disabled?_/i,        // disabled, disable_feature
    /^show_/i,             // show_toolbar
    /^hide_/i,             // hide_sidebar

    // Status & state
    /\bstatus\b/i,
    /\bstate\b/i,
    /\btype\b/i,
    /\bcategory\b/i,
    /\bkind\b/i,
    /\bmode\b/i,
    /\bvariant\b/i,
    /\bsegment\b/i,
    /\btier\b/i,
    /\bplan\b/i,
    /\blevel\b/i,
    /\bpriority\b/i,
    /\bseverity\b/i,
    /\btrend\b/i,
    /\bdirection\b/i,
    /\bcountry\b/i,
    /\bregion\b/i,
    /\bcity\b/i,
    /\bprovince\b/i,
    /\bcontinent\b/i,
    /\blanguage\b/i,
    /\blocale\b/i,
    /\bcurrency\b/i,
    /\btimezone\b/i,
    /\bgender\b/i,
    /\bplatform\b/i,
    /\bdevice\b/i,
    /\bbrowser\b/i,
    /\bos\b/i,
    /\bchannel\b/i,
    /\bsource\b/i,
    /\bmedium\b/i,
    /\bcampaign\b/i,
    /\breferrer\b/i,
    /\bmethod\b/i,
    /\bprotocol\b/i,
    /\bformat\b/i,
    /\bencoding\b/i,
    /\bscheme\b/i,
    /\bcolor\b/i,
    /\btheme\b/i,
    /\bsize\b/i,       // when string (S, M, L, XL)
    /\bunit\b/i,
    /\brole\b/i,
    /\bpermission\b/i,
    /\baccess\b/i,
    /\bscope\b/i,
    /\benvironment\b/i,
    /\benv\b/i,
    /\bstage\b/i,
    /\bphase\b/i,
    /\baction\b/i,
    /\boperation\b/i,
    /\bevent_type\b/i,
    /\bresult\b/i,
    /\boutcome\b/i,
    /\bverdict\b/i,
    /\bdecision\b/i,
    /\bflag\b/i,
    /\btag\b/i,
    /\blabel\b/i,
    /\bgroup\b/i,
    /\bcluster\b/i,
    /\bbucket\b/i,
    /\bbin\b/i,
    /\bcohort\b/i,
];

// ============================================================================
// Structure Building Settings (for structure.ts)
// ============================================================================

/** Minimum score for semantic pattern match to be accepted */
export const MIN_SEMANTIC_MATCH_SCORE = 2;

/** Score weight for each required field in pattern matching */
export const REQUIRED_FIELD_SCORE_WEIGHT = 2;

/** Penalty per extra field not in pattern */
export const EXTRA_FIELD_PENALTY = 0.5;

/** Minimum ratio of keys matching map patterns */
export const MAP_KEY_MATCH_RATIO = 0.8;

/** Minimum keys required for length variance check */
export const MIN_KEYS_FOR_VARIANCE_CHECK = 3;  // Changed from 5 to 3

/** Maximum key length variance for map detection */
export const MAX_KEY_LENGTH_VARIANCE = 4;

/** Minimum times a structure must be reused to create $def */
export const MIN_DEF_REUSE_COUNT = 2;

/** Minimum fields for single-use $def creation */
export const MIN_DEF_FIELD_COUNT = 3;

/** Data keys to schema keys ratio threshold for map detection */
export const MAP_KEY_RATIO_THRESHOLD = 1.5;

// ============================================================================
// Stats Inference Settings (for stats.ts)
// ============================================================================

/** Sample string truncation length for stats collection */
export const STATS_SAMPLE_TRUNCATE_LENGTH = 50;

/** Minimum sample size to use cardinality for role inference */
export const MIN_SAMPLES_FOR_CARDINALITY = 5;

/** Minimum samples to detect "all unique" pattern */
export const MIN_SAMPLES_FOR_UNIQUE = 3;

/** Cardinality threshold for "low cardinality" (enum-like) */
export const LOW_CARDINALITY_THRESHOLD = 10;

/** Cardinality threshold for "medium cardinality" */
export const MEDIUM_CARDINALITY_THRESHOLD = 20;

/** Sample size threshold for medium cardinality check */
export const MEDIUM_SAMPLE_SIZE_THRESHOLD = 50;

/** Average string length above which field is likely text */
export const TEXT_AVG_LENGTH_THRESHOLD = 80;

/** Max string length above which field is likely text */
export const TEXT_MAX_LENGTH_THRESHOLD = 200;

// ============================================================================
// AI Enrichment Settings (for enrich.ts)
// ============================================================================

/** Maximum retries for AI enrichment API calls */
export const AI_MAX_RETRIES = 3;

/** Base tokens for AI response */
export const AI_TOKEN_BASE = 768;

/** Additional tokens per pattern */
export const AI_TOKEN_PER_PATTERN = 40;

/** Maximum tokens cap */
export const AI_TOKEN_MAX = 8192;

/** Maximum sample value length before truncation */
export const SAMPLE_TRUNCATE_LENGTH = 60;

/** Maximum unique samples to collect per field */
export const MAX_SAMPLES_PER_FIELD = 5;

/** Role priority order for sorting patterns */
export const ROLE_PRIORITY_ORDER: string[] = [
    'identifier', 'measure', 'time', 'dimension', 'text', 'metadata'
];

/** Threshold for collapsing similar siblings (used in pattern extraction) */
export const PATTERN_COLLAPSE_THRESHOLD = 3;

// ============================================================================
// Entity Detection Patterns (for capabilities.ts)
// ============================================================================

/**
 * Patterns to extract entity name from ID field names.
 * Each pattern captures the entity name portion.
 *
 * @example
 * "customer_id" → captures "customer"
 * "userId" → captures "user"
 */
export const ENTITY_ID_EXTRACT_PATTERNS: RegExp[] = [
    /^(.+?)_id$/i,      // snake_case: customer_id, CUSTOMER_ID
    /^(.+?)-id$/i,      // kebab-case: customer-id
    /^(.+?)Id$/,        // camelCase: customerId
    /^(.+?)ID$/,        // mixed: customerID
];

/**
 * Pattern to detect if a field name looks like an ID field.
 */
export const ID_FIELD_DETECT_PATTERN = /(_id|Id|ID|-id)$/;

/**
 * Patterns to find name/label fields for entities.
 * Used in order - first match wins.
 *
 * Note: Entity-specific patterns (e.g., `${entity}_name`) are
 * generated dynamically in capabilities.ts and prepended to this list.
 */
export const ENTITY_NAME_FIELD_PATTERNS: string[] = [
    // Generic name patterns (entity-specific are added dynamically)
    'name',
    'title',
    'label',
    'display_name',
    'displayName',
    'display-name',
    'full_name',
    'fullName',
    'full-name',
    'username',
    'user_name',
    'firstName',
    'first_name',
    'org_name',
    'company_name',
    'companyName',
    'email',                        // fallback display identifier
];

/**
 * Minimum entity name length to avoid false positives.
 * Prevents matching things like "x_id" or "a_id".
 */
export const MIN_ENTITY_NAME_LENGTH = 2;

// ============================================================================
// Structure Patterns (for structure.ts - $def naming & map detection)
// ============================================================================

/**
 * Semantic patterns for $def naming.
 * When a group of fields matches these patterns, use the suggested name.
 * Order matters - more specific patterns first.
 */
export interface SemanticDefPattern {
    name: string;
    description: string;
    requiredFields: string[];      // ALL of these must be present
    optionalFields?: string[];     // Any of these boost confidence
    excludeFields?: string[];      // If ANY present, don't match
}

export const SEMANTIC_DEF_PATTERNS: SemanticDefPattern[] = [
    // =========================================================================
    // Location & Geography
    // =========================================================================
    {
        name: 'geo_coordinates',
        description: 'Geographic coordinates',
        requiredFields: ['latitude', 'longitude'],
        optionalFields: ['altitude', 'elevation', 'accuracy', 'heading', 'speed'],
    },
    {
        name: 'geo_coordinates',
        description: 'Geographic coordinates (short form)',
        requiredFields: ['lat', 'lng'],
        optionalFields: ['alt', 'accuracy', 'heading', 'speed'],
    },
    {
        name: 'geo_coordinates',
        description: 'Geographic coordinates (alternate)',
        requiredFields: ['lat', 'lon'],
        optionalFields: ['alt', 'accuracy'],
    },
    {
        name: 'address',
        description: 'Physical address',
        requiredFields: ['street', 'city'],
        optionalFields: ['state', 'province', 'zip', 'postal_code', 'country', 'country_code', 'line1', 'line2'],
    },
    {
        name: 'location',
        description: 'Location information',
        requiredFields: ['city', 'country'],
        optionalFields: ['region', 'state', 'province', 'timezone', 'postal_code'],
    },

    // =========================================================================
    // Time & Date Ranges
    // =========================================================================
    {
        name: 'time_range',
        description: 'Time period with start and end',
        requiredFields: ['start', 'end'],
        optionalFields: ['duration', 'timezone'],
    },
    {
        name: 'date_range',
        description: 'Date period',
        requiredFields: ['start_date', 'end_date'],
        optionalFields: ['duration_days', 'business_days'],
    },
    {
        name: 'datetime_range',
        description: 'Datetime period',
        requiredFields: ['start_at', 'end_at'],
        optionalFields: ['duration', 'duration_seconds'],
    },
    {
        name: 'validity_period',
        description: 'Validity window',
        requiredFields: ['valid_from', 'valid_until'],
        optionalFields: ['timezone'],
    },
    {
        name: 'billing_period',
        description: 'Billing cycle period',
        requiredFields: ['period_start', 'period_end'],
        optionalFields: ['billing_cycle', 'invoice_date'],
    },
    {
        name: 'timestamps',
        description: 'Record timestamps',
        requiredFields: ['created_at', 'updated_at'],
        optionalFields: ['deleted_at', 'archived_at'],
    },
    {
        name: 'audit_timestamps',
        description: 'Audit trail timestamps',
        requiredFields: ['created', 'modified'],
        optionalFields: ['deleted', 'created_by', 'modified_by'],
    },

    // =========================================================================
    // Dimensions & Measurements
    // =========================================================================
    {
        name: 'dimensions_2d',
        description: '2D dimensions',
        requiredFields: ['width', 'height'],
        optionalFields: ['unit', 'aspect_ratio'],
    },
    {
        name: 'dimensions_3d',
        description: '3D dimensions',
        requiredFields: ['width', 'height', 'depth'],
        optionalFields: ['unit', 'volume', 'weight'],
    },
    {
        name: 'bounding_box',
        description: 'Bounding box coordinates',
        requiredFields: ['x', 'y', 'width', 'height'],
        optionalFields: ['z', 'depth'],
    },
    {
        name: 'size',
        description: 'Size specification',
        requiredFields: ['width', 'height'],
        optionalFields: ['length', 'depth', 'unit'],
    },
    {
        name: 'resolution',
        description: 'Display resolution',
        requiredFields: ['width', 'height'],
        optionalFields: ['dpi', 'ppi', 'pixel_ratio', 'density'],
    },

    // =========================================================================
    // Statistics & Ranges
    // =========================================================================
    {
        name: 'statistics',
        description: 'Statistical summary',
        requiredFields: ['min', 'max', 'avg'],
        optionalFields: ['sum', 'count', 'median', 'std_dev', 'variance', 'percentile'],
    },
    {
        name: 'range',
        description: 'Numeric range',
        requiredFields: ['min', 'max'],
        optionalFields: ['step', 'default', 'unit'],
        excludeFields: ['avg', 'sum', 'count'],  // That's statistics, not range
    },
    {
        name: 'percentiles',
        description: 'Percentile distribution',
        requiredFields: ['p50', 'p95'],
        optionalFields: ['p25', 'p75', 'p90', 'p99', 'p999'],
    },
    {
        name: 'histogram_bucket',
        description: 'Histogram bucket',
        requiredFields: ['lower', 'upper', 'count'],
        optionalFields: ['frequency', 'cumulative'],
    },

    // =========================================================================
    // Scores & Ratings
    // =========================================================================
    {
        name: 'scored_metric',
        description: 'Score with confidence',
        requiredFields: ['score', 'confidence'],
        optionalFields: ['weight', 'normalized', 'raw'],
    },
    {
        name: 'rating',
        description: 'Rating with optional count',
        requiredFields: ['rating', 'count'],
        optionalFields: ['average', 'distribution', 'total'],
    },
    {
        name: 'weighted_score',
        description: 'Weighted scoring',
        requiredFields: ['score', 'weight'],
        optionalFields: ['weighted_score', 'normalized'],
    },
    {
        name: 'prediction',
        description: 'ML prediction result',
        requiredFields: ['prediction', 'probability'],
        optionalFields: ['confidence', 'confidence_interval', 'model_id', 'features'],
    },
    {
        name: 'classification',
        description: 'Classification result',
        requiredFields: ['label', 'confidence'],
        optionalFields: ['probability', 'scores', 'alternatives'],
    },
    {
        name: 'trending_metric',
        description: 'Metric with trend indicator',
        requiredFields: ['value', 'trend'],
        optionalFields: ['percentile', 'change', 'previous'],
    },
    {
        name: 'percentile_metric',
        description: 'Value with percentile ranking',
        requiredFields: ['value', 'percentile'],
        optionalFields: ['trend', 'rank', 'total'],
    },

    // =========================================================================
    // Identity & References
    // =========================================================================
    {
        name: 'named_entity',
        description: 'Entity with ID and name',
        requiredFields: ['id', 'name'],
        optionalFields: ['description', 'slug', 'code', 'label'],
    },
    {
        name: 'entity_reference',
        description: 'Reference to another entity',
        requiredFields: ['id', 'type'],
        optionalFields: ['name', 'url', 'href'],
    },
    {
        name: 'user_reference',
        description: 'User reference',
        requiredFields: ['user_id'],
        optionalFields: ['username', 'email', 'name', 'avatar', 'avatar_url'],
    },
    {
        name: 'link',
        description: 'Hyperlink',
        requiredFields: ['url'],
        optionalFields: ['title', 'description', 'thumbnail', 'favicon'],
    },
    {
        name: 'resource_link',
        description: 'Resource with URL and metadata',
        requiredFields: ['href', 'rel'],
        optionalFields: ['type', 'title', 'method'],
    },

    // =========================================================================
    // Money & Currency
    // =========================================================================
    {
        name: 'money',
        description: 'Monetary amount with currency',
        requiredFields: ['amount', 'currency'],
        optionalFields: ['formatted', 'symbol', 'exchange_rate'],
    },
    {
        name: 'price',
        description: 'Price information',
        requiredFields: ['amount'],
        optionalFields: ['currency', 'unit', 'formatted', 'original', 'discount'],
    },
    {
        name: 'price_range',
        description: 'Price range',
        requiredFields: ['min_price', 'max_price'],
        optionalFields: ['currency', 'avg_price'],
    },
    {
        name: 'discount',
        description: 'Discount specification',
        requiredFields: ['value', 'type'],
        optionalFields: ['code', 'amount', 'percent', 'expires_at'],
    },

    // =========================================================================
    // Pagination & Lists
    // =========================================================================
    {
        name: 'pagination',
        description: 'Pagination metadata',
        requiredFields: ['page', 'total'],
        optionalFields: ['per_page', 'page_size', 'total_pages', 'has_more', 'next', 'prev'],
    },
    {
        name: 'cursor_pagination',
        description: 'Cursor-based pagination',
        requiredFields: ['cursor'],
        optionalFields: ['has_more', 'next_cursor', 'prev_cursor', 'limit'],
    },
    {
        name: 'offset_pagination',
        description: 'Offset-based pagination',
        requiredFields: ['offset', 'limit'],
        optionalFields: ['total', 'has_more'],
    },

    // =========================================================================
    // Files & Media
    // =========================================================================
    {
        name: 'file_metadata',
        description: 'File information',
        requiredFields: ['filename', 'size'],
        optionalFields: ['mime_type', 'content_type', 'extension', 'url', 'path', 'hash', 'checksum'],
    },
    {
        name: 'image',
        description: 'Image information',
        requiredFields: ['url', 'width', 'height'],
        optionalFields: ['alt', 'title', 'format', 'size', 'thumbnail'],
    },
    {
        name: 'media',
        description: 'Media file',
        requiredFields: ['url', 'type'],
        optionalFields: ['duration', 'size', 'format', 'thumbnail', 'width', 'height'],
    },
    {
        name: 'attachment',
        description: 'File attachment',
        requiredFields: ['name', 'url'],
        optionalFields: ['size', 'type', 'mime_type', 'created_at'],
    },

    // =========================================================================
    // Contact & Communication
    // =========================================================================
    {
        name: 'contact',
        description: 'Contact information',
        requiredFields: ['email'],
        optionalFields: ['phone', 'name', 'company', 'title', 'address'],
    },
    {
        name: 'phone',
        description: 'Phone number',
        requiredFields: ['number'],
        optionalFields: ['type', 'country_code', 'extension', 'formatted'],
    },
    {
        name: 'email_address',
        description: 'Email with metadata',
        requiredFields: ['email'],
        optionalFields: ['verified', 'primary', 'type', 'label'],
    },

    // =========================================================================
    // Errors & Results
    // =========================================================================
    {
        name: 'error',
        description: 'Error information',
        requiredFields: ['code', 'message'],
        optionalFields: ['details', 'field', 'path', 'stack', 'timestamp'],
    },
    {
        name: 'validation_error',
        description: 'Validation error',
        requiredFields: ['field', 'message'],
        optionalFields: ['code', 'value', 'constraint'],
    },
    {
        name: 'result',
        description: 'Operation result',
        requiredFields: ['success'],
        optionalFields: ['data', 'error', 'message', 'code'],
    },
    {
        name: 'api_response',
        description: 'API response wrapper',
        requiredFields: ['status'],
        optionalFields: ['data', 'error', 'message', 'meta', 'pagination'],
    },

    // =========================================================================
    // Versioning & History
    // =========================================================================
    {
        name: 'version_info',
        description: 'Version information',
        requiredFields: ['version'],
        optionalFields: ['major', 'minor', 'patch', 'build', 'commit', 'date'],
    },
    {
        name: 'change_record',
        description: 'Change/diff record',
        requiredFields: ['field', 'old_value', 'new_value'],
        optionalFields: ['changed_at', 'changed_by', 'operation'],
    },
    {
        name: 'audit_entry',
        description: 'Audit log entry',
        requiredFields: ['action', 'timestamp'],
        optionalFields: ['actor', 'actor_id', 'resource', 'resource_id', 'changes', 'ip_address'],
    },

    // =========================================================================
    // Events & Actions
    // =========================================================================
    {
        name: 'event',
        description: 'Event record',
        requiredFields: ['event_type', 'timestamp'],
        optionalFields: ['event_id', 'source', 'data', 'metadata', 'user_id'],
    },
    {
        name: 'action',
        description: 'User action',
        requiredFields: ['action', 'target'],
        optionalFields: ['actor', 'timestamp', 'result', 'metadata'],
    },
    {
        name: 'webhook_payload',
        description: 'Webhook event payload',
        requiredFields: ['event', 'data'],
        optionalFields: ['timestamp', 'signature', 'id', 'version'],
    },

    // =========================================================================
    // Scheduling & Calendar
    // =========================================================================
    {
        name: 'schedule',
        description: 'Schedule entry',
        requiredFields: ['start_time', 'end_time'],
        optionalFields: ['title', 'description', 'location', 'recurrence', 'timezone'],
    },
    {
        name: 'recurrence',
        description: 'Recurrence pattern',
        requiredFields: ['frequency'],
        optionalFields: ['interval', 'until', 'count', 'days', 'exceptions'],
    },
    {
        name: 'availability',
        description: 'Availability slot',
        requiredFields: ['available', 'start', 'end'],
        optionalFields: ['timezone', 'capacity'],
    },

    // =========================================================================
    // E-commerce & Orders
    // =========================================================================
    {
        name: 'line_item',
        description: 'Order line item',
        requiredFields: ['quantity', 'price'],
        optionalFields: ['product_id', 'sku', 'name', 'unit_price', 'total', 'discount'],
    },
    {
        name: 'cart_item',
        description: 'Shopping cart item',
        requiredFields: ['product_id', 'quantity'],
        optionalFields: ['price', 'name', 'sku', 'variant_id', 'options'],
    },
    {
        name: 'shipping_info',
        description: 'Shipping information',
        requiredFields: ['method', 'cost'],
        optionalFields: ['carrier', 'tracking_number', 'estimated_delivery', 'address'],
    },

    // =========================================================================
    // Social & User Generated
    // =========================================================================
    {
        name: 'social_counts',
        description: 'Social engagement counts',
        requiredFields: ['likes', 'comments'],
        optionalFields: ['shares', 'views', 'reactions', 'saves', 'reposts'],
    },
    {
        name: 'author',
        description: 'Content author',
        requiredFields: ['name'],
        optionalFields: ['id', 'avatar', 'url', 'email', 'bio'],
    },
    {
        name: 'comment',
        description: 'User comment',
        requiredFields: ['text', 'author'],
        optionalFields: ['id', 'created_at', 'updated_at', 'parent_id', 'likes'],
    },

    // =========================================================================
    // Localization
    // =========================================================================
    {
        name: 'translated_text',
        description: 'Localized text',
        requiredFields: ['text', 'locale'],
        optionalFields: ['language', 'region', 'direction'],
    },
    {
        name: 'locale_info',
        description: 'Locale information',
        requiredFields: ['language'],
        optionalFields: ['country', 'region', 'timezone', 'currency', 'date_format'],
    },

    // =========================================================================
    // Integration & Webhook Config
    // =========================================================================
    {
        name: 'integration_config',
        description: 'Third-party integration configuration',
        requiredFields: ['enabled'],
        optionalFields: ['webhook_url', 'api_key', 'token', 'settings', 'connected_at'],
    },
];

/**
 * Role-based default names for $defs when no semantic pattern matches.
 */
export const ROLE_DEF_NAMES: Record<string, string> = {
    measure: 'metrics',
    dimension: 'attributes',
    identifier: 'identifiers',
    time: 'timestamps',
    text: 'content',
    metadata: 'metadata',
};

/**
 * Field name patterns that indicate an ID field.
 */
export const ID_FIELD_PATTERNS: string[] = [
    'id', '_id', 'uuid', 'guid', 'key', 'pk',
    'identifier', 'ref', 'reference',
];

/**
 * Field name patterns that indicate a name/label field.
 */
export const NAME_FIELD_PATTERNS: string[] = [
    'name', 'title', 'label', 'display_name',
    'display', 'text', 'description', 'caption',
    'heading', 'subject', 'summary',
];

/**
 * Patterns for detecting map-like structures (dynamic keys).
 * If an object's keys match these patterns, it's likely a map.
 */
export const MAP_KEY_PATTERNS: RegExp[] = [
    // Locale codes: en, en_US, en-US
    /^[a-z]{2}(_[A-Z]{2})?$/,
    /^[a-z]{2}-[A-Z]{2}$/,

    // Date strings: 2024-01-15, 2024/01/15
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{4}\/\d{2}\/\d{2}$/,

    // UUIDs
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,

    // Numeric IDs
    /^\d+$/,

    // Short hashes
    /^[a-f0-9]{6,12}$/i,

    // Slugs: my-slug-here
    /^[a-z0-9]+(-[a-z0-9]+)+$/,

    // Snake case identifiers: my_key_here
    /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/,

    // Email-like keys
    /^[^@]+@[^@]+\.[^@]+$/,

    // IP addresses
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,

    // Semantic versioning: 1.0.0, v1.2.3
    /^v?\d+\.\d+\.\d+$/,
];

/**
 * Minimum number of keys with same structure to consider it a map.
 */
export const MAP_DETECTION_THRESHOLD = 3;

/**
 * Names that suggest an object is NOT a map (even with many keys).
 */
export const NON_MAP_OBJECT_NAMES: string[] = [
    'settings', 'config', 'configuration', 'options', 'preferences',
    'properties', 'attributes', 'metadata', 'meta', 'data',
    'params', 'parameters', 'args', 'arguments',
    'headers', 'cookies', 'query', 'body',
    'request', 'response', 'result', 'error',
    'user', 'account', 'profile', 'session',
    'item', 'entity', 'record', 'document',
    'stats', 'statistics', 'metrics', 'counters',
    'flags', 'features', 'toggles', 'switches',
];

// ============================================================================
// Heuristic Patterns (Simple String Matching for enrich.ts)
// ============================================================================
// These are used as fallback corrections in the AI enrichment layer.
// They use simple string includes() matching for speed and simplicity.

/**
 * Patterns indicating a numeric field should be a MEASURE.
 * Used when stats.ts role inference was wrong.
 */
export const HEURISTIC_MEASURE_PATTERNS: string[] = [
    // Scores & ratings
    'score', 'rating', 'rank', 'grade', 'level', 'tier',
    'points', 'stars', 'votes',

    // Weights & importance
    'strength', 'intensity', 'severity', 'importance',
    'confidence', 'probability', 'likelihood', 'certainty',
    'weight', 'priority', 'urgency',

    // Statistics
    'percentile', 'quartile', 'median', 'mean', 'average',
    'variance', 'deviation', 'correlation',

    // Dimensions & measurements
    'depth', 'distance', 'height', 'width', 'length',
    'size', 'area', 'volume', 'radius', 'diameter',
    'latitude', 'longitude', 'lat', 'lng', 'elevation', 'altitude',

    // Counts & quantities
    'count', 'total', 'sum', 'amount', 'quantity', 'qty',
    'number', 'num', 'instances', 'occurrences',

    // Financial
    'price', 'cost', 'fee', 'tax', 'revenue', 'profit',
    'margin', 'balance', 'budget', 'spend', 'earnings',
    'salary', 'wage', 'commission', 'discount', 'rebate',
    'mrr', 'arr', 'ltv', 'cac', 'arpu', 'aov', 'gmv',

    // Time durations
    'duration', 'latency', 'elapsed', 'timeout', 'interval',
    'uptime', 'downtime', 'ttl', 'age',

    // Rates & ratios
    'rate', 'ratio', 'percent', 'pct', 'fraction', 'share',
    'frequency', 'velocity', 'speed', 'throughput', 'bandwidth',

    // Computing
    'memory', 'cpu', 'gpu', 'disk', 'storage', 'cache',
    'load', 'utilization', 'capacity', 'usage',
    'bytes', 'tokens', 'characters', 'words', 'lines', 'pages',

    // Engagement metrics
    'views', 'clicks', 'impressions', 'visits', 'sessions',
    'conversion', 'retention', 'churn', 'bounce', 'engagement',
    'adoption', 'penetration', 'coverage', 'reach',

    // Web vitals
    'lcp', 'fid', 'cls', 'ttfb', 'fcp', 'inp',

    // ML/AI
    'loss', 'accuracy', 'precision', 'recall', 'f1',
    'auc', 'mae', 'mse', 'rmse', 'r2',
    'entropy', 'perplexity', 'gradient',

    // Generic value indicators
    'value', 'measure', 'metric', 'index', 'factor',
    'coefficient', 'multiplier', 'delta', 'diff',
];

/**
 * Patterns indicating a measure should use AVG aggregation.
 */
export const HEURISTIC_AVG_PATTERNS: string[] = [
    // Scores & ratings (always avg)
    'score', 'rating', 'rank', 'grade',
    'strength', 'intensity', 'severity', 'importance',
    'confidence', 'probability', 'likelihood',
    'quality', 'satisfaction', 'happiness', 'sentiment',
    'nps', 'csat', 'ces',

    // Percentages & ratios
    'percent', 'pct', 'ratio', 'rate', 'fraction',
    'percentile', 'quartile',

    // Durations (avg makes sense)
    'duration', 'latency', 'elapsed', 'time',
    '_ms', '_seconds', '_minutes', '_hours',
    'response_time', 'load_time', 'wait_time',

    // Web vitals
    'lcp', 'fid', 'cls', 'ttfb', 'fcp', 'inp',

    // Per-unit metrics
    'per_user', 'per_customer', 'per_session', 'per_visit',
    'per_page', 'per_order', 'per_day', 'per_week', 'per_month',
    'arpu', 'aov', 'ltv',

    // Normalized values
    'normalized', 'scaled', 'weighted', 'adjusted', 'relative',
    'avg', 'average', 'mean', 'median',

    // Indices & factors
    'index', 'factor', 'coefficient', 'multiplier',

    // Depth & utilization
    'depth', 'scroll_depth', 'adoption', 'utilization',
    'occupancy', 'efficiency', 'productivity',

    // Device specs (when aggregating)
    'pixel_ratio', 'density',

    // ML predictions
    'prediction', 'forecast', 'estimate', 'projection',

    // Score-nested values (context-aware)
    'value',  // When inside a score context, should avg
];

/**
 * Patterns indicating a measure should NOT aggregate (none).
 */
export const HEURISTIC_NONE_PATTERNS: string[] = [
    // Limits & configuration
    'max_', 'min_', 'limit', 'quota', 'cap',
    'ceiling', 'floor', 'threshold', 'boundary',

    // Versions & identifiers
    'version', 'schema_version', 'revision', 'build',
    'generation', 'iteration', 'epoch', 'step',

    // Device/screen specs
    'screen_width', 'screen_height', 'pixel_ratio',
    'resolution', 'aspect_ratio', 'dpi', 'ppi',

    // Technical specs
    'bitrate', 'sample_rate', 'frame_rate', 'fps',
    'channels', 'frequency',

    // Coordinates (don't aggregate)
    'latitude', 'longitude', 'lat', 'lng', 'lon',
    'x_coord', 'y_coord', 'z_coord',
    'x_position', 'y_position', 'z_position',

    // Configuration values
    'config', 'setting', 'option', 'preference',
    'default', 'initial', 'base', 'fallback',

    // Port/network identifiers
    'port', 'pin', 'socket',

    // Status codes (numeric but categorical)
    'status_code', 'error_code', 'exit_code',
    'return_code', 'http_code', 'response_code',

    // Feature counts (static per record)
    'features_used', 'features_enabled', 'features_available',

    // Age/time units (don't sum ages)
    'age', 'year', 'month', 'day', 'hour', 'week', 'quarter',
    'birth_year', 'fiscal_year',

    // Reference values
    'baseline', 'benchmark', 'target', 'goal',

    // Conversion values (binary 0/1, don't sum)
    'conversion_value',

    // Account metrics (don't sum)
    'account_age',
    'days_since',
];

/**
 * Patterns indicating a string field should be TEXT (long-form content).
 */
export const HEURISTIC_TEXT_PATTERNS: string[] = [
    // Core content types
    'description', 'text', 'content', 'body',
    'message', 'comment', 'note', 'notes',

    // Long-form content
    'summary', 'abstract', 'excerpt', 'snippet',
    'preview', 'teaser', 'intro', 'outro',
    'article', 'post', 'blog', 'story', 'narrative',

    // Titles & subjects (can be long)
    'subject', 'title', 'headline', 'heading',
    'subheading', 'caption', 'alt_text',

    // Communication
    'feedback', 'response', 'reply', 'answer',
    'question', 'query', 'prompt', 'instruction',
    'greeting', 'salutation', 'signature',

    // Reviews & opinions
    'review', 'testimonial', 'recommendation',
    'complaint', 'suggestion', 'opinion',
    'thoughts', 'insights', 'observation',
    'findings', 'conclusion', 'verdict',

    // Analysis & reasoning
    'reason', 'explanation', 'justification',
    'rationale', 'analysis', 'assessment',
    'evaluation', 'impact', 'implication',

    // Technical
    'log', 'error_message', 'warning', 'exception',
    'stack_trace', 'traceback', 'debug',
    'changelog', 'release_notes', 'readme',

    // User agent & technical strings
    'user_agent', 'useragent', 'referer', 'referrer',

    // Documents
    'transcript', 'translation', 'subtitle',
    'script', 'dialogue', 'lyrics',

    // Bio & profiles
    'bio', 'about', 'profile', 'introduction',

    // Addresses
    'address', 'street_address', 'full_address',
    'directions', 'location_description',

    // Legal
    'disclaimer', 'terms', 'policy', 'agreement',
    'contract', 'legal', 'copyright', 'license',

    // Compound patterns
    'long_term', 'cumulative', 'overall_assessment',
    'psychological_impact', 'distinguishing',
    'full_text', 'raw_text', 'plain_text',
];

/**
 * Patterns indicating a string field should be TIME.
 */
export const HEURISTIC_TIME_PATTERNS: string[] = [
    // Suffix patterns
    '_at', '_on', '_date', '_time', '_datetime', '_ts', '_timestamp',
    'period_start', 'period_end',  // Added for current_period_start/end

    // Core time words
    'timestamp', 'datetime', 'datestamp',

    // Lifecycle - creation
    'created', 'inserted', 'added', 'registered',
    'born', 'started', 'initiated', 'opened',

    // Lifecycle - modification
    'updated', 'modified', 'changed', 'edited',
    'revised', 'amended', 'refreshed', 'synced',

    // Lifecycle - deletion
    'deleted', 'removed', 'archived', 'purged',
    'trashed', 'destroyed',

    // Lifecycle - completion
    'completed', 'finished', 'ended', 'closed',
    'resolved', 'fulfilled', 'done',

    // Status changes
    'activated', 'deactivated', 'suspended', 'paused',
    'resumed', 'restarted', 'stopped',
    'enabled', 'disabled', 'locked', 'unlocked',
    'verified', 'confirmed', 'approved', 'rejected',
    'cancelled', 'canceled', 'revoked',

    // Communication events
    'sent', 'delivered', 'received', 'read',
    'opened', 'clicked', 'viewed', 'accessed',
    'submitted', 'posted', 'published', 'drafted',

    // Financial events
    'paid', 'billed', 'charged', 'invoiced',
    'refunded', 'credited', 'debited',
    'issued', 'expired', 'renewed',

    // Shipping/fulfillment
    'shipped', 'dispatched', 'delivered',
    'returned', 'received', 'picked_up',

    // Support/workflow
    'assigned', 'escalated', 'claimed',
    'acknowledged', 'responded',

    // System events
    'logged', 'signed', 'authenticated',
    'deployed', 'released', 'launched',
    'migrated', 'imported', 'exported',
    'computed', 'calculated', 'processed',
    'indexed', 'cached', 'invalidated',
    'backed_up', 'restored',

    // Scheduling
    'scheduled', 'due', 'deadline',
    'effective', 'valid_from', 'valid_until',
    'begins', 'ends', 'starts', 'finishes',
];

/**
 * Patterns indicating a string field should be DIMENSION (categorical).
 */
export const HEURISTIC_DIMENSION_PATTERNS: string[] = [
    // Boolean flags (highest priority)
    'is_', 'has_', 'can_', 'should_', 'allow_',
    'enabled', 'disabled', 'active', 'inactive',

    // Status & state
    'status', 'state', 'phase', 'stage', 'step',
    'condition', 'health', 'lifecycle',

    // Type & category
    'type', 'category', 'kind', 'class', 'group',
    'classification', 'taxonomy', 'genre', 'species',

    // Mode & variant
    'mode', 'variant', 'version', 'edition', 'flavor',
    'style', 'theme', 'template', 'layout',

    // Segmentation
    'segment', 'cohort', 'cluster', 'bucket', 'bin',
    'tier', 'level', 'grade', 'rank',
    'plan', 'subscription', 'package', 'bundle',

    // Priority & severity
    'priority', 'severity', 'urgency', 'importance',
    'criticality', 'impact',

    // Direction & trend
    'trend', 'direction', 'movement', 'change',
    'growth', 'decline',

    // Geography
    'country', 'region', 'state', 'province',
    'city', 'district', 'zone', 'area',
    'continent', 'territory', 'market',

    // Locale
    'language', 'locale', 'timezone', 'currency',

    // Demographics
    'gender', 'sex', 'age_group', 'generation',
    'income_bracket', 'education_level',

    // Device & platform
    'platform', 'device', 'device_type',
    'browser', 'os', 'operating_system',
    'app', 'client', 'agent',

    // Marketing
    'channel', 'source', 'medium', 'campaign',
    'referrer', 'affiliate', 'partner',

    // Technical
    'method', 'protocol', 'format', 'encoding',
    'scheme', 'algorithm', 'cipher',
    'environment', 'env', 'stage', 'deployment',

    // Visual
    'color', 'colour', 'background', 'foreground',
    'font', 'size', 'alignment',

    // Access & permissions
    'role', 'permission', 'access', 'scope',
    'visibility', 'privacy', 'sharing',

    // Events & actions
    'action', 'operation', 'event_type', 'activity',
    'trigger', 'reason', 'cause',

    // Outcome
    'result', 'outcome', 'verdict', 'decision',
    'resolution', 'disposition',

    // Labels & tags
    'flag', 'tag', 'label', 'badge', 'marker',
    'indicator', 'signal',
];

/**
 * Unit detection patterns for heuristic corrections.
 * Maps field name substrings to their units.
 * Order matters - more specific patterns first.
 */
export const HEURISTIC_UNIT_MAP: Array<{ patterns: string[]; unit: string }> = [
    { patterns: ['ltv_estimate_usd', 'ltv_usd'], unit: 'usd' },
    { patterns: ['time_on_site_seconds'], unit: 'seconds' },
    { patterns: ['days_since'], unit: 'days' },
    // Feature counts (FIRST - very specific)
    { patterns: ['features_used', 'features_enabled', 'features_available'], unit: 'count' },

    // Time - most specific first
    { patterns: ['_ns', 'nanosecond'], unit: 'nanoseconds' },
    { patterns: ['_us', '_μs', 'microsecond'], unit: 'microseconds' },
    { patterns: ['_ms', 'millisecond', 'latency', 'lcp', 'fid', 'ttfb', 'fcp', 'inp', 'response_time', 'load_time'], unit: 'milliseconds' },
    { patterns: ['_seconds', 'duration_seconds', 'elapsed_seconds', 'time_seconds', 'time_on_site_seconds'], unit: 'seconds' },
    { patterns: ['_minutes', 'duration_minutes', 'response_minutes', 'resolution_minutes', 'first_response_minutes'], unit: 'minutes' },
    { patterns: ['_hours', 'duration_hours'], unit: 'hours' },
    { patterns: ['_days', 'age_days', 'days_since', 'account_age_days'], unit: 'days' },

    // Currency
    { patterns: ['_usd', 'price', 'cost', 'revenue', 'profit', 'amount', 'fee', 'tax', 'mrr', 'arr', 'ltv', 'cac', 'aov', 'gmv', 'salary', 'wage', 'budget', 'spend', 'balance', 'earnings'], unit: 'usd' },
    { patterns: ['_eur'], unit: 'eur' },
    { patterns: ['_gbp'], unit: 'gbp' },
    { patterns: ['_cad'], unit: 'cad' },
    { patterns: ['_jpy'], unit: 'jpy' },
    { patterns: ['cents', 'pennies'], unit: 'cents' },

    // Data sizes
    { patterns: ['_bytes', 'bytes', 'size_bytes', 'file_size', 'payload_size'], unit: 'bytes' },
    { patterns: ['_kb', 'kilobytes'], unit: 'kilobytes' },
    { patterns: ['_mb', 'megabytes'], unit: 'megabytes' },
    { patterns: ['_gb', 'gigabytes'], unit: 'gigabytes' },
    { patterns: ['_tb', 'terabytes'], unit: 'terabytes' },
    { patterns: ['tokens', 'token_count'], unit: 'tokens' },
    { patterns: ['words', 'word_count'], unit: 'words' },
    { patterns: ['characters', 'char_count'], unit: 'characters' },

    // Scales - most specific first!
    { patterns: ['satisfaction_score', 'csat', 'rating_1_5'], unit: 'scale_1_5' },
    { patterns: ['nps', 'nps_score', 'nps_rating', 'rating_0_10', 'scale_0_10'], unit: 'scale_0_10' },
    { patterns: ['probability', 'scroll_depth', 'cls_score', 'adoption_pct', 'used_pct', 'quota_used', '_0_1'], unit: 'scale_0_1' },
    { patterns: ['health_score', 'engagement_score', 'quality_score', 'churn_risk', '_0_100'], unit: 'scale_0_100' },
    { patterns: ['importance', '_1_10'], unit: 'scale_0_1' },

    // Percentages
    { patterns: ['_pct', '_percent', 'percent', 'percentage', 'feature_adoption_pct', 'seats_used_pct', 'api_quota_used_pct'], unit: 'percent' },

    // Counts
    { patterns: ['count', 'quantity', 'qty', 'total_', 'num_', '_count', 'views', 'clicks', 'impressions', 'visits', 'sessions', 'instances', 'occurrences', 'page_views', 'unique_pages', 'login_count', 'total_tickets', 'open_tickets', 'exposure_count', 'retry_count'], unit: 'count' },

    // Geographic
    { patterns: ['latitude', 'lat'], unit: 'degrees_latitude' },
    { patterns: ['longitude', 'lng', 'lon'], unit: 'degrees_longitude' },
    { patterns: ['elevation', 'altitude'], unit: 'meters' },

    // Physical - length
    { patterns: ['_km', 'kilometers'], unit: 'kilometers' },
    { patterns: ['_m', 'meters'], unit: 'meters' },
    { patterns: ['_cm', 'centimeters'], unit: 'centimeters' },
    { patterns: ['_mm', 'millimeters'], unit: 'millimeters' },
    { patterns: ['miles'], unit: 'miles' },
    { patterns: ['feet', '_ft'], unit: 'feet' },
    { patterns: ['inches', '_in'], unit: 'inches' },

    // Physical - weight
    { patterns: ['_kg', 'kilograms'], unit: 'kilograms' },
    { patterns: ['_g', 'grams'], unit: 'grams' },
    { patterns: ['_lbs', 'pounds'], unit: 'pounds' },
    { patterns: ['_oz', 'ounces'], unit: 'ounces' },

    // Temperature
    { patterns: ['celsius', '_c'], unit: 'celsius' },
    { patterns: ['fahrenheit', '_f'], unit: 'fahrenheit' },
    { patterns: ['kelvin'], unit: 'kelvin' },

    // Speed & throughput
    { patterns: ['_bps', 'bits_per_second'], unit: 'bits_per_second' },
    { patterns: ['_kbps'], unit: 'kilobits_per_second' },
    { patterns: ['_mbps'], unit: 'megabits_per_second' },
    { patterns: ['_rps', 'requests_per_second'], unit: 'requests_per_second' },
    { patterns: ['_qps', 'queries_per_second'], unit: 'queries_per_second' },
    { patterns: ['_tps', 'transactions_per_second'], unit: 'transactions_per_second' },
    { patterns: ['_rpm', 'revolutions'], unit: 'rpm' },
    { patterns: ['_mph', 'miles_per_hour'], unit: 'miles_per_hour' },
    { patterns: ['_kph', 'km_per_hour'], unit: 'km_per_hour' },

    // Display
    { patterns: ['_px', 'pixels'], unit: 'pixels' },
    { patterns: ['dpi', 'dots_per_inch'], unit: 'dpi' },
    { patterns: ['ppi', 'pixels_per_inch'], unit: 'ppi' },

    // Frequency
    { patterns: ['_hz', 'hertz'], unit: 'hertz' },
    { patterns: ['_khz', 'kilohertz'], unit: 'kilohertz' },
    { patterns: ['_mhz', 'megahertz'], unit: 'megahertz' },
    { patterns: ['_ghz', 'gigahertz'], unit: 'gigahertz' },

    // Domain-specific
    { patterns: ['calories', 'kcal'], unit: 'calories' },
    { patterns: ['steps'], unit: 'steps' },
    { patterns: ['bpm', 'heartrate', 'heart_rate'], unit: 'beats_per_minute' },
];

// ============================================================================
// Export all patterns as a single object for easy extension
// ============================================================================

export const PATTERNS = {
    identifier: IDENTIFIER_PATTERNS,
    time: TIME_PATTERNS,
    measure: MEASURE_PATTERNS,
    text: TEXT_PATTERNS,
    dimension: DIMENSION_PATTERNS,
    avgAggregation: AVG_AGGREGATION_PATTERNS,
    noneAggregation: NONE_AGGREGATION_PATTERNS,
    units: UNIT_PATTERNS,
    valuePatterns: VALUE_PATTERNS,
} as const;

export const HEURISTIC_PATTERNS = {
    measure: HEURISTIC_MEASURE_PATTERNS,
    avg: HEURISTIC_AVG_PATTERNS,
    none: HEURISTIC_NONE_PATTERNS,
    text: HEURISTIC_TEXT_PATTERNS,
    time: HEURISTIC_TIME_PATTERNS,
    dimension: HEURISTIC_DIMENSION_PATTERNS,
    unitMap: HEURISTIC_UNIT_MAP,
} as const;