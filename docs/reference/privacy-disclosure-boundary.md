# Adult classification and the operator's disclosure boundary

Reviewed **8 September 2026**. This is a scoped research note, not legal clearance for a launched service. The operating entity and target jurisdictions remain open under [D7](../docs/decisions.md).

## User's clarified objective

The user accepts that the operator may have to respond to lawful requests and disclose available data. The intended protection is architectural: avoid receiving private plaintext, avoid holding decryption keys, and avoid retaining unnecessary information. A request for historical private content should consequently yield only what actually exists and is accessible to the operator. The user wants public source code so others can inspect this claim.

This is a data-minimisation and verifiable-privacy objective. It is not a request to ignore lawful orders or a claim that the operator is exempt from regulation. The intended reduction in disclosure capability is meaningful even where legal duties remain.

The user further clarified a **hard product requirement: no content-moderation work by the operator**. Data should be public or unavailable to the operator, with the intended outcome that neither category demands operator action. Preserve this requirement; do not silently replace it with an operator-moderated service. Its feasibility is unresolved: public availability does not by itself remove hosting responsibilities. The existing public board therefore has an open compatibility issue, recorded as D10.

## Three separate questions

| Question | Consequence |
|---|---|
| Does a search engine classify the service as adult? | Affects discovery and filtering; it does not establish the operator's access to private messages |
| What data can the operator obtain? | Depends on the actual client, relay, registration, reporting, hosting and retention design |
| Which legal duties apply? | Depends on service functions, content, operator and jurisdiction; a search label does not answer this |

Google's adult classification generally narrows reach through SafeSearch and query-intent filtering. It still permits relevant discovery by people seeking that content. Accurate classification is appropriate when warranted; it is not an SEO reward or a legal licence. [Google's explicit-content guidance](https://developers.google.com/search/docs/specialty/explicit/guidelines).

## What limited possession achieves

Assuming the claimed cryptography and data flows are actually established, an operator cannot recover historical plaintext from ciphertext without the required secrets. If neither content nor decryptable history was retained, there is no historical message database to hand over. This claim must cover logs, backups, diagnostics and any report attachments, not just the main database.

There is a relevant legal example: **DSA Article 10(2)(b)** limits its information orders to information already collected for providing the service and within the provider's control. Article 10(6) preserves national procedural law. Article 8 bars general monitoring obligations, while Articles 6 and 16 address hosting knowledge and notices. These provisions do not settle all Swiss/EU investigative powers. [DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1696339439479&uri=CELEX%3A32022R2065).

Encryption and minimisation also support data protection by design. Remaining personal data and outsourced processing still require assessment; using a cloud provider does not automatically transfer away the customer's responsibilities. [Swiss FDPIC guidance](https://www.edoeb.admin.ch/en/data-processing-in-the-cloud).

## Public code and the actual service

Publishing code enables inspection and independent review. It does not alone prove which code a user's browser received, what a server deployed, or what a hosting provider logged. The verification work should connect:

1. The published protocol and client/server source to identified release artifacts.
2. The served client and deployed configuration to those artifacts, with the limits of that verification stated.
3. A data inventory to the real network flows, logs, backups, third parties and report handling.
4. Privacy claims to adversarial testing and independent review.

These are proposed assurance steps, not evidence that the current prototype already meets them. Client-delivery verification and server-side absence of logging are different problems; observing ordinary traffic cannot prove that a malicious server never keeps a copy.

The existing [security review](../docs/security-review.md) identifies unresolved cryptographic and deployment boundaries, including provider activity metadata. Its defensible relay target is **no application message storage**, with provider metadata disclosed, until stronger claims are demonstrated.

## Boundary in the current specification

The [public ad board](../board/README.md) publishes plaintext. That content is outside the intended confidentiality of private chats. Registration/ban anchors, reports and provider metadata also require their own inventories. No inference of a wholly anonymous or wholly zero-knowledge platform follows from encrypting the chat channel.

Consequently, a request for private historical chats can be unproductive while a request concerning public ads, remaining records or service operation still has a purpose. State the claim per data category and actor rather than promising that contacting the operator is universally pointless.

Public accessibility means a requester may obtain a copy directly. It does not answer who must handle a valid removal notice. Automated member flags may reduce routine work, but their existence does not demonstrate that every required response can proceed without operator involvement. No solution satisfying both public-board hosting and the user's no-moderation requirement has been established.

Text-only ads and expiry are useful scope reductions, but not blanket legal exemptions. German law's definition of content includes written material and transmission without storage; KJM distinguishes content requiring adult-only access from content for which other youth-protection measures may suffice. An age label does not automatically establish the right access control for arbitrary text. [StGB §11(3)](https://www.gesetze-im-internet.de/stgb/__11.html), [KJM guidance](https://www.kjm-online.de/ueber-uns/fragen-und-antworten/).

## Working conclusion

Keep the goal of minimising what the operator can disclose and making that boundary inspectable. Document exactly which data are absent, encrypted without operator keys, public, transiently observed or retained by providers. Adult search classification is a separate discovery issue; it neither defeats encryption nor removes applicable duties.

The statements here support the next service-specific review. They do not decide operator identity, approve a jurisdiction, register a name, or change the agreed chat and board product scope.
