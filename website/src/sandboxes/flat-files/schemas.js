// The payments file: CSV with a header row. A column whose heading isn't a good field name says so.
export const payments = {
  type: "object",
  flat: { format: "csv" },
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", flat: { name: "Payment ID" } },
          date: { type: "string", flat: { name: "Date" } },
          payee: { type: "string", flat: { name: "Payee" } },
          amount: { type: "number", flat: { name: "Amount" } },
          reference: { type: "string", flat: { name: "Reference" } },
        },
      },
    },
  },
};

// The bank's file: fixed-width, with a header line, a CR line per payment and a trailer, each told apart by
// the tag it starts with. Amounts are in pence with no decimal point, zero-padded.
export const bankFile = {
  type: "object",
  flat: { format: "fixed", lineEnding: "\r\n" },
  properties: {
    header: {
      type: "object",
      flat: { tag: "FH" },
      properties: {
        sender: { type: "string", flat: { width: 18 } },
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        flat: { tag: "CR" },
        properties: {
          date: { type: "string", flat: { width: 8 } },
          payee: { type: "string", flat: { width: 18 } },
          pence: { type: "number", flat: { width: 11, pad: "0", decimals: 2 } },
          reference: { type: "string", flat: { width: 18 } },
        },
      },
    },
    trailer: {
      type: "object",
      flat: { tag: "FT" },
      properties: {
        count: { type: "integer", flat: { width: 6, pad: "0" } },
        pence: { type: "number", flat: { width: 13, pad: "0", decimals: 2 } },
      },
    },
  },
};
