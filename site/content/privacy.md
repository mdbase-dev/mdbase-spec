## About this policy

This Privacy Policy explains how Callum Alpass, operating mdbase ("mdbase",
"we", "us"), handles personal information when you visit mdbase.dev or use
mdbase services, including mdbase connect and the hosted MCP gateway.

This policy applies to the services operated by mdbase. Third-party
applications that you connect to a collection have their own privacy practices.

## The short version

- We do not sell personal information or use collection content for advertising
  or to train artificial intelligence models.
- The public mdbase.dev website does not currently use advertising cookies or
  analytics.
- Local collection paths and record content stay on your computer unless you
  choose to host, sync, or disclose that content to an authorised application.
- Relayed local collection operations are end-to-end encrypted. The Connect
  control plane sees routing metadata and ciphertext, not record content.
- Hosted collection content is encrypted at rest, but the hosted provider can
  decrypt it to perform the queries, validation, storage, and synchronisation
  you request.

## Information we collect

### Account and sign-in information

When you create or use an account, we receive information from the identity
provider you choose, such as:

- your name, email address, username, and profile image;
- the provider's stable account identifier;
- whether the provider has verified your email address; and
- sign-in times, session information, and authentication events.

We do not receive or store your Google or GitHub password. Google sign-in is
used only for basic identity; mdbase does not request Google Drive, Gmail, or
other Google product access as part of account sign-in.

### Computers, collections, applications, and grants

To operate Connect, we store service metadata such as:

- account, computer, connector, collection, application, replica, and grant
  identifiers;
- names you give computers and collections;
- collection specification versions and declared contract or type metadata;
- applications you connect, the permissions you approve, and revocation state;
- connection state, last-seen times, synchronisation cursors, and operational
  events; and
- notification subscriptions and delivery state if you enable notifications.

For a local collection, the Connect control plane does not receive the local
filesystem path.

### Collection operations and content

How content is handled depends on the storage mode you choose:

- **Local collection:** canonical Markdown remains on your computer. An
  authorised application can receive only the operations and records allowed by
  the grant you approve.
- **Encrypted relay:** the control plane routes end-to-end encrypted operation
  payloads between an authorised application and your connector. It can observe
  identifiers, operation type, timing, approximate sizes, connection state, and
  routing outcomes, but cannot read the encrypted request or response.
- **Hosted collection:** canonical Markdown and retained versions are stored
  encrypted at rest. The hosted provider can decrypt content in memory to
  validate, query, update, and synchronise the collection. Authorised
  applications and replicas receive content within their approved scope.
- **Hosted MCP gateway:** when you explicitly connect an MCP host, the gateway
  decrypts authorised responses in memory so it can return them to that host.
  It is designed not to persist record payloads, local paths, or operation
  results.

Markdown can contain personal or sensitive information. You decide what to put
in a collection and which applications may access it.

### Technical and support information

When you use the services, our infrastructure may process:

- IP address, browser or client type, request time, response status, and
  security or rate-limit events;
- crash reports, diagnostics, and service logs that we generate or that you
  choose to send; and
- messages and attachments you send when requesting support.

The mdbase.dev website loads its typefaces from Google Fonts, so your browser
may make a request to Google when loading a page.

## How we use information

We use information to:

- provide accounts, authentication, hosting, synchronisation, relaying, MCP
  access, and notifications;
- apply the permissions you approve and enforce revocation;
- secure the services, prevent abuse, investigate faults, and maintain
  reliability;
- respond to support requests and communicate important service or policy
  changes;
- understand aggregate service capacity and improve functionality; and
- comply with legal obligations and protect users, mdbase, and others.

Where applicable law requires a legal basis, we rely on performing our
agreement with you, our legitimate interests in operating and securing the
services, your consent, and compliance with law.

## When we disclose information

We disclose information only as needed for the following purposes:

- **Infrastructure providers.** GitHub Pages hosts the public website, and
  Render hosts the application services and database. These providers may use
  their own infrastructure and subprocessors to deliver their services. For
  example, Render currently delivers some mdbase traffic through Cloudflare
  network infrastructure; mdbase does not contract with Cloudflare directly.
- **Identity providers.** Google or GitHub processes sign-in information when
  you choose that provider.
- **Applications and MCP hosts you authorise.** These parties receive collection
  information within the permissions you approve. Their own terms and privacy
  policies apply after they receive it.
- **Notification services.** Browser or platform push providers process the
  delivery information needed to send notifications you enable.
- **Professional advisers and authorities.** We may disclose information when
  reasonably necessary to obtain professional advice, comply with law, respond
  to valid legal process, or protect rights, safety, and service integrity.
- **A business transfer.** If responsibility for mdbase changes, information
  may transfer with the service, subject to this policy and applicable law.

We do not sell or rent personal information.

## Data locations and international processing

mdbase is operated from Australia. Production Connect services and databases
are currently hosted in Singapore. Infrastructure, identity, and application
providers may process information in Australia, Singapore, the United States,
and other countries where they operate.

Those countries may have different privacy laws. We use service providers and
technical protections intended to keep information appropriately protected
when it is processed outside Australia.

## Security

We use safeguards appropriate to the service, including encrypted transport,
hashed cloud credentials, scoped grants, short-lived authorisation state,
encryption at rest for hosted content, end-to-end encryption for relay
payloads, access controls, rate limits, and audit metadata.

No online system is completely secure. Keep your identity-provider account and
devices secure, install updates, review application grants, revoke access you
no longer need, and keep an independent backup of important Markdown.

## Retention and deletion

We retain account and service metadata while your account is active and for as
long as reasonably needed to operate, secure, and meet legal obligations.
Authentication state and sessions expire. Operational and security records may
be retained after other account data when reasonably required to investigate
abuse, maintain integrity, or comply with law.

Deleting a hosted collection removes it from active service storage. Copies may
remain temporarily in encrypted backups until those backups are overwritten.
Revoking an application or replica stops future access but does not control
copies that a third party lawfully received before revocation.

To request account deletion, contact
[support@mdbase.dev](mailto:support@mdbase.dev). We may need to verify your
identity before completing a request.

## Your choices and rights

You can:

- review and revoke application grants through Connect;
- remove computers, replicas, and hosted collections;
- sign out and stop using the services;
- choose whether to enable notifications; and
- request access to, correction of, or deletion of your personal information.

Depending on where you live, you may also have rights to object, restrict
processing, or receive a portable copy of information. Contact us to make a
request. You may also complain to your local privacy regulator, including the
Office of the Australian Information Commissioner where applicable.

## Cookies and local storage

Connect uses secure cookies that are necessary for sign-in, session management,
and protection of authentication flows. The public website stores a theme
preference in your browser when you select System, Light, or Dark.

We do not currently use advertising cookies or third-party analytics on
mdbase.dev. If that changes, we will update this policy and provide any choices
required by law.

## Children

The hosted services are intended for adults and are not directed to children.
Do not create an account if you are under 18.

## Changes to this policy

We may update this policy as the services or legal requirements change. We will
publish the revised policy here, update the date, and provide reasonable notice
of material changes where practical.

## Contact and complaints

Questions, privacy requests, and complaints can be sent to
[support@mdbase.dev](mailto:support@mdbase.dev). Please describe your concern
and how we can contact you. We will review it and respond within a reasonable
period.
