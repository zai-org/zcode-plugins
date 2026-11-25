# Email Template Builder

Turn an email screenshot or design into a responsive HTML email. The agent writes the template in **MJML**. The plugin compiles it to HTML that works in common email clients, checks it, previews it next to the design and exports HTML + plain text. Nothing is sent.

## Defaults (v0.1)

- **Template language: MJML** (`mjml` 5, MIT). MJML outputs table layouts with inline styles and a mobile breakpoint, which Outlook, Gmail and Apple Mail handle.
- **Variables**: `{{name}}` placeholders stay in the exported HTML for your email service (Mailchimp, SendGrid, Customer.io…) to replace. Sample values in `data.json` are used only for the preview.
- **Preview**: offline. Remote images show as placeholders and the exported HTML keeps the real URLs. Dark mode applies the template's `prefers-color-scheme: dark` styles. If there are none, it simulates a client that inverts colours.
- **Sending**: none. No email service account or API key.

## Features

- **Templates** (`email_new`): `emails/<slug>/<slug>.mjml`, `data.json`, and links to the design images. The starter already has a preheader, dark-mode styles and an unsubscribe link.
- **Writing** (`email_write`): the agent writes MJML and/or sample data. Each write compiles and checks the template.
- **Checks** (`email_check`):
  - MJML errors with line numbers.
  - Body width over 600 px and images wider than the body.
  - Missing preheader (`mj-preview`) and missing dark-mode styles.
  - Images without alt text, local image paths (error) and `http:` images.
  - Empty or `#` links, and text colour contrast below 4.5:1.
  - No unsubscribe link.
  - Size: warning over 80 KB and error over **102 KB**, where Gmail clips the message.
  - Variables without a sample value.
- **Panel**:
  - Design and preview side by side, an inbox line showing subject + preheader, and desktop / mobile (375 px) / dark mode.
  - Size meter, issue list, editable variable table, and plain-text and MJML tabs.
  - Export button.
- **Export** (`email_export`): `export/<slug>.html` (with `{{variables}}`), `export/<slug>.txt` (plain-text part with links in brackets) and `export/<slug>.preview.html` (filled with sample data). Export is refused while there are errors.

## Usage

Ask the agent in ZCode Desktop:

- "Make an email template from this screenshot"
- "Check this email for Gmail clipping and dark mode"
- "Export the HTML and plain-text versions"

## Tools

| Tool | Purpose |
|---|---|
| `email_new` | Create a template (starter MJML + sample data) and link design images |
| `email_write` | Write MJML and/or sample data; compile and check |
| `email_check` | Compile and list problems |
| `email_export` | Write HTML, plain text and a filled preview |

## Scope (v0.1)

- MJML only. There is no drag-and-drop editor and no block JSON format.
- Nothing is sent, uploaded or connected to an email service. Upload the exported HTML to your email service yourself.
- The preview is Chrome rendering the compiled HTML. Exact rendering in Outlook for Windows and other clients needs a testing service such as Litmus or Email on Acid.
- Images are not hosted. Use public https URLs, for example from your email service's file manager or a CDN.

## Privacy, network and files

- Runs locally with no network access and no API keys.
- Writes only `emails/<slug>/` and `.email-builder/project.json` in the workspace.
