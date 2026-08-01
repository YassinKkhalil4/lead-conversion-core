# Airtable Field Map

Status: provisional. This is built from source/config/workflow evidence in the read-only archive and must be reconciled against the real Airtable export before authority cutover.

## Verified Mappings

These field names appear in current source, seed config, or workflow code.

### Clients

- `Client ID`
- `Company Name`
- `Active`
- `Manager Name`
- `Manager Phone`
- `WhatsApp Provider`
- `Calendar ID`
- `Appointment Hours`
- `Appointment Blackout Days`

### Projects

- `Project Name`
- `Active`
- `Starting Price`
- `Max Price`
- `Unit Types`
- `Location`
- `Maps URL`
- `Client`

### Salespeople

- `Salesperson ID`
- `Client`
- `Name`
- `Phone`
- `Email`
- `Assigned Projects`
- `Unit Specialties`
- `Locations`
- `Languages`
- `Priority Rank`
- `Active`

### Leads

- `Lead ID`
- `Name`
- `Phone Raw`
- `Phone Normalized`
- `Email`
- `Client`
- `Project Linked`
- `Project Interest`
- `Status`
- `Current Stage`
- `First Contacted At`
- `First Reply At`
- `Last Message At`
- `Temperature`
- `Lead Score`
- `Assigned Salesperson`
- `Sales Action Status`
- `Stop Follow-Up`
- `Stop Reason`
- `Closed Status`
- `Appointment Status`
- `Appointment Date`
- `Typebot Session ID`

### Qualifications

- `Lead`
- `Location`
- `Unit Type`
- `Budget Min`
- `Budget Max`
- `Down Payment`
- `Payment Preference`
- `Timeline`
- `Purpose`
- `Call Interest`
- `Site Visit Interest`
- `Complete`
- `Qualification Notes`

### Conversation Configuration

- `Question Key`
- `Stage Key`
- `Question Type`
- `Saves To`
- `Parser Hint`
- `Order`
- `English`
- `Arabic`
- `Client`
- `Active`
- `Option Key`
- `Value`
- `Question`
- `Message Key`

### Messages

- `Message ID`
- `Direction`
- `Channel`
- `From`
- `To`
- `Message Text`
- `Message Type`
- `Provider Message ID`
- `Sent`
- `Delivered`
- `Read`
- `Created At`

### Events

Verified from the n8n Audit Log Utility workflow writing to the Airtable `Events` table.

- `Event ID`
- `Event Type`
- `Description`
- `Workflow Name`
- `Payload JSON`
- `Created At`
- `Event Channel`
- `Client`
- `Lead`

## Inferred Mappings

These fields are referenced by expected migration requirements or derived from adjacent workflow behavior, but must be confirmed in the real export.

- Lead campaign/source fields: `Campaign`, `Campaign ID`, `Adset ID`, `Adset Name`, `Ad ID`, `Ad Name`, `Form ID`, `Form Name`, `Source Detail`
- Follow-up fields: sequence key, due time, sent/cancelled state, stop reason
- Appointment fields: offered slot, booked slot, calendar event ID, status, timezone
- Score detail fields: individual scoring factors and explanation

## Unknown Until Real Export

- Exact table names and primary fields for FollowUps, Appointments, and Scores
- Whether linked-record exports preserve record IDs in CSV format or require JSON exports
- Whether email and phone fields contain normalized values consistently
- Whether historical message provider IDs are unique across all clients

## Blocker

Real-export compatibility and production reconciliation are blocked until the owner supplies a complete export or a rotated least-privilege Airtable token.
