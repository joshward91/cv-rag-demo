/**
 * Harbour CRM help centre.
 *
 * Each article covers exactly one task and describes a screen that exists in
 * this demo. Labels in **bold** are copied verbatim from the UI, so a reviewer
 * can follow every step in the app itself.
 *
 * Fields:
 *   id               Stable identifier, used for citations.
 *   status           draft, public, internal or archived. Only 'public' articles
 *                    reach the assistant (see isPublic in src/rag/suite.js).
 *   category         Help centre section.
 *   title            Task-shaped title.
 *   aliases          "Also called": other ways people describe the task.
 *   body             Markdown subset: paragraphs, numbered steps, bullets, **bold**.
 *   notConfusedWith  Ids of articles that are easy to mix up with this one.
 *   screen           Hash route of the screen the article describes.
 *
 * The help centre is written in the vendor's voice and is not edited to make
 * retrieval pass: retrieval problems are fixed in the query rewriting, the
 * decision policy or the prompt (see src/rag). Terminology used throughout
 * (see `glossary-clients-contacts`):
 *   client   The business that uses Harbour CRM (the account holder).
 *   contact  A person the client does business with: the client's customer.
 *   company  An organisation that contacts can belong to.
 */
export const articles = [
  // ---------------------------------------------------------------- Contacts
  {
    id: 'contact-create',
    status: 'public',
    category: 'Contacts',
    title: 'Add a Contact',
    aliases: ['create a contact', 'new contact', 'add a customer', 'add a person', 'add a lead'],
    body: `Contacts are the people you do business with.

1. Go to **Contacts**.
2. Select **New Contact**.
3. Enter a **First name**. All other fields are optional.
4. Optionally add a **Last name**, **Email**, **Phone**, **Job title**, **Company** and **Status**.
5. Select **Save Contact**.

The new Contact opens straight away so you can add notes or Deals.`,
    notConfusedWith: ['company-create', 'contact-link-company'],
    screen: '#/contacts/new',
  },
  {
    id: 'contact-edit-phone',
    status: 'public',
    category: 'Contacts',
    title: "Update a Contact's phone number",
    aliases: [
      "change a contact's phone number",
      "edit a contact's mobile number",
      "update a customer's phone number",
      'add a phone number to a contact',
      "fix a contact's number",
    ],
    body: `1. Go to **Contacts** and open the Contact.
2. Select **Edit**.
3. Replace the number in the **Phone** field. You can use digits, spaces, brackets and a leading +, for example +61 491 570 156.
4. Select **Save Contact**.

Each Contact has one **Phone** field. If you need to store a second number, create a custom field for it.`,
    notConfusedWith: ['account-client-contact-number', 'company-edit-details', 'custom-field-create'],
    screen: '#/contacts',
  },
  {
    id: 'contact-edit-email',
    status: 'public',
    category: 'Contacts',
    title: "Change a Contact's email address",
    aliases: ["update a contact's email", "edit a customer's email address", 'fix a typo in an email address'],
    body: `1. Go to **Contacts** and open the Contact.
2. Select **Edit**.
3. Replace the address in the **Email** field.
4. Select **Save Contact**.

The email address must contain an **@** and a domain, for example sam@example.com. If it doesn't, the form shows **Enter a valid email address** and doesn't save.`,
    notConfusedWith: ['account-billing-email'],
    screen: '#/contacts',
  },
  {
    id: 'contact-change-status',
    status: 'public',
    category: 'Contacts',
    title: "Change a Contact's status",
    aliases: ['convert a lead to a customer', 'mark a contact as inactive', 'lifecycle stage', 'set a contact as a customer'],
    body: `Every Contact has a **Status**: **Lead**, **Customer** or **Inactive**.

1. Go to **Contacts** and open the Contact.
2. Select **Edit**.
3. Choose the new value in the **Status** list.
4. Select **Save Contact**.

A Contact's status is separate from Deal stages. Winning a Deal doesn't change the Contact's status.`,
    notConfusedWith: ['deal-change-stage'],
    screen: '#/contacts',
  },
  {
    id: 'contact-link-company',
    status: 'public',
    category: 'Contacts',
    title: 'Link a Contact to a Company',
    aliases: ["set a contact's company", 'assign a contact to an organisation', 'move a contact to another company', "change a contact's employer"],
    body: `A Contact can belong to one Company.

1. Go to **Contacts** and open the Contact.
2. Select **Edit**.
3. Choose the Company in the **Company** list. Choose **No Company** to unlink the Contact.
4. Select **Save Contact**.

The Contact now appears under **Contacts at this Company** on the Company's page. If the Company isn't in the list yet, add it first under **Companies**.`,
    notConfusedWith: ['company-create'],
    screen: '#/contacts',
  },
  {
    id: 'contact-delete',
    status: 'public',
    category: 'Contacts',
    title: 'Delete a Contact',
    aliases: ['remove a contact', 'remove a customer', 'get rid of a contact'],
    body: `1. Go to **Contacts** and open the Contact.
2. Select **Delete**.
3. In the confirmation box, select **Delete Contact**.

Deleting a Contact also deletes their notes. Deals linked to the Contact are kept and show **No Contact**. Deleting can't be undone.`,
    notConfusedWith: ['company-delete', 'deal-delete'],
    screen: '#/contacts',
  },
  {
    id: 'contact-search',
    status: 'public',
    category: 'Contacts',
    title: 'Find a Contact',
    aliases: ['search contacts', 'look up a customer', 'filter contacts by company', 'filter contacts by status'],
    body: `1. Go to **Contacts**.
2. Type in the search box. It matches a Contact's name, email address and phone number.
3. To narrow the list further, use the **Company** and **Status** filters next to the search box.

Select **Clear filters** to show every Contact again.`,
    notConfusedWith: [],
    screen: '#/contacts',
  },
  {
    id: 'contact-export',
    status: 'public',
    category: 'Contacts',
    title: 'Export Contacts to a CSV file',
    aliases: ['download contacts', 'download my contact list', 'contacts spreadsheet', 'back up contacts'],
    body: `1. Go to **Contacts**.
2. Optionally search or filter the list. The export includes only the Contacts currently shown.
3. Select **Export CSV**.

The file includes each Contact's name, email, phone, job title, Company, status and custom fields. It opens in Excel, Numbers and Google Sheets.`,
    notConfusedWith: ['contact-search'],
    screen: '#/contacts',
  },
  {
    id: 'contact-add-note',
    status: 'public',
    category: 'Contacts',
    title: 'Add a note to a Contact',
    aliases: ['log a call', 'record a conversation', 'write up meeting notes', 'comment on a contact', 'contact activity'],
    body: `1. Go to **Contacts** and open the Contact.
2. In the **Notes** section, type in the **Add a note** box.
3. Select **Save note**.

Notes appear newest first with the date they were added. Notes can't be edited after saving.`,
    notConfusedWith: [],
    screen: '#/contacts',
  },

  // --------------------------------------------------------------- Companies
  {
    id: 'company-create',
    status: 'public',
    category: 'Companies',
    title: 'Add a Company',
    aliases: ['create a company', 'new organisation', 'add a business', 'add an organisation'],
    body: `1. Go to **Companies**.
2. Select **New Company**.
3. Enter the **Company name**. All other fields are optional.
4. Optionally add the **Industry**, **Phone**, **Website** and **Address**.
5. Select **Save Company**.

To add people to the Company, link each Contact to it.`,
    notConfusedWith: ['contact-create', 'contact-link-company'],
    screen: '#/companies/new',
  },
  {
    id: 'company-edit-details',
    status: 'public',
    category: 'Companies',
    title: "Edit a Company's phone number, website or address",
    aliases: ["update a company's details", "change an organisation's phone number", "update a business's address", 'new office address for a company', "rename a company"],
    body: `1. Go to **Companies** and open the Company.
2. Select **Edit**.
3. Change the **Company name**, **Industry**, **Phone**, **Website** or **Address**.
4. Select **Save Company**.

This changes the Company's main details only.`,
    notConfusedWith: ['contact-edit-phone', 'account-client-contact-number', 'account-business-name'],
    screen: '#/companies',
  },
  {
    id: 'company-delete',
    status: 'public',
    category: 'Companies',
    title: 'Delete a Company',
    aliases: ['remove a company', 'remove an organisation'],
    body: `1. Go to **Companies** and open the Company.
2. Select **Delete**.
3. In the confirmation box, select **Delete Company**.

Contacts and Deals linked to the Company are kept, and their Company changes to **No Company**. Deleting can't be undone.`,
    notConfusedWith: ['contact-delete'],
    screen: '#/companies',
  },

  // ------------------------------------------------------------------- Deals
  {
    id: 'deal-create',
    status: 'public',
    category: 'Deals',
    title: 'Create a Deal',
    aliases: ['add a deal', 'new opportunity', 'add a sale', 'log a sale', 'track a sale'],
    body: `1. Go to **Deals**.
2. Select **New Deal**.
3. Enter a **Deal name** and a **Value**.
4. Optionally choose a **Company**, a **Contact**, a **Stage** and an **Expected close date**. New Deals start in the **New** stage unless you choose another.
5. Select **Save Deal**.

Values use the currency set in **Settings** > **Client profile**.`,
    notConfusedWith: [],
    screen: '#/deals/new',
  },
  {
    id: 'deal-change-stage',
    status: 'public',
    category: 'Deals',
    title: 'Move a Deal to a different stage',
    aliases: ['change a deal stage', 'move a deal along the pipeline', 'progress an opportunity', 'drag a deal to another column'],
    body: `Open Deals move through four stages: **New**, **Qualified**, **Proposal sent** and **Negotiation**.

1. Go to **Deals** and open the Deal.
2. Choose the new stage in the **Stage** list.

The change saves straight away and the Deal moves to that column on the board. The board doesn't support drag and drop.

To close a Deal, use **Mark as won** or **Mark as lost** instead.`,
    notConfusedWith: ['deal-mark-won', 'deal-mark-lost', 'contact-change-status'],
    screen: '#/deals',
  },
  {
    id: 'deal-mark-won',
    status: 'public',
    category: 'Deals',
    title: 'Mark a Deal as won',
    aliases: ['close a deal as won', 'win a deal', 'record a sale as closed'],
    body: `1. Go to **Deals** and open the Deal.
2. Select **Mark as won**.

The Deal moves to the **Won** column and its close date is set to today. To undo it, select **Reopen Deal**.`,
    notConfusedWith: ['deal-mark-lost', 'deal-change-stage'],
    screen: '#/deals',
  },
  {
    id: 'deal-mark-lost',
    status: 'public',
    category: 'Deals',
    title: 'Mark a Deal as lost',
    aliases: ['close a deal as lost', 'lose a deal', 'record a lost reason', 'they chose a competitor', 'kill a deal'],
    body: `1. Go to **Deals** and open the Deal.
2. Select **Mark as lost**.
3. Choose a **Lost reason**: **Price**, **Timing**, **Chose a competitor**, **No response** or **Other**.
4. Select **Confirm**.

The Deal moves to the **Lost** column and keeps its value for reporting. To undo it, select **Reopen Deal**.`,
    notConfusedWith: ['deal-mark-won', 'deal-delete'],
    screen: '#/deals',
  },
  {
    id: 'deal-reopen',
    status: 'public',
    category: 'Deals',
    title: 'Reopen a won or lost Deal',
    aliases: ['undo mark as won', 'undo mark as lost', 'reopen a closed deal'],
    body: `1. Go to **Deals** and open the won or lost Deal.
2. Select **Reopen Deal**.

The Deal returns to the **Negotiation** stage, and its close date and lost reason are cleared.`,
    notConfusedWith: ['deal-change-stage'],
    screen: '#/deals',
  },
  {
    id: 'deal-edit-value',
    status: 'public',
    category: 'Deals',
    title: "Change a Deal's value",
    aliases: ["update a deal amount", "edit the price of an opportunity", "change how much a deal is worth"],
    body: `1. Go to **Deals** and open the Deal.
2. Select **Edit**.
3. Enter the new amount in **Value**. Use numbers only, without a currency symbol.
4. Select **Save Deal**.

The column totals on the board update straight away.`,
    notConfusedWith: ['account-currency'],
    screen: '#/deals',
  },
  {
    id: 'deal-delete',
    status: 'public',
    category: 'Deals',
    title: 'Delete a Deal',
    aliases: ['remove a deal', 'remove an opportunity'],
    body: `1. Go to **Deals** and open the Deal.
2. Select **Delete**.
3. In the confirmation box, select **Delete Deal**.

Deleting can't be undone. If the Deal fell through, consider **Mark as lost** instead so it still counts in your history.`,
    notConfusedWith: ['deal-mark-lost', 'contact-delete'],
    screen: '#/deals',
  },

  // ----------------------------------------------------------- Custom fields
  {
    id: 'custom-field-create',
    status: 'public',
    category: 'Custom fields',
    title: 'Create a custom field',
    aliases: ['add a custom field', 'add an extra field', 'add my own field to contacts', 'track extra information'],
    body: `Custom fields let you store information Harbour CRM doesn't have a field for.

1. Go to **Settings** > **Custom fields**.
2. Select **Add custom field**.
3. Enter a **Label**.
4. Choose where it appears in **Applies to**: **Contacts**, **Companies** or **Deals**.
5. Choose a **Type**: **Text**, **Number**, **Date** or **Dropdown**. For a dropdown, enter one option per line in **Options**.
6. Select **Save field**.

The field appears on every record of that type, in the edit form and on the record's page.`,
    notConfusedWith: ['custom-field-fill', 'custom-field-edit'],
    screen: '#/settings/custom-fields',
  },
  {
    id: 'custom-field-fill',
    status: 'public',
    category: 'Custom fields',
    title: 'Fill in a custom field on a record',
    aliases: ['enter a value in a custom field', 'set a custom field value', 'update a custom field on a contact'],
    body: `1. Open the Contact, Company or Deal.
2. Select **Edit**.
3. Custom fields appear below the standard fields under **Custom fields**. Enter or choose a value.
4. Save the record.

A field only appears on the record type it applies to. In this account, for example, Contacts have **Preferred contact method**, Companies have **ABN** and Deals have **Lead source**. To change which fields exist, go to **Settings** > **Custom fields**.`,
    notConfusedWith: ['custom-field-create'],
    screen: '#/contacts',
  },
  {
    id: 'custom-field-edit',
    status: 'public',
    category: 'Custom fields',
    title: 'Rename a custom field or edit its options',
    aliases: ['change a custom field label', 'more options for a dropdown field', 'edit a custom field'],
    body: `1. Go to **Settings** > **Custom fields**.
2. Select **Edit** next to the field.
3. Change the **Label**, or for a dropdown, edit the **Options** (one per line).
4. Select **Save field**.

You can't change a field's **Type** or **Applies to** after it's created. To change them, delete the field and create a new one.`,
    notConfusedWith: ['custom-field-create', 'custom-field-delete'],
    screen: '#/settings/custom-fields',
  },
  {
    id: 'custom-field-delete',
    status: 'public',
    category: 'Custom fields',
    title: 'Delete a custom field',
    aliases: ['remove a custom field', 'get rid of an extra field'],
    body: `1. Go to **Settings** > **Custom fields**.
2. Select **Delete** next to the field.
3. In the confirmation box, select **Delete field**.

Deleting a field removes its values from every record. This can't be undone.`,
    notConfusedWith: ['custom-field-edit'],
    screen: '#/settings/custom-fields',
  },

  // ---------------------------------------------------------------- Settings
  {
    id: 'account-client-contact-number',
    status: 'public',
    category: 'Client profile',
    title: 'Change your Client contact number',
    aliases: ['client phone number', 'the number Harbour CRM support calls', 'account phone number'],
    body: `Your **Client contact number** is the number Harbour CRM support and billing use to reach you.

1. Go to **Settings** > **Client profile**.
2. Replace the number in **Client contact number**.
3. Select **Save Client profile**.`,
    notConfusedWith: ['contact-edit-phone', 'company-edit-details'],
    screen: '#/settings/account',
  },
  {
    id: 'account-business-name',
    status: 'public',
    category: 'Client profile',
    title: 'Change your Client name',
    aliases: ['business name', 'trading name', 'rename your client profile'],
    body: `Your **Client name** appears at the top of every page in Harbour CRM.

1. Go to **Settings** > **Client profile**.
2. Change the **Client name**.
3. Select **Save Client profile**.`,
    notConfusedWith: ['company-edit-details'],
    screen: '#/settings/account',
  },
  {
    id: 'account-billing-email',
    status: 'public',
    category: 'Client profile',
    title: 'Change your billing email',
    aliases: ['where invoices are sent', 'client email address', 'accounts email'],
    body: `Your **Billing email** is where Harbour CRM sends your subscription receipts.

1. Go to **Settings** > **Client profile**.
2. Replace the address in **Billing email**.
3. Select **Save Client profile**.`,
    notConfusedWith: ['contact-edit-email'],
    screen: '#/settings/account',
  },
  {
    id: 'account-currency',
    status: 'public',
    category: 'Client profile',
    title: 'Change your currency',
    aliases: ['default currency', 'switch to US dollars', 'show deal values in another currency'],
    body: `1. Go to **Settings** > **Client profile**.
2. Choose a **Currency**: **AUD**, **NZD**, **USD**, **GBP** or **EUR**.
3. Select **Save Client profile**.

Changing the currency changes the symbol shown on every Deal. It doesn't convert existing values.`,
    notConfusedWith: ['deal-edit-value'],
    screen: '#/settings/account',
  },

  // ------------------------------------------------------------ Getting started
  {
    id: 'glossary-clients-contacts',
    status: 'public',
    category: 'Getting started',
    title: 'Clients, Contacts and Companies: what the terms mean',
    aliases: ['terminology', 'glossary', 'what is the difference between a client and a contact'],
    body: `Harbour CRM uses three terms with specific meanings:

- **Client**: your business, the account that uses Harbour CRM. Your **Client profile** holds your Client name, Client contact number and billing details.
- **Contact**: a person your business deals with, such as a customer or a lead. Contacts live under **Contacts**.
- **Company**: an organisation your Contacts work for. Companies live under **Companies**.`,
    notConfusedWith: [],
    screen: '#/help',
  },
  {
    id: 'demo-data-reset',
    status: 'public',
    category: 'Getting started',
    title: 'Why your changes disappear when you reload',
    aliases: ['my changes were lost', 'reset the demo data', 'data not saved after refresh'],
    body: `This is a demonstration copy of Harbour CRM. It stores everything in your browser's memory only.

Reloading the page resets all Contacts, Companies, Deals, custom fields and settings to the original sample data. Nothing you enter is sent anywhere.`,
    notConfusedWith: [],
    screen: '#/contacts',
  },
];

export const articleById = new Map(articles.map((a) => [a.id, a]));
