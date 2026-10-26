// Fixed /dog-comms fixture for the golden-snapshot test. Fictional people and posts only.
export const DOG_PEOPLE = [
  {
    id: "gale-handler",
    name: "Gale Handler",
    category: "notable",
    event_date: "2025-03-04",
    tags: ["official"],
    events: [],
  },
  {
    id: "hal-ranger",
    name: "Hal Ranger",
    category: "notable",
    event_date: "2024-06-01",
    events: [],
  },
];

export const DOG_POSTS = [
  {
    id: "example-k9-2025",
    posted_at: "2025-03-04",
    handle: "@ExampleK9",
    account_name: "Example K9 Unit",
    text: "Official K9 unit post naming Gale Handler.",
    source_url: "https://example.gov/k9/2025",
    snapshot: { person_ids: ["gale-handler"] },
  },
  {
    id: "example-k9-2024",
    posted_at: "2024-11-20",
    handle: "@ExampleK9",
    account_name: "Example K9 Unit",
    text: "Official K9 unit post with no linked person.",
    source_url: "https://example.gov/k9/2024",
  },
  {
    id: "example-k9-2024b",
    posted_at: "2024-06-01",
    handle: "@ExampleDogs",
    account_name: "Example Dogs Desk",
    text: "Second post naming Gale Handler and Hal Ranger.",
    source_url: "https://example.gov/k9/2024b",
    snapshot: { person_ids: ["gale-handler", "hal-ranger"] },
  },
];

export const DOG_PATHS = ["/dog-comms", "/dog-comms/example-k9-2025"];
