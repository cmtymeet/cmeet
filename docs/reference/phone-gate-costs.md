# Phone admission: providers and operator cost

Research checked 8 September 2026. Options for discussion, not provider selection
or deployment approval. The launch direction is phone possession without a
payment or recommendation requirement. The three gate policies remain separately
configurable; see the [functional protocol study](phone-gate-protocol-2026-09-08.md).

## Finding

The SMS component can cost roughly EUR 0.08–0.12 or USD 0.13–0.22 per admitted
member in the explicitly modelled normal scenarios below. This is not the full
cost of a privacy-preserving admission system. Failed onboarding, attack traffic,
key custody, independent operation and integration can dominate a small launch.
No reviewed SMS product supplies the complete verified-number-to-VOPRF-anchor
protocol. The accepted phone-registration oracle does not change that blocker.

## Practical shortlist

Amounts are the published list prices, not negotiated quotes. SMS prices are per
segment, so the scenarios assume one short code message fits one segment.
Currencies are not converted. Taxes/VAT, FX, lookup add-ons and country-specific
sender requirements are excluded unless stated. Verify and plain SMS are
different products; a plain SMS API leaves OTP generation/checks with our gate.

| Provider / product | CH | DE | AT | Verification fee and fixed costs |
|---|---:|---:|---:|---|
| Twilio Verify | USD 0.0769/SMS | USD 0.112/SMS | USD 0.0979/SMS | USD 0.05 per successful verification plus SMS; pay as you go has no monthly minimum. Managed senders and Fraud Guard included; volume discounts require sales. |
| seven SMS + custom gate | EUR 0.075/SMS | EUR 0.075/SMS | EUR 0.075/SMS | No separate OTP product fee in this comparison: we implement it. No basic fee or minimum turnover for ordinary sending; prepaid funding required. Dedicated numbers cost extra if chosen. Prices exclude VAT. |
| Plivo Verify | USD 0.0700–0.0718/SMS | USD 0.0950–0.2000/SMS | USD 0.0828–0.0926/SMS | Zero verification/Fraud Shield surcharge advertised, but current Verify documentation requires at least USD 1,000/month commitment; USD 10,000 for pre-registration markets. Exact CH/DE/AT eligibility/tier needs confirmation. Poor small-launch candidate. |
| Vonage Verify | Country/network quote or account rate needed | Same | Same | Conversion: EUR 0.052 / USD 0.06084 per successful verification plus attempted delivery charges. Success: all-inclusive successful-verification pricing by quote. No numeric CH/DE/AT rate established in this review. |

Sources: Twilio [Verify prices](https://www.twilio.com/en-us/verify/pricing),
[CH](https://www.twilio.com/en-us/sms/pricing/ch),
[DE](https://www.twilio.com/en-us/sms/pricing/de),
[AT](https://www.twilio.com/en-us/sms/pricing/at), and
[product FAQ on minimums](https://www.twilio.com/en-us/user-authentication-identity/verify);
seven [country rates](https://www.seven.io/en/full-sms-pricelist/),
[VAT/segment basis](https://www.seven.io/en/products/), and
[minimums](https://help.seven.io/de/finanzen/grundgebuehr-und-mindestumsatz);
Plivo [Verify](https://www.plivo.com/verify/pricing/),
[commitment/coverage](https://www.plivo.com/docs/programmable-api/verify/availability),
[CH](https://www.plivo.com/sms/pricing/ch/),
[DE](https://www.plivo.com/sms/pricing/de/),
[AT](https://www.plivo.com/sms/pricing/at/);
Vonage [Verify](https://www.vonage.com/communications-apis/verify/pricing/) and
[SMS/account-rate caveat](https://www.vonage.com/communications-apis/sms/pricing/).

Plivo's cheap unit rate must not be presented without its commitment. Its pricing
page says no charges for fraudulent/failed verifications; exact billing of a
delivered-but-abandoned attempt and every retry needs confirmation. Do not assume
all failed onboarding is free. Vonage's Success plan is the explicitly different
success-only commercial option; its price and minimum are unknown here.

## Cost per admitted member

Let `S` be billable SMS segments, `V` successful provider verifications, `A`
admitted members, `p` SMS price, and `v` verification fee:

`variable cost per admission = (S × p + V × v + other usage charges) / A`.

Admission rejection after a successful SMS check still costs money. Duplicate
registrations, a spent invitation, payment failure or an abandoned subsequent
step therefore belong in the denominator calculation, not just SMS conversion.

| Scenario | seven, all three countries | Twilio CH | Twilio DE | Twilio AT |
|---|---:|---:|---:|---:|
| 100 admitted; 100 successful checks; 100 SMS | EUR 0.075 | USD 0.127 | USD 0.162 | USD 0.148 |
| 100 admitted; 100 successful checks; 150 SMS including resends/abandonment | EUR 0.113 | USD 0.165 | USD 0.218 | USD 0.197 |
| 100 admitted; 150 successful checks; 200 SMS | EUR 0.150 | USD 0.229 | USD 0.299 | USD 0.271 |

These are arithmetic scenarios, not measured conversion or delivery rates. For
1,000 admissions, the middle scenario is about EUR 113 with seven or USD
165/218/197 with Twilio for an entirely CH/DE/AT cohort respectively. Actual
mixed-country cost is the weighted sum. No volume discount is assumed.

Normal logins can use the member's existing credential/passkey and incur no SMS
charge. Every future phone reverification, phone change or recovery flow adds
another attempt sequence. The frequency is a product choice, not an unavoidable
monthly per-member SMS subscription.

## Abuse can bill us before an account exists

An attacker does not need a million verified numbers to request a million code
deliveries. With no effective controls, 10,000 billable SMS alone would cost
EUR 750 at seven or USD 769–1,120 at these Twilio rates, before successful-check
charges. Number uniqueness operates too late to bound this expense.

Proposed pre-send controls: country/range restrictions, attempt limits and
cooldowns at the phone gate, session replay protection, a small prepaid/spend
budget, and a global automated circuit breaker. A spending notification alone
is not a hard cap. Gate-local rate keys still represent sensitive state; declare
their lifetime and who can see them. Different spellings of the same number must
share a canonical counter. A future payment gate placed after SMS does not
protect the SMS budget; placing it first creates a pay-before-eligibility/refund
trade-off. No ordering is adopted here.

Twilio's [Fraud Guard credit promise](https://www.twilio.com/en-us/legal/service-country-specific-terms/verify-fraud-guard)
requires qualifying settings, timely claims and provider review. It covers a
specified pumping-fraud category, not every costly bot attempt; it is not an
attention-free spending guarantee. Twilio's plain SMS price sheets also list a
USD 0.001 final-`Failed` processing fee: its application to a particular Verify
contract should be checked rather than silently added twice. For seven, budget
submitted chargeable messages conservatively; a universal failed-delivery refund
was not established.

## Provider retention and the operator's knowledge

Twilio's [verification API](https://www.twilio.com/docs/verify/api/verification)
accepts and returns the destination number and labels it `PII MTL: 30 days`.
Its [retention documentation](https://help.twilio.com/hc/en-us/articles/4410585868443-Data-Retention-and-Deletion-in-Twilio-Products)
explains MTL as a minimum, not a promise that all copies disappear on day 30.
seven exposes a customer logbook through its
[API scopes](https://docs.seven.io/en/rest-api/oauth2.0), and its
[privacy policy](https://www.seven.io/en/company/privacy/)
does not establish a checked zero-retention OTP route. Verify dashboards and
provider reporting are knowledge surfaces even if our database omits numbers.

An operator-owned provider account may let the operator retrieve the number
list. A second service name, restricted application token or enclave does not
remove the account owner's administrative access. A separately operated gate
with its own provider relationship is a candidate; its price and willingness
to support blind/minimal attestations remain unknown.

Neutral OTP wording is still the target. Sender templates and the actual community
use must be accepted by the provider/carriers; this review establishes prices,
not approval for any particular community deployment. Do not apply US short-code restrictions to CH,
DE or AT without checking the relevant route, or assume generic SMS wording
settles eligibility.

## Fixed cryptographic cost

AWS says [Nitro Enclaves has no additional enclave fee](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/),
but EC2 and other services remain chargeable. There is no selected compatible
machine, region, custody topology or independently operated gate, so a full
hosting quote would be premature. KMS ECDH is not a verified RFC 9497 backend.

For a future measured fixed monthly cost `F` and `N` monthly admissions, the
admission allocation is `F/N`. As sensitivity examples only, USD 20/month adds
USD 0.20 at 100 admissions or USD 0.02 at 1,000; USD 100/month adds USD 1.00 or
USD 0.10. These are not AWS quotes. Audit, development and a second custodian's
work are additional unpriced costs. Do not call the sum a cost per *person*:
the functional unit is a successful admission, and one person can hold numbers.

## Next comparison worth making

Twilio is the clearest managed-OTP cost baseline; seven is the clearest low-fixed-
cost raw-SMS baseline for this geography. Compare their actual approved sender
flow, delivery/retry behaviour and inaccessible-to-operator gate arrangement
before choosing. Plivo's commitment makes it a volume-stage comparison. Vonage's
success-only quote could matter if abandonment/fraud risk is high. None has been
contacted, provisioned or selected; no SMS or payment was sent.
