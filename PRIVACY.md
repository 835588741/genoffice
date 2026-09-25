# AiOffice Privacy Policy

Last updated: September 25, 2026

AiOffice is provided by Shanghai Luanqing Network Technology Co., Ltd. This
policy explains what data AiOffice processes, why it is processed, and the
choices available to you.

## Local document editing

Opening, editing, and saving documents is performed locally on your device.
AiOffice does not upload document content merely because a file is opened or
edited. You can use the local editing features without enabling cloud AI.

## Cloud AI features

Cloud AI is optional. Before the first cloud AI request, AiOffice displays a
separate consent prompt that identifies the data, recipients, and purpose. No
AI request is sent unless you select **Agree and Continue**.

When you invoke an AI feature, AiOffice may send the following data that you
choose to provide:

- your prompt or instruction
- selected text, cells, slides, pages, or other relevant document content
- document, spreadsheet, presentation, PDF, image, or attachment content
  required to complete the request
- technical request metadata such as the selected model, request identifier,
  app version, and error information

The data is sent over HTTPS to Lightyu API, operated by Shanghai Luanqing
Network Technology Co., Ltd. Lightyu API routes the request to the AI model
provider selected in AiOffice. The currently available providers are Zhipu AI
and DeepSeek. These recipients process the content only to generate a response
or perform the edit requested by the user, subject to their security and data
protection obligations.

If an AI task uses web or image search, the search terms may also be sent to
Genspark, Google Serper, Tavily, or DuckDuckGo to retrieve relevant results.

AiOffice's billing records contain request identifiers, model and usage data,
charge status, and timestamps. They do not contain the prompt or document
content. Request content is transmitted for processing and is not intentionally
stored in AiOffice billing records. Model providers may process request data
under their applicable service and privacy terms.

You can decline the prompt and continue using local editing. You can withdraw
consent at any time under **Settings > General > Allow cloud AI data
processing**. After withdrawal, AiOffice asks again before any later AI request.

## Account and purchases

If you sign in, AiOffice stores the Lightyu API session credential in the
operating system's protected credential storage and uses it to retrieve your
account profile and AI credit balance. Apple in-app purchases send the product
identifier, transaction identifier, and App Store receipt to Lightyu API for
verification, fraud prevention, idempotent credit delivery, and customer
support. Apple also processes purchase data under Apple's own policies.

## Usage analytics

Packaged official builds can send product usage events to Google Analytics 4.
You can disable this at any time under **Settings > General > Send anonymous
usage statistics**.

The app emits these events:

- `install_first_launch` — the first analytics-enabled use of a new installation
- `app_launch` — an app launch
- `file_open` — a local file was opened, including only its extension
- `file_new` — a new local file was created, including only its document kind
- `login_click` — the sign-in action was selected
- `login_success` — sign-in completed

Parameters can include app version, platform, operating system version, UI
language, file extension or kind, an installation identifier, session
identifier, and country code derived from the operating system locale.
Analytics does not include document content, file names, file paths, prompts,
account identity, or email address. Google receives normal HTTPS connection
metadata, including the public IP address.

## Storage, security, and deletion

Local preferences, consent choices, recent-file references, and local project
history remain on the device until removed by the user or the app is uninstalled.
Account, purchase, and billing records are retained only as needed to provide
the service, prevent fraud, meet accounting obligations, and resolve disputes.
AiOffice uses HTTPS in transit and access controls for service data.

You can delete your account directly in AiOffice: sign in, open **Settings >
Account**, select **Delete account**, and confirm the deletion. The app revokes
desktop sessions, removes login identifiers and desktop AI credential bindings,
clears pending desktop AI tasks, and anonymizes the account record. Local
documents remain on your device and are not uploaded or deleted by this action.
Required payment and transaction audit records may be retained without login
credentials as required for accounting, fraud prevention, and dispute handling.
For access or correction requests, contact Shanghai Luanqing Network Technology
Co., Ltd. through https://5555api.com/#contact.

## Policy changes

Material changes will be reflected by updating this policy and its date. If a
change expands the data sent by cloud AI, AiOffice will require consent again
before sending that data.
