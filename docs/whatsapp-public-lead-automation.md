# WhatsApp automation for public B2B leads

The public diagnostic form accepts an optional mobile number and an explicit WhatsApp opt-in. The API stores the opt-in marker on the CRM client and sends only an approved Meta template.

Configure these Render environment variables on `omnitech-core-api` after creating and approving the matching templates in WhatsApp Manager:

- `WHATSAPP_TEMPLATE_LEAD_WELCOME`: approved template name; body parameters in order: contact name, company.
- `WHATSAPP_TEMPLATE_APPOINTMENT_CONFIRMATION`: approved template name; body parameters in order: contact name, appointment title, local date/time.
- `WHATSAPP_TEMPLATE_LANGUAGE`: optional language code; defaults to `es_ES`.

WhatsApp credentials are read from the organization's existing WhatsApp Business integration first, then the existing environment-variable fallback through `getWhatsAppCreds`.

The welcome message is sent only when the lead provides a phone number and checks the opt-in box. Appointment confirmation is sent only for a client whose CRM notes contain `[WHATSAPP_OPT_IN]`. The CRM save and appointment creation are not rolled back if Meta delivery fails.

Do not set the template variables until the corresponding templates are approved in Meta. Free-form text messages are deliberately not used for business-initiated conversations.