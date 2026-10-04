import { NO_GENERATIVE_LINE, VERTICALS } from "./shared.mjs";

export default {
  id: "root",
  lang: "en",
  title: "Kadensio | A conversation engine that cannot make things up",
  description:
    "Deterministic state machines on official WhatsApp and voice channels, with fixed arithmetic scoring. Built for real estate brokerages and hospitality groups.",
  nav: [
    { label: "Architecture", href: "#architecture" },
    { label: "Guarantees", href: "#guarantees" },
    { label: "Verticals", href: "#verticals" },
  ],
  hero: {
    eyebrow: "Conversation infrastructure",
    h1: "A conversation engine that cannot make things up.",
    lead:
      "Deterministic state machines on official WhatsApp and voice channels. Fixed arithmetic scoring. " +
      "Nothing in the loop writes its own answers.",
    gatewayHeading: "Choose your industry",
    proof: ["Official Meta WhatsApp Business Platform", "Auditable scores", "Under 30 s to qualify"],
  },
  architecture: {
    id: "architecture",
    eyebrow: "Architecture",
    h2: "One engine. Six stages.",
    lead: "Every conversation moves through the same pipeline, whatever the industry.",
    steps: [
      ["Channel adapter", "Official WhatsApp Business Platform and dedicated voice trunks."],
      ["State machine", "A finite set of states. Each reply is a fixed template."],
      ["Scorer", "Weighted arithmetic out of 100. Same input, same score."],
      ["Router", "Sends the conversation to the matching person or team."],
      ["Integrations", "Calendar and booking systems, written to directly."],
      ["Shared inbox", "A human takes over any conversation in one tap."],
    ],
  },
  guarantees: {
    id: "guarantees",
    eyebrow: "Guarantees",
    h2: "What the engine will not do.",
    rows: [
      ["Invent data", "A price, a payment plan, a unit or a table slot is read from your inventory. One that does not exist cannot be sent."],
      ["Use unofficial routes", "Official APIs only. That removes the ban risk that unofficial WhatsApp automation puts on your main number."],
      ["Hide a score", "Every score has an audit log: the inputs, the weights, the result."],
      ["Use a generative model", NO_GENERATIVE_LINE],
    ],
  },
  verticals: {
    id: "verticals",
    eyebrow: "Verticals",
    h2: "One primitive, two presentations.",
    lead: "The same engine runs both. Only the vocabulary and the integrations change.",
    caption: "How the shared primitives appear in each vertical",
    head: ["Primitive", "Real Estate", "Hospitality"],
    rows: [
      ["Entity", "Lead", "Guest"],
      ["Outcome", "Viewing", "Reservation"],
      ["Key variables", "Budget, unit type", "Party size, zone"],
      ["Scheduler", "Google Calendar", "CoverManager / floor plan"],
      ["Inbox", "Team inbox", "Host dashboard"],
    ],
    cta: VERTICALS,
  },
  footer: {
    meta: "Conversation infrastructure for real estate and hospitality.",
    legal: [
      ["Privacy Policy", "https://kadensio.com/privacy.html"],
      ["Terms of Service", "https://kadensio.com/terms.html"],
      ["Data Processing Addendum", "https://kadensio.com/dpa.html"],
    ],
  },
};
