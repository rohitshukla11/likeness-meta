/**
 * Marketing copy that is data, not code. Every number here is a real measurement with its source;
 * testimonials are real quotes only. An empty list hides the section entirely.
 */

export const MEASUREMENTS = {
  /** By construction: a render is charged and its KMS-signed receipt stored in one Firestore transaction. */
  rendersWithReceipt: {
    value: 100,
    source: "Every render is settled in one Firestore transaction that also stores its Cloud KMS-signed receipt",
  },
} as const;

export type Testimonial = { quote: string; name: string; role: string };

/** Real, attributed quotes only. Leave empty until there are some: the section is then not rendered. */
export const TESTIMONIALS: Testimonial[] = [];

/** The legal pages, on Firebase Hosting (hosting/ in the repo). */
export const LEGAL_SITE = "https://bionic-carving-140911.firebaseapp.com";
export const PRIVACY_URL = `${LEGAL_SITE}/privacy`;
export const TERMS_URL = `${LEGAL_SITE}/terms`;

export const BUILT_ON = ["Vertex AI Gemini", "Veo", "Firebase", "YouTube", "Cloud KMS", "Cloud Run", "C2PA"];
