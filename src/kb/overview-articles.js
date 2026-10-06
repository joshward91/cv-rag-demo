/**
 * Harbour CRM overview pages, for visitors who are not signed in.
 *
 * Same fields as the help centre (articles.js), plus audience: 'everyone'.
 * They explain what a feature is for rather than how to use it, so they share
 * the task articles' vocabulary without their steps. Signed-in customers see
 * them too, ranked below the task help (viewerWeight in src/rag/suite.js).
 */
export const overviewArticles = [
  {
    "id": "overview-contacts",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Contacts in Harbour CRM: an overview",
    "aliases": [
      "how do I add a contact",
      "what is a contact in a CRM",
      "store customer phone and email",
      "contact management"
    ],
    "body": "A Contact is the heart of Harbour CRM. It is one of your own customers, kept as a single, tidy record rather than scattered across inboxes, spreadsheets and sticky notes.\n\nEach Contact holds the details you reach for most: a name, a phone number, an email address, a status and free-form notes. Everything about that person sits in one place, so anyone on your team can pick up a conversation without asking around.\n\nAdding a Contact takes moments, and you can keep adding as your customer base grows. Contacts can be linked to a Company, attached to Deals, and extended with custom fields for the details that are specific to your business.\n\nSome ways Clients use Contacts:\n\n- Keeping a reliable phone and email list for the whole team\n- Recording who was spoken to and what was agreed\n- Grouping people by status so the next follow-up is obvious\n- Exporting the list when it is needed elsewhere\n\nHarbour CRM is built to be simple to start with and roomy enough to grow into. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-keeping-contact-details-current",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Keeping Contact details current",
    "aliases": [
      "update a contact's phone number",
      "edit contact email",
      "fix outdated contact details",
      "change contact information"
    ],
    "body": "People change phone numbers, move jobs and switch email addresses. A CRM is only as useful as the details inside it, so Harbour CRM makes it easy to update a Contact whenever something changes.\n\nA Contact's phone number, email address, status and notes can all be edited on the record itself. Because each Contact lives in one place, a correction made once is seen by everyone on your team straight away. There is no second spreadsheet to fix and no old copy lingering in someone's inbox.\n\nWhy it matters:\n\n- Calls and emails reach the right person the first time\n- Your team spends less time hunting for the latest number\n- Follow-ups feel considered rather than careless\n- Reports and exports reflect reality\n\nA simple habit goes a long way. When a customer mentions a new phone number or email during a conversation, update the Contact while it is fresh, and add a note about what changed if it is worth remembering.\n\nHarbour CRM keeps editing light so that accuracy does not become a chore. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-companies",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Companies and how Contacts link to them",
    "aliases": [
      "link a contact to a company",
      "organisation records",
      "company phone website address",
      "group contacts by business"
    ],
    "body": "Customers rarely exist in isolation. Often several people at the same organisation matter to your business, and Harbour CRM reflects that with Companies.\n\nA Company record holds the details of an organisation: its phone number, website and address. Contacts can then be linked to the Company they belong to, so you can see at a glance who works where, and who else you know at the same business.\n\nThis is useful in a few ways:\n\n- A main switchboard number lives on the Company, while direct lines live on each Contact\n- When someone leaves, the Company and its other Contacts remain intact\n- Deals can be understood in the context of the organisation behind them\n- New team members can see the whole relationship, not just one name\n\nCompanies are optional. A Client who sells to individuals can work happily with Contacts alone, and add Companies later if the business moves towards organisations.\n\nThe result is a tidier, more human picture of your customers. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-deals-pipeline",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Deals and the pipeline",
    "aliases": [
      "sales pipeline",
      "track deals",
      "deal stages",
      "what is a deal in a CRM"
    ],
    "body": "A Deal is a piece of potential business: something your business hopes to sell to a Contact or Company. Harbour CRM lets you record each Deal with a value, so you always know what is on the table.\n\nDeals move through the pipeline, a series of stages that mirror how your sales actually progress. Seeing every Deal in its stage gives your team a shared picture of where things stand, which conversations need a nudge and which are close to the line.\n\nWhat the pipeline helps you do:\n\n- See what is early, what is advancing and what is nearly done\n- Spot Deals that have been sitting still for too long\n- Talk about sales with the same words and the same view\n- Understand the total value of work in progress\n\nBecause Deals connect to Contacts and Companies, the story behind each one is never far away. Notes, phone numbers and history sit alongside the value and the stage.\n\nIt is a clear, calm way to run a sales process without heavy software. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-winning-losing-deals",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Winning and losing Deals: forecasting the outcome",
    "aliases": [
      "mark deal as won",
      "mark deal as lost",
      "reopen a deal",
      "sales forecast"
    ],
    "body": "Every Deal reaches a conclusion. In Harbour CRM a Deal can be marked as won when the sale is secured, or as lost when it is not going ahead. If circumstances change, a lost Deal can be reopened and worked again.\n\nRecording outcomes honestly is one of the most valuable habits in sales. Won Deals show what is working. Lost Deals, kept on file rather than deleted, show where opportunities slip away and give you something to learn from.\n\nBecause each Deal carries a value, your outcomes build a practical picture for forecasting:\n\n- What you have won so far\n- What is still open in the pipeline\n- What has been lost, and how often\n\nThis is not a crystal ball. It is a grounded view, built from your own records, that helps you plan with more confidence and talk about the next quarter with facts to hand.\n\nReopening matters too. Customers who said no last month sometimes say yes later, and having the history intact makes that conversation easier.\n\nOnce you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-custom-fields",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Custom fields: make records fit your business",
    "aliases": [
      "add extra fields",
      "custom contact fields",
      "track our own information",
      "customise records"
    ],
    "body": "No two businesses keep track of the same things. A florist might want a delivery preference, an accountant a financial year end, a trainer a course level. Custom fields let you record exactly the details that matter, right on the record.\n\nCustom fields can be added to records such as Contacts, Companies and Deals. Once a field exists, it appears alongside the standard details like phone, email and value, and can be filled in for each record as needed.\n\nPopular uses include:\n\n- Referral source, so you know where customers come from\n- Preferred contact method, such as phone or email\n- Contract renewal dates\n- Account or membership numbers\n- Anything else your team keeps asking about\n\nThis keeps Harbour CRM from becoming a place where you squeeze information into the wrong box. Instead, the CRM adapts to the way your business already works, and the details your team needs sit within easy reach.\n\nStart with the standard fields, then add your own as the need becomes clear. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-search-filters",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Search and filters: find the right record fast",
    "aliases": [
      "search contacts",
      "filter contacts by status",
      "find a customer quickly",
      "look up a deal"
    ],
    "body": "As your list of Contacts grows, finding the right person should never feel like a treasure hunt. Harbour CRM includes search and filters so you can get to the record you need in moments.\n\nSearch is for when you know what you are looking for: a name, an email address or part of a phone number. Filters are for when you want to narrow a longer list, such as every Contact with a particular status.\n\nA few everyday examples:\n\n- Finding a customer while they are on the phone\n- Listing everyone who is waiting on a follow-up\n- Looking up a Company or a Deal without scrolling\n- Checking a group of Contacts before an export\n\nGood search also encourages good habits. When your team trusts that anything can be found quickly, they are more willing to record details as they go, and the CRM becomes more complete and more useful.\n\nIt works the same whether you have fifty Contacts or several thousand. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-exporting-contacts",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Exporting your Contacts",
    "aliases": [
      "export contacts to CSV",
      "download contact list",
      "back up my contacts",
      "get my data out"
    ],
    "body": "Your Contacts belong to you, and Harbour CRM makes it simple to take a copy whenever you need one. Contacts can be exported as a CSV file, a plain and widely supported format that opens in common spreadsheet programs.\n\nPeople export Contacts for many sensible reasons:\n\n- Keeping a periodic backup of the customer list\n- Reviewing or tidying records in a spreadsheet\n- Sharing a list with an accountant or adviser\n- Preparing a mail-out or event invitation list\n- Having peace of mind that the data is always within reach\n\nBecause search and filters help you narrow your Contacts first, an export can be as focused as you like, whether that is the whole list or one particular group.\n\nThe ability to export is part of how Harbour CRM treats your data: it is yours, and it is never locked away. Please note that export is available for Contacts, and Harbour CRM does not currently offer an import feature.\n\nOnce you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-notes-contact-history",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Notes and Contact history",
    "aliases": [
      "add a note to a contact",
      "record conversations",
      "customer history",
      "remember what was discussed"
    ],
    "body": "Good relationships rely on memory. Who did you speak to last week? What did they ask for? What did you promise? Notes on each Contact give your business a place to capture those details, so nothing depends on one person remembering.\n\nNotes sit on the Contact record, next to the phone number, email address and status. Anyone on your team who opens the record can see the background and carry on the conversation naturally, which customers notice and appreciate.\n\nUseful things to put in a note:\n\n- A summary of a phone call and what was agreed\n- Personal touches, like a preferred time to ring\n- Reasons a Deal moved forward or stalled\n- Reminders about what to follow up on\n\nOver time, notes build into a living history of the relationship. When a team member goes on leave or moves on, the knowledge stays with the Contact instead of leaving with them.\n\nKeep notes short, factual and kind. They are a working record, and they make the next conversation easier.\n\nOnce you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-contact-statuses",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Contact statuses: knowing who needs attention",
    "aliases": [
      "contact status",
      "lead or customer status",
      "mark contact as active",
      "organise contacts by stage"
    ],
    "body": "Not every Contact is in the same place. Some are brand new, some are in conversation, and some are long-standing customers. A status on each Contact lets you see that at a glance.\n\nStatus is a simple label that sits on the Contact record alongside the phone number, email address and notes. Because it is easy to change, it can move as the relationship does, from a first enquiry through to an ongoing customer.\n\nStatuses are handy for:\n\n- Deciding who to call first on a busy morning\n- Separating people you are still talking to from those who are settled\n- Giving the whole team the same shorthand\n- Filtering a long list down to the group that matters right now\n\nBecause search and filters understand status, you can pull up a particular group in moments, and even export them if you need a list elsewhere.\n\nKeep your statuses few and meaningful. A small set that everyone understands will do more for your team than a long list nobody remembers.\n\nOnce you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-account-billing-settings",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Account and billing settings overview",
    "aliases": [
      "change billing email",
      "change currency",
      "update client name",
      "account settings"
    ],
    "body": "Behind every Harbour CRM account is a Client: the business that uses the product. A small set of account settings keeps that Client's details accurate and your billing running smoothly.\n\nThe settings cover:\n\n- Client name, which identifies your business in the account\n- Client contact number, so we and your team have a reliable phone number on file\n- Billing email, the address where billing messages are sent\n- Currency, which determines how monetary values such as Deal values are shown\n\nThese details change from time to time. A business may rename, move to a new phone number, route billing to an accounts team, or begin trading in another currency. Keeping the settings current avoids missed messages and confusion about figures.\n\nThey are kept deliberately simple, so account upkeep does not turn into an administrative project. It is worth a quick review now and then, particularly after any change in your business.\n\nNote that these settings relate to your business as the Client, not to your Contacts. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-getting-started",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Getting started with Harbour CRM",
    "aliases": [
      "how to start using a CRM",
      "set up my CRM",
      "first steps with Harbour CRM",
      "new to CRM"
    ],
    "body": "Harbour CRM is designed to be useful from your first day. You do not need a complicated rollout; a sensible start is enough.\n\nA good way to begin is to think in layers:\n\n- Start with Contacts. Add your most important customers, with their phone numbers and email addresses\n- Link Contacts to Companies where it helps\n- Record your live Deals, and place them in the pipeline\n- Add custom fields for anything specific to your business\n- Check your account settings, including Client name, billing email and currency\n\nBecause Harbour CRM does not currently offer an import feature, many Clients begin by adding their most active Contacts first and building the list as they work. It is a natural way to keep the data fresh and relevant.\n\nAs your records grow, search, filters and statuses keep everything easy to find, and a CSV export of your Contacts is always available.\n\nTake it at your own pace. Small, consistent habits will serve you better than a big push once. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-who-is-it-for",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Who Harbour CRM is for",
    "aliases": [
      "is Harbour CRM right for my business",
      "CRM for small business",
      "who uses Harbour CRM",
      "CRM for sole traders"
    ],
    "body": "Harbour CRM suits businesses that want to look after their customers well without wrestling with heavy software. If you keep your customers in a spreadsheet, an inbox or a notebook, and sense it is time for something more dependable, it was made with you in mind.\n\nTypical Clients include:\n\n- Sole traders and small teams who need one reliable list of Contacts\n- Service businesses that follow up with people over weeks or months\n- Sales-minded teams who want to see Deals moving through a pipeline\n- Businesses that deal with organisations and want Contacts linked to Companies\n- Owners who like to have their data within reach, with a CSV export of Contacts\n\nIt is a good fit when you value clarity over complexity: phone numbers and emails kept current, notes on every conversation, and a clear view of what is won, lost or still open.\n\nIf your needs are specialised, custom fields let you shape records around your own work.\n\nHarbour CRM is not trying to be everything to everyone. It aims to do the essentials well. Once you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-data-ownership-privacy",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Data ownership and privacy overview",
    "aliases": [
      "who owns my contact data",
      "is my customer data private",
      "data privacy CRM",
      "can I take my data with me"
    ],
    "body": "When a Client stores customer information in Harbour CRM, that information remains the Client's. Your Contacts, Companies and Deals are your records, kept for your business to use.\n\nThere are a few principles worth knowing:\n\n- Your data is yours. The Contacts you add, with their phone numbers, email addresses and notes, belong to you\n- Your data is within reach. Contacts can be exported as a CSV file at any time\n- Your account is managed by you. Client details such as the Client name, Client contact number and billing email are kept in your account settings\n- Your customers' details deserve care, and you remain responsible for collecting and using them lawfully\n\nWe encourage every Client to record only what is useful, keep details accurate and remove what is no longer needed. Good housekeeping is good privacy.\n\nThis page is a friendly overview rather than a legal document. For the formal terms, please read our privacy policy and terms of service.\n\nOnce you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  },
  {
    "id": "overview-harbour-products",
    "status": "public",
    "audience": "everyone",
    "category": "Overview",
    "title": "Working across Harbour products",
    "aliases": [
      "Harbour Invoicing",
      "Harbour Mail",
      "Harbour Desk",
      "other Harbour products"
    ],
    "body": "Harbour CRM is one member of a family of business tools. The sister products are Harbour Invoicing, Harbour Mail, Harbour Desk, Harbour People and Harbour Projects, each designed to look after a different part of running a business.\n\nIn broad terms:\n\n- Harbour Invoicing is for billing and getting paid\n- Harbour Mail is for email\n- Harbour Desk is for customer support\n- Harbour People is for looking after your team\n- Harbour Projects is for organising work\n\nHarbour CRM focuses on the relationship side: Contacts, Companies, Deals and the pipeline. Many Clients find that this sits comfortably beside whichever other Harbour products they choose to use.\n\nYou do not need any other product to get full value from Harbour CRM. It stands on its own, and you can add others when your business calls for them.\n\nThis page describes the family at a high level. For what each product offers and how they work together, please see that product's own pages.\n\nOnce you're signed in, the help centre walks you through each step.",
    "notConfusedWith": []
  }
];
