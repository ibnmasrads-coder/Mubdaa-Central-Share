# Mubdaa Central Share

Independent WordPress companion plugin for **MainWP Dashboard**, focused on desktop WhatsApp sharing immediately after publishing.

## Requirements
- WordPress 6.3+ and MainWP Dashboard installed on the **central dashboard only**.
- Desktop browsers: Chromium-based browser with image clipboard capability recommended.
- No WhatsApp API, WhatsApp Web automation, or changes to MainWP/Bridge files.

## UX contract
- Publishing completes normally; selected successful links are gathered from MainWP results.
- A lightweight share workspace appears above the native MainWP posting modal **after the final child-site result**.
- The source article image is assembled into a titled PNG (title above image), while links are copied separately for the media caption.
- Sharing happens manually: paste the image into WhatsApp Web/Desktop **first**, then paste the caption.
- No permanent share history. One short-lived transient can hold source image metadata across MainWP's temporary-post deletion.
- Never claim WhatsApp messages were sent; the operator must confirm in WhatsApp.

## Project state
Development baseline. **Do not deploy to a live client dashboard until integration QA on the exact MainWP release**.

## License
GPL-2.0-or-later.
